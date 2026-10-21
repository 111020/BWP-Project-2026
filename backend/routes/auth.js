const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { sendLoginOtpEmail } = require('../mailer');

const router = express.Router();

/**
 * POST /api/auth/register
 * Handles student registration with validation, bcrypt password hashing,
 * and parameterized MySQL insertion into the users table.
 */
router.post('/register', async (req, res) => {
  try {
    const { name, full_name, email, department, year, academic_year, password } = req.body;

    const studentName = (full_name || name || '').trim();
    const studentEmail = (email || '').trim().toLowerCase();
    const studentDept = (department || '').trim();
    const rawYear = academic_year || year;
    const studentPassword = password || '';

    // 1. Validation: Required fields
    if (!studentName || !studentEmail || !studentDept || !rawYear || !studentPassword) {
      return res.status(400).json({
        success: false,
        message: 'All fields (name, email, department, academic year, password) are required.'
      });
    }

    // 2. Validation: Email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(studentEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    // 3. Validation: Password length
    if (studentPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    // 4. Map academic year to integer for the database schema (tinyint)
    let parsedYear = parseInt(rawYear, 10);
    if (isNaN(parsedYear)) {
      if (String(rawYear).toLowerCase().includes('postgrad')) {
        parsedYear = 5;
      } else {
        parsedYear = 1;
      }
    }

    // 5. Check if email already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [studentEmail]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    // 6. Hash password with bcryptjs (salt rounds = 10)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(studentPassword, salt);

    // 7. Insert student record into users table using parameterized query
    const [insertResult] = await pool.execute(
      'INSERT INTO users (full_name, email, password_hash, department, academic_year) VALUES (?, ?, ?, ?, ?)',
      [studentName, studentEmail, passwordHash, studentDept, parsedYear]
    );

    // 8. Return success response without returning password or hash
    return res.status(201).json({
      success: true,
      message: 'Student account created successfully.',
      user: {
        id: insertResult.insertId,
        name: studentName,
        full_name: studentName,
        email: studentEmail,
        department: studentDept,
        year: parsedYear,
        academic_year: parsedYear
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'A database error occurred during registration. Please try again.'
    });
  }
});

/**
 * POST /api/auth/login
 * Handles student login:
 * 1. Verifies credentials with bcryptjs.
 * 2. Checks if the student has verified an OTP within the last 4 hours (4 * 60 * 60 * 1000 ms).
 *    - If YES: logs in directly without OTP!
 *    - If NO: generates a 6-digit OTP, stores it in login_otps, dispatches email via Nodemailer SMTP,
 *      and returns { success: true, requireOtp: true, email }.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const studentEmail = (email || '').trim().toLowerCase();
    const studentPassword = password || '';

    // 1. Validation: Email and password are required
    if (!studentEmail || !studentPassword) {
      return res.status(400).json({
        success: false,
        message: 'Both email and password are required.'
      });
    }

    // 2. Query student from users table including last_otp_verified_at
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, password_hash, department, academic_year, last_otp_verified_at FROM users WHERE email = ? LIMIT 1',
      [studentEmail]
    );

    // Standardized authentication failure message (prevents user enumeration)
    const invalidAuthResponse = {
      success: false,
      message: 'Invalid email or password.'
    };

    if (rows.length === 0) {
      return res.status(401).json(invalidAuthResponse);
    }

    const student = rows[0];

    // 3. Verify submitted password against stored bcrypt password_hash
    const isPasswordValid = await bcrypt.compare(studentPassword, student.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json(invalidAuthResponse);
    }

    // 4. Check 4-Hour Direct Login Window Exemption
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    let canBypassOtp = false;
    let bypassRemainingMinutes = 0;

    if (student.last_otp_verified_at) {
      const lastVerifiedTime = new Date(student.last_otp_verified_at).getTime();
      const elapsedMs = Date.now() - lastVerifiedTime;
      if (elapsedMs >= 0 && elapsedMs < FOUR_HOURS_MS) {
        canBypassOtp = true;
        bypassRemainingMinutes = Math.round((FOUR_HOURS_MS - elapsedMs) / 60000);
      }
    }

    const sessionUserData = {
      id: student.id,
      name: student.full_name,
      full_name: student.full_name,
      email: student.email,
      department: student.department,
      year: student.academic_year,
      academic_year: student.academic_year
    };

    // 4A. If verified within 4 hours: direct login without OTP!
    if (canBypassOtp) {
      if (req.session) {
        req.session.user = sessionUserData;
      }

      console.log(`⚡ [DIRECT LOGIN] Student ${student.email} logged in without OTP (within 4-hr window, ~${bypassRemainingMinutes} mins remaining).`);

      return res.status(200).json({
        success: true,
        requireOtp: false,
        bypassedOtp: true,
        bypassRemainingMinutes,
        message: 'Login successful. (Direct login enabled within 4-hour window).',
        token: `session_${student.id}_${Date.now()}`,
        user: sessionUserData
      });
    }

    // 4B. Not verified within 4 hours: Generate 6-digit OTP and send via Nodemailer
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Invalidate previous pending OTPs for this user
    await pool.execute(
      'UPDATE login_otps SET verified_at = "1970-01-01 00:00:00" WHERE user_id = ? AND verified_at IS NULL',
      [student.id]
    );

    // Insert new pending OTP record
    await pool.execute(
      'INSERT INTO login_otps (user_id, email, otp_code, expires_at) VALUES (?, ?, ?, ?)',
      [student.id, student.email, otpCode, expiresAt]
    );

    // Dispatch email via Nodemailer SMTP service
    const mailResult = await sendLoginOtpEmail({
      toEmail: student.email,
      studentName: student.full_name,
      otpCode,
      expiresMinutes: 10
    });

    return res.status(200).json({
      success: true,
      requireOtp: true,
      message: 'A 6-digit verification code has been sent to your email.',
      email: student.email,
      tempToken: `temp_${student.id}_${Date.now()}`,
      simulated: mailResult.simulated || false,
      expiresInMinutes: 10
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'A database error occurred during login. Please try again.'
    });
  }
});

/**
 * POST /api/auth/verify-otp
 * Verifies the 6-digit OTP submitted by the student:
 * 1. Checks matching unverified code in login_otps within 10-minute validity.
 * 2. On success, sets last_otp_verified_at = NOW() on the user record.
 *    This enables direct login without OTP for the next 4 hours!
 * 3. Creates session and returns authenticated student profile and token.
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const studentEmail = (email || '').trim().toLowerCase();
    const enteredOtp = (otp || '').trim();

    if (!studentEmail || !enteredOtp) {
      return res.status(400).json({
        success: false,
        message: 'Both email and the 6-digit verification code are required.'
      });
    }

    // Query active unverified OTP for this email
    const [rows] = await pool.execute(
      'SELECT id, user_id, otp_code, expires_at FROM login_otps WHERE email = ? AND verified_at IS NULL ORDER BY id DESC LIMIT 1',
      [studentEmail]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active verification code found. Please request a new one.'
      });
    }

    const otpRecord = rows[0];

    // Check expiration
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'The verification code has expired. Please request a new code.'
      });
    }

    // Check OTP match
    if (otpRecord.otp_code !== enteredOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please check your email and try again.'
      });
    }

    // Valid OTP! Mark OTP as verified
    await pool.execute(
      'UPDATE login_otps SET verified_at = NOW() WHERE id = ?',
      [otpRecord.id]
    );

    // Update user's last_otp_verified_at timestamp (Starts 4-hour direct login exemption)
    await pool.execute(
      'UPDATE users SET last_otp_verified_at = NOW() WHERE id = ?',
      [otpRecord.user_id]
    );

    // Query authenticated student profile
    const [userRows] = await pool.execute(
      'SELECT id, full_name, email, department, academic_year FROM users WHERE id = ? LIMIT 1',
      [otpRecord.user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.'
      });
    }

    const student = userRows[0];
    const sessionUserData = {
      id: student.id,
      name: student.full_name,
      full_name: student.full_name,
      email: student.email,
      department: student.department,
      year: student.academic_year,
      academic_year: student.academic_year
    };

    if (req.session) {
      req.session.user = sessionUserData;
    }

    console.log(`✅ [OTP VERIFIED] Student ${student.email} successfully verified OTP. 4-hour direct login window is now active.`);

    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const directLoginUntil = new Date(Date.now() + FOUR_HOURS_MS).toISOString();

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully! You can log in directly without OTP for the next 4 hours.',
      token: `session_${student.id}_${Date.now()}`,
      directLoginUntil,
      user: sessionUserData
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'A database error occurred during verification. Please try again.'
    });
  }
});

/**
 * POST /api/auth/resend-otp
 * Resends a fresh 6-digit OTP code to the student's email via Nodemailer.
 * Includes a 20-second rate limiter to prevent email flooding.
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const studentEmail = (email || '').trim().toLowerCase();

    if (!studentEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required.'
      });
    }

    const [userRows] = await pool.execute(
      'SELECT id, full_name, email FROM users WHERE email = ? LIMIT 1',
      [studentEmail]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.'
      });
    }

    const student = userRows[0];

    // Rate-limit: Check if an OTP was sent in the last 20 seconds
    const [recentOtps] = await pool.execute(
      'SELECT created_at FROM login_otps WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [student.id]
    );

    if (recentOtps.length > 0) {
      const lastSentTime = new Date(recentOtps[0].created_at).getTime();
      const elapsedSeconds = (Date.now() - lastSentTime) / 1000;
      if (elapsedSeconds < 20) {
        const waitSec = Math.ceil(20 - elapsedSeconds);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec} seconds before requesting another code.`
        });
      }
    }

    // Invalidate previous pending OTPs
    await pool.execute(
      'UPDATE login_otps SET verified_at = "1970-01-01 00:00:00" WHERE user_id = ? AND verified_at IS NULL',
      [student.id]
    );

    // Generate fresh OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.execute(
      'INSERT INTO login_otps (user_id, email, otp_code, expires_at) VALUES (?, ?, ?, ?)',
      [student.id, student.email, otpCode, expiresAt]
    );

    const mailResult = await sendLoginOtpEmail({
      toEmail: student.email,
      studentName: student.full_name,
      otpCode,
      expiresMinutes: 10
    });

    return res.status(200).json({
      success: true,
      message: 'A new 6-digit verification code has been sent to your email.',
      simulated: mailResult.simulated || false
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not resend verification code. Please try again.'
    });
  }
});

/**
 * GET /api/auth/otp-status
 * Helper endpoint to inspect whether an email address is currently
 * within the 4-hour direct login exemption window.
 */
router.get('/otp-status', async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email query parameter required.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, email, last_otp_verified_at FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = rows[0];
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    let isExempt = false;
    let remainingMinutes = 0;

    if (user.last_otp_verified_at) {
      const elapsed = Date.now() - new Date(user.last_otp_verified_at).getTime();
      if (elapsed >= 0 && elapsed < FOUR_HOURS_MS) {
        isExempt = true;
        remainingMinutes = Math.round((FOUR_HOURS_MS - elapsed) / 60000);
      }
    }

    return res.status(200).json({
      success: true,
      email: user.email,
      last_otp_verified_at: user.last_otp_verified_at,
      directLoginActive: isExempt,
      remainingMinutes
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated student profile by reading the session
 * and querying the MySQL database for the latest user record.
 */
router.get('/me', async (req, res) => {
  try {
    let userId = req.session && req.session.user && req.session.user.id;

    // Fallback: check Authorization header for Bearer token
    if (!userId && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const token = req.headers.authorization.slice(7).trim();
      const match = token.match(/^session_(\d+)/);
      if (match) {
        userId = parseInt(match[1], 10);
      } else if (/^\d+$/.test(token)) {
        userId = parseInt(token, 10);
      }
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated.'
      });
    }

    const [rows] = await pool.execute(
      'SELECT id, full_name, email, department, academic_year, mobile_number, bio, goals, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.'
      });
    }

    const student = rows[0];
    const userData = {
      id: student.id,
      name: student.full_name,
      full_name: student.full_name,
      email: student.email,
      department: student.department,
      year: student.academic_year,
      academic_year: student.academic_year,
      mobile_number: student.mobile_number || '',
      mobile: student.mobile_number || '',
      bio: student.bio || '',
      goals: student.goals || '',
      learningGoals: student.goals || '',
      createdAt: student.created_at
    };

    // Keep session user data in sync with database
    req.session.user = userData;

    return res.status(200).json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Error in /api/auth/me:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve authenticated student profile.'
    });
  }
});

/**
 * POST /api/auth/logout
 * Destroys session and clears cookie using matching configuration.
 */
router.post('/logout', (req, res) => {
  const cookieOptions = { path: '/', httpOnly: true, secure: false };

  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({
          success: false,
          message: 'Could not log out. Please try again.'
        });
      }
      res.clearCookie('connect.sid', cookieOptions);
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully.'
      });
    });
  } else {
    res.clearCookie('connect.sid', cookieOptions);
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  }
});

module.exports = router;

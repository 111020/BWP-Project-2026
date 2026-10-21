const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');

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
 * Handles student login: verifies credentials with bcryptjs, creates session
 * using express-session, and returns sanitized student profile.
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

    // 2. Query student from users table using parameterized SQL query
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, password_hash, department, academic_year FROM users WHERE email = ? LIMIT 1',
      [studentEmail]
    );

    // Standardized authentication failure message (do not reveal if email is registered)
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

    // 4. Create session using express-session (never store passwords in session)
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

    // 5. Return success response with safe student data (never return password or hash)
    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token: `session_${student.id}_${Date.now()}`,
      user: sessionUserData
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

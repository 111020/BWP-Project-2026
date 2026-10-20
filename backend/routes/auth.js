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

    // 7. Insert student record into users table
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
        email: studentEmail,
        department: studentDept,
        year: parsedYear
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'A database error occurred during registration. Please try again.'
    });
  }
});

module.exports = router;

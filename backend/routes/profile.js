const express = require('express');
const pool = require('../db');
const router = express.Router();

async function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.id) {
    return next();
  }

  // Fallback: check Authorization header for Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    let userId = null;
    const match = token.match(/^session_(\d+)/);
    if (match) {
      userId = parseInt(match[1], 10);
    } else if (/^\d+$/.test(token)) {
      userId = parseInt(token, 10);
    }

    if (userId) {
      try {
        const [rows] = await pool.execute(
          'SELECT id, full_name, email, department, academic_year, mobile_number, bio, goals FROM users WHERE id = ? LIMIT 1',
          [userId]
        );
        if (rows.length > 0) {
          const s = rows[0];
          req.session.user = {
            id: s.id,
            name: s.full_name,
            full_name: s.full_name,
            email: s.email,
            department: s.department,
            year: s.academic_year,
            academic_year: s.academic_year,
            mobile_number: s.mobile_number || '',
            bio: s.bio || '',
            goals: s.goals || ''
          };
          return next();
        }
      } catch (err) {
        console.error('requireAuth token lookup error:', err);
      }
    }
  }

  return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
}

function parseYearToInt(year) {
  if (!year) return 1;
  const num = parseInt(year, 10);
  if (!isNaN(num)) return num;
  const s = String(year).toLowerCase();
  if (s.includes('1st') || s.includes('first')) return 1;
  if (s.includes('2nd') || s.includes('second')) return 2;
  if (s.includes('3rd') || s.includes('third')) return 3;
  if (s.includes('4th') || s.includes('fourth')) return 4;
  if (s.includes('post') || s.includes('grad')) return 5;
  return 1;
}

function formatYear(year) {
  switch (Number(year)) {
    case 1: return '1st Year';
    case 2: return '2nd Year';
    case 3: return '3rd Year';
    case 4: return '4th Year';
    case 5: return 'Postgraduate';
    default: return String(year || '1st Year');
  }
}

/**
 * GET /api/profile
 * Returns the authenticated student's full profile from the database.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, department, academic_year, mobile_number, bio, goals, created_at FROM users WHERE id = ? LIMIT 1',
      [req.session.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }
    const s = rows[0];
    const profile = {
      id: s.id,
      name: s.full_name,
      full_name: s.full_name,
      email: s.email,
      department: s.department,
      year: formatYear(s.academic_year),
      academic_year: s.academic_year,
      mobile_number: s.mobile_number || '',
      mobile: s.mobile_number || '',
      bio: s.bio || '',
      goals: s.goals || '',
      learningGoals: s.goals || '',
      createdAt: s.created_at
    };
    return res.status(200).json({ success: true, user: profile, profile: profile });
  } catch (err) {
    console.error('GET /profile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load profile.' });
  }
});

/**
 * PUT /api/profile
 * Updates student profile including mobile_number, bio, and goals.
 */
router.put('/', requireAuth, async (req, res) => {
  try {
    // 1. Fetch existing profile to prevent overwriting omitted fields
    const [existingRows] = await pool.execute(
      'SELECT id, full_name, email, department, academic_year, mobile_number, bio, goals, created_at FROM users WHERE id = ? LIMIT 1',
      [req.session.user.id]
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }
    const existing = existingRows[0];

    const { name, full_name, department, year, academic_year } = req.body;
    const studentName = (full_name !== undefined ? full_name : (name !== undefined ? name : existing.full_name)).trim();
    if (!studentName) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    const studentDept = department !== undefined ? String(department).trim() : existing.department;
    const parsedYear = (academic_year !== undefined || year !== undefined)
      ? parseYearToInt(academic_year || year)
      : existing.academic_year;

    // Mobile Number: allow empty, null, or string up to 20 chars
    let mobileNumber = existing.mobile_number;
    const incomingMobile = req.body.mobile_number !== undefined ? req.body.mobile_number : req.body.mobile;
    if (incomingMobile !== undefined) {
      const cleanMobile = incomingMobile ? String(incomingMobile).trim() : '';
      mobileNumber = cleanMobile.length > 0 ? cleanMobile.slice(0, 20) : null;
    }

    // Bio: allow empty or null
    let bio = existing.bio;
    const incomingBio = req.body.bio !== undefined ? req.body.bio : req.body.about;
    if (incomingBio !== undefined) {
      const cleanBio = incomingBio ? String(incomingBio).trim() : '';
      bio = cleanBio.length > 0 ? cleanBio : null;
    }

    // Goals: allow empty or null
    let goals = existing.goals;
    const incomingGoals = req.body.goals !== undefined ? req.body.goals : req.body.learningGoals;
    if (incomingGoals !== undefined) {
      const cleanGoals = incomingGoals ? String(incomingGoals).trim() : '';
      goals = cleanGoals.length > 0 ? cleanGoals : null;
    }

    // Parameterized update of all profile fields
    await pool.execute(
      'UPDATE users SET full_name = ?, department = ?, academic_year = ?, mobile_number = ?, bio = ?, goals = ? WHERE id = ?',
      [studentName, studentDept, parsedYear, mobileNumber, bio, goals, req.session.user.id]
    );

    // Fetch refreshed row from database
    const [updatedRows] = await pool.execute(
      'SELECT id, full_name, email, department, academic_year, mobile_number, bio, goals, created_at FROM users WHERE id = ? LIMIT 1',
      [req.session.user.id]
    );
    const s = updatedRows[0];
    const updated = {
      id: s.id,
      name: s.full_name,
      full_name: s.full_name,
      email: s.email,
      department: s.department,
      year: formatYear(s.academic_year),
      academic_year: s.academic_year,
      mobile_number: s.mobile_number || '',
      mobile: s.mobile_number || '',
      bio: s.bio || '',
      goals: s.goals || '',
      learningGoals: s.goals || '',
      createdAt: s.created_at
    };

    req.session.user = {
      id: s.id,
      name: s.full_name,
      full_name: s.full_name,
      email: s.email,
      department: s.department,
      year: s.academic_year,
      academic_year: s.academic_year,
      mobile_number: s.mobile_number || '',
      bio: s.bio || '',
      goals: s.goals || ''
    };

    return res.status(200).json({ success: true, message: 'Profile updated successfully.', user: updated, profile: updated });
  } catch (err) {
    console.error('PUT /profile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

/**
 * GET /api/profile/export
 * Exports the student profile as an XML file download.
 */
router.get('/export', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, department, academic_year, created_at FROM users WHERE id = ? LIMIT 1',
      [req.session.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    const s = rows[0];
    const esc = (str) => String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<StudentProfile>',
      '  <ID>' + s.id + '</ID>',
      '  <FullName>' + esc(s.full_name) + '</FullName>',
      '  <Email>' + esc(s.email) + '</Email>',
      '  <Department>' + esc(s.department) + '</Department>',
      '  <AcademicYear>' + formatYear(s.academic_year) + '</AcademicYear>',
      '  <RegisteredAt>' + (s.created_at ? new Date(s.created_at).toISOString() : '') + '</RegisteredAt>',
      '</StudentProfile>'
    ].join('\n');
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="student_profile_' + s.id + '.xml"');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('GET /profile/export error:', err);
    return res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

module.exports = router;

const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * Authentication Middleware
 * Ensures the student has an active session before accessing matching endpoints.
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.id) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please sign in.'
    });
  }
  next();
}

/**
 * Helper to convert academic year integer to readable format
 */
function formatAcademicYear(year) {
  switch (Number(year)) {
    case 1: return '1st Year';
    case 2: return '2nd Year';
    case 3: return '3rd Year';
    case 4: return '4th Year';
    case 5: return 'Postgraduate';
    default: return year ? `${year}th Year` : 'Student';
  }
}

/**
 * GET /api/matches
 * Finds compatible peer students who offer skills the logged-in student wants to learn.
 * Detects reciprocal skills where the peer wants to learn a skill the current student offers.
 * One-way matches are also supported.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id;

    // 1. Fetch skills the current student offers to teach
    const [myOfferedRows] = await pool.execute(
      `SELECT us.skill_id, s.name
       FROM user_skills us
       JOIN skills s ON us.skill_id = s.id
       WHERE us.user_id = ? AND us.skill_type = 'offer'`,
      [currentUserId]
    );

    // Map of skill_id -> skill_name for skills current user offers
    const myOfferedMap = new Map();
    myOfferedRows.forEach(row => {
      myOfferedMap.set(row.skill_id, row.name);
    });

    // 2. Find peer students who offer a skill the current student wants to learn
    const [matchingPeers] = await pool.execute(
      `SELECT 
        u.id AS partner_id,
        u.full_name,
        u.department,
        u.academic_year,
        s.id AS teach_skill_id,
        s.name AS teach_skill_name
       FROM user_skills us
       JOIN users u ON us.user_id = u.id
       JOIN skills s ON us.skill_id = s.id
       WHERE us.skill_type = 'offer'
         AND us.user_id != ?
         AND us.skill_id IN (
           SELECT skill_id 
           FROM user_skills 
           WHERE user_id = ? AND skill_type = 'learn'
         )
       ORDER BY u.full_name ASC`,
      [currentUserId, currentUserId]
    );

    // If no peers offer any skill the current student wants, return empty list
    if (matchingPeers.length === 0) {
      return res.status(200).json({
        success: true,
        matches: []
      });
    }

    // 3. Collect unique partner IDs to fetch what skills they want to learn
    const partnerIds = [...new Set(matchingPeers.map(p => p.partner_id))];

    // Build parameterized placeholders for IN clause
    const placeholders = partnerIds.map(() => '?').join(',');
    const [peersWantedRows] = await pool.execute(
      `SELECT 
        us.user_id AS partner_id,
        us.skill_id,
        s.name AS skill_name
       FROM user_skills us
       JOIN skills s ON us.skill_id = s.id
       WHERE us.skill_type = 'learn'
         AND us.user_id IN (${placeholders})`,
      partnerIds
    );

    // Group wanted skills by partner_id
    const partnerWantedSkills = new Map();
    peersWantedRows.forEach(row => {
      if (!partnerWantedSkills.has(row.partner_id)) {
        partnerWantedSkills.set(row.partner_id, []);
      }
      partnerWantedSkills.get(row.partner_id).push({
        id: row.skill_id,
        name: row.skill_name
      });
    });

    // 4. Construct matches list
    const formattedMatches = matchingPeers.map(peer => {
      const wantedList = partnerWantedSkills.get(peer.partner_id) || [];

      // Check for reciprocal skill: peer wants a skill current user offers
      let reciprocalSkillName = null;
      for (const item of wantedList) {
        if (myOfferedMap.has(item.id)) {
          reciprocalSkillName = item.name;
          break;
        }
      }

      // If reciprocal skill exists, use it; otherwise use any skill peer wants, or fallback
      const isReciprocal = !!reciprocalSkillName;
      const wantsSkillName = reciprocalSkillName 
        || (wantedList.length > 0 ? wantedList[0].name : 'Open to exchange');

      const yearString = formatAcademicYear(peer.academic_year);

      return {
        id: peer.partner_id,
        studentId: peer.partner_id,
        name: peer.full_name,
        department: peer.department,
        year: yearString,
        student: {
          id: peer.partner_id,
          _id: peer.partner_id,
          name: peer.full_name,
          department: peer.department,
          year: yearString,
          academic_year: peer.academic_year
        },
        skillId: peer.teach_skill_id,
        teachesSkill: peer.teach_skill_name,
        wantsSkill: wantsSkillName,
        isReciprocal: isReciprocal
      };
    });

    // Sort reciprocal matches first
    formattedMatches.sort((a, b) => {
      if (a.isReciprocal && !b.isReciprocal) return -1;
      if (!a.isReciprocal && b.isReciprocal) return 1;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({
      success: true,
      matches: formattedMatches
    });

  } catch (error) {
    console.error('Error fetching matches:', error);
    return res.status(500).json({
      success: false,
      message: 'A database error occurred while finding matches.'
    });
  }
});

module.exports = router;

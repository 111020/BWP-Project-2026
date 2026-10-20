const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * Authentication Middleware
 * Ensures the student has an active session before accessing skill endpoints.
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
 * GET /api/skills
 * Fetches all skills (offered and wanted) linked to the authenticated student.
 * Joins user_skills with skills, maps database types ('offer'/'learn') to
 * frontend types ('offered'/'wanted'), and returns a JSON list.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [rows] = await pool.execute(
      `SELECT 
        us.id,
        us.skill_id,
        us.skill_type,
        us.created_at,
        s.name
       FROM user_skills us
       JOIN skills s ON us.skill_id = s.id
       WHERE us.user_id = ?
       ORDER BY us.created_at DESC, us.id DESC`,
      [userId]
    );

    const formattedSkills = rows.map(row => ({
      id: row.id,
      _id: row.id,
      skill_id: row.skill_id,
      name: row.name,
      type: row.skill_type === 'offer' ? 'offered' : 'wanted',
      skill_type: row.skill_type,
      category: 'General',
      level: 'Intermediate',
      description: '',
      created_at: row.created_at
    }));

    return res.status(200).json(formattedSkills);

  } catch (error) {
    console.error('Error fetching skills:', error);
    return res.status(500).json({
      success: false,
      message: 'A database error occurred while retrieving skills.'
    });
  }
});

/**
 * POST /api/skills
 * Adds a new skill link for the authenticated student.
 * Validates inputs, maps frontend type ('offered'/'wanted') to DB enum ('offer'/'learn'),
 * finds or inserts the skill name into the skills table, and creates a link in user_skills.
 * Wrapped in a transaction to guarantee data integrity.
 */
router.post('/', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { name, type, category, level, description } = req.body;

  const skillName = (name || '').trim();
  if (!skillName) {
    return res.status(400).json({
      success: false,
      message: 'Skill name is required.'
    });
  }

  // Map frontend types to database enum ('offer' | 'learn')
  const rawType = (type || '').trim().toLowerCase();
  let dbSkillType;
  let frontendType;

  if (rawType === 'offered' || rawType === 'offer' || rawType === 'teach') {
    dbSkillType = 'offer';
    frontendType = 'offered';
  } else if (rawType === 'wanted' || rawType === 'learn' || rawType === 'want') {
    dbSkillType = 'learn';
    frontendType = 'wanted';
  } else {
    return res.status(400).json({
      success: false,
      message: 'Invalid skill type. Expected "offered" or "wanted".'
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Find existing skill or insert into skills table
    let skillId;
    let exactSkillName = skillName;

    const [existingSkills] = await connection.execute(
      'SELECT id, name FROM skills WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [skillName]
    );

    if (existingSkills.length > 0) {
      skillId = existingSkills[0].id;
      exactSkillName = existingSkills[0].name;
    } else {
      try {
        const [insertSkillResult] = await connection.execute(
          'INSERT INTO skills (name) VALUES (?)',
          [skillName]
        );
        skillId = insertSkillResult.insertId;
      } catch (insertErr) {
        // Handle concurrent insertion race condition
        if (insertErr.code === 'ER_DUP_ENTRY' || insertErr.errno === 1062) {
          const [retryRows] = await connection.execute(
            'SELECT id, name FROM skills WHERE LOWER(name) = LOWER(?) LIMIT 1',
            [skillName]
          );
          if (retryRows.length > 0) {
            skillId = retryRows[0].id;
            exactSkillName = retryRows[0].name;
          } else {
            throw insertErr;
          }
        } else {
          throw insertErr;
        }
      }
    }

    // 2. Prevent duplicate links for the same student, skill, and skill_type
    const [existingLink] = await connection.execute(
      'SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ? AND skill_type = ? LIMIT 1',
      [userId, skillId, dbSkillType]
    );

    if (existingLink.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: `You have already added "${exactSkillName}" under skills ${frontendType}.`
      });
    }

    // 3. Insert link into user_skills table
    const [insertLinkResult] = await connection.execute(
      'INSERT INTO user_skills (user_id, skill_id, skill_type) VALUES (?, ?, ?)',
      [userId, skillId, dbSkillType]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Skill added successfully.',
      skill: {
        id: insertLinkResult.insertId,
        _id: insertLinkResult.insertId,
        skill_id: skillId,
        name: exactSkillName,
        type: frontendType,
        skill_type: dbSkillType,
        category: category || 'General',
        level: level || 'Intermediate',
        description: description || ''
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error adding skill:', error);
    return res.status(500).json({
      success: false,
      message: 'A database error occurred while adding the skill.'
    });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/skills/:id
 * Removes a skill link for the authenticated student.
 * Uses user_skills.id as the link ID and ensures users can only delete their own links.
 * Does not delete the shared skill record from the skills table.
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    const userId = req.session.user.id;

    if (isNaN(linkId) || linkId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid skill ID.'
      });
    }

    const [deleteResult] = await pool.execute(
      'DELETE FROM user_skills WHERE id = ? AND user_id = ?',
      [linkId, userId]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Skill not found or you are not authorized to delete it.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Skill removed successfully.'
    });

  } catch (error) {
    console.error('Error deleting skill:', error);
    return res.status(500).json({
      success: false,
      message: 'A database error occurred while removing the skill.'
    });
  }
});

module.exports = router;

const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * Authentication Middleware
 * Ensures the student has an active session before accessing session endpoints.
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
 * Helper to parse meeting preference and user note from stored message string.
 * Example format: "[Mode: Online Video Call] Let's discuss React hooks."
 */
function parseMessageAndMode(rawMessage) {
  let mode = 'In-person';
  let message = '';

  if (!rawMessage) {
    return { mode, message };
  }

  const str = String(rawMessage).trim();
  const match = str.match(/^\[Mode:\s*([^\]]+)\]\s*(.*)$/s);
  if (match) {
    mode = match[1].trim();
    message = match[2].trim();
  } else {
    message = str;
  }

  return { mode, message };
}

/**
 * Helper to format meeting preference and user note for database storage.
 */
function formatMessageWithMode(mode, userMessage) {
  const cleanMode = mode ? String(mode).trim() : 'In-person';
  const cleanMessage = userMessage ? String(userMessage).trim() : '';

  if (cleanMessage) {
    return `[Mode: ${cleanMode}] ${cleanMessage}`;
  }
  return `[Mode: ${cleanMode}]`;
}

/**
 * GET /api/sessions
 * Returns all session requests where the logged-in student is either requester or receiver.
 * Formatted for sessions.html and dashboard.html compatibility.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id;

    // Join users table twice (for requester and receiver) and skills table once
    const [rows] = await pool.execute(
      `SELECT 
        sr.id,
        sr.requester_id,
        sr.receiver_id,
        sr.skill_id,
        DATE_FORMAT(sr.proposed_datetime, '%Y-%m-%d') AS proposed_date,
        DATE_FORMAT(sr.proposed_datetime, '%H:%i') AS proposed_time,
        sr.proposed_datetime,
        sr.message,
        sr.status,
        sr.created_at,
        s.name AS skill_name,
        u_req.full_name AS requester_name,
        u_req.department AS requester_dept,
        u_recv.full_name AS receiver_name,
        u_recv.department AS receiver_dept
       FROM session_requests sr
       JOIN users u_req ON sr.requester_id = u_req.id
       JOIN users u_recv ON sr.receiver_id = u_recv.id
       JOIN skills s ON sr.skill_id = s.id
       WHERE sr.requester_id = ? OR sr.receiver_id = ?
       ORDER BY sr.created_at DESC, sr.id DESC`,
      [currentUserId, currentUserId]
    );

    // Format each record according to frontend expectations
    const formattedSessions = rows.map(row => {
      const isRequester = Number(row.requester_id) === Number(currentUserId);
      const partnerId = isRequester ? row.receiver_id : row.requester_id;
      const partnerName = isRequester ? row.receiver_name : row.requester_name;
      const partnerDept = isRequester ? row.receiver_dept : row.requester_dept;
      const role = isRequester ? 'You are Learning' : 'You are Teaching';

      const { mode, message } = parseMessageAndMode(row.message);

      // Determine display status (map rejected to cancelled if flagged as cancelled by requester)
      let displayStatus = row.status;
      if (row.status === 'rejected' && message.includes('[Cancelled]')) {
        displayStatus = 'cancelled';
      }

      // Clean internal tag from visible note
      const cleanMessage = message.replace(/\[Cancelled\]/g, '').trim();

      return {
        id: row.id,
        _id: row.id,
        requesterId: row.requester_id,
        receiverId: row.receiver_id,
        partnerId: partnerId,
        partnerName: partnerName || 'Peer Student',
        partnerDept: partnerDept || 'Student',
        skillId: row.skill_id,
        skillName: row.skill_name || 'Skill Exchange',
        proposedDate: row.proposed_date,
        proposedTime: row.proposed_time,
        date: row.proposed_date,
        time: row.proposed_time,
        mode: mode,
        message: cleanMessage,
        role: role,
        isRequester: isRequester,
        status: displayStatus,
        createdAt: row.created_at
      };
    });

    return res.status(200).json(formattedSessions);

  } catch (error) {
    console.error('Error fetching session requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve session requests from database.'
    });
  }
});

/**
 * POST /api/sessions
 * Submits a new peer learning session request from matches.html.
 * Validates inputs, confirms receiver offers the skill, and creates a pending record.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const requesterId = req.session.user.id;
    const { partnerId, skillId, proposedDate, proposedTime, mode, message } = req.body;

    // 1. Validate required fields
    if (!partnerId || !skillId || !proposedDate || !proposedTime) {
      return res.status(400).json({
        success: false,
        message: 'Partner ID, skill ID, proposed date, and proposed time are required.'
      });
    }

    const receiverId = parseInt(partnerId, 10);
    const parsedSkillId = parseInt(skillId, 10);

    if (isNaN(receiverId) || isNaN(parsedSkillId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid partner ID or skill ID.'
      });
    }

    // 2. Prevent self-requests
    if (receiverId === requesterId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot request a session with yourself.'
      });
    }

    // 3. Validate proposed date and time
    const combinedDatetimeStr = `${proposedDate} ${proposedTime}:00`;
    const parsedDate = new Date(`${proposedDate}T${proposedTime}`);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid proposed date or time.'
      });
    }

    // 4. Confirm receiver student exists in database
    const [receiverRows] = await pool.execute(
      'SELECT id, full_name, department FROM users WHERE id = ?',
      [receiverId]
    );
    if (receiverRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'The requested peer student does not exist.'
      });
    }

    // 5. Confirm requested skill exists in database
    const [skillRows] = await pool.execute(
      'SELECT id, name FROM skills WHERE id = ?',
      [parsedSkillId]
    );
    if (skillRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'The requested skill does not exist.'
      });
    }

    // 6. Confirm receiver student offers to teach this skill
    const [offerRows] = await pool.execute(
      "SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ? AND skill_type = 'offer' LIMIT 1",
      [receiverId, parsedSkillId]
    );
    if (offerRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'The selected peer student does not offer instruction for this skill.'
      });
    }

    // 7. Check if a pending session request already exists for this pair and skill
    const [existingPending] = await pool.execute(
      "SELECT id FROM session_requests WHERE requester_id = ? AND receiver_id = ? AND skill_id = ? AND status = 'pending' LIMIT 1",
      [requesterId, receiverId, parsedSkillId]
    );
    if (existingPending.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A pending session request for this skill with this student already exists.'
      });
    }

    // 8. Format mode and message for storage
    const formattedMessage = formatMessageWithMode(mode, message);

    // 9. Insert new pending request using parameterized query
    const [insertResult] = await pool.execute(
      `INSERT INTO session_requests (requester_id, receiver_id, skill_id, proposed_datetime, message, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [requesterId, receiverId, parsedSkillId, combinedDatetimeStr, formattedMessage]
    );

    return res.status(201).json({
      success: true,
      message: 'Session request sent successfully.',
      requestId: insertResult.insertId,
      session: {
        id: insertResult.insertId,
        requesterId: requesterId,
        receiverId: receiverId,
        skillId: parsedSkillId,
        proposedDatetime: combinedDatetimeStr,
        status: 'pending'
      }
    });

  } catch (error) {
    console.error('Error creating session request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create session request in database.'
    });
  }
});

/**
 * PATCH /api/sessions/:id/status
 * Updates the status of an existing session request (accept, decline, cancel, complete).
 * Validates participant permissions and enforces legitimate state transitions.
 */
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id;
    const sessionId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (isNaN(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session request ID.'
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required.'
      });
    }

    const inputStatus = String(status).toLowerCase().trim();
    const validStatuses = ['accepted', 'rejected', 'declined', 'cancelled', 'completed'];

    if (!validStatuses.includes(inputStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value provided.'
      });
    }

    // 1. Fetch current session request from database
    const [rows] = await pool.execute(
      'SELECT id, requester_id, receiver_id, skill_id, status, message FROM session_requests WHERE id = ?',
      [sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session request not found.'
      });
    }

    const sessionReq = rows[0];
    const isRequester = Number(sessionReq.requester_id) === Number(currentUserId);
    const isReceiver = Number(sessionReq.receiver_id) === Number(currentUserId);

    // 2. Ensure only participants can update the session
    if (!isRequester && !isReceiver) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this session request.'
      });
    }

    // 3. Disallow modifications on terminal states
    if (sessionReq.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Completed sessions cannot be modified.'
      });
    }

    if (sessionReq.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Declined or cancelled sessions cannot be modified.'
      });
    }

    let targetDbStatus = '';
    let updatedMessage = sessionReq.message || '';

    // 4. Handle status transitions based on current status and user role
    if (sessionReq.status === 'pending') {
      if (isReceiver) {
        // Receiver can accept or decline
        if (inputStatus === 'accepted') {
          targetDbStatus = 'accepted';
        } else if (inputStatus === 'rejected' || inputStatus === 'declined') {
          targetDbStatus = 'rejected';
        } else {
          return res.status(400).json({
            success: false,
            message: 'As the receiver, you can only accept or decline a pending session request.'
          });
        }
      } else if (isRequester) {
        // Requester can only cancel their own pending request
        if (inputStatus === 'cancelled' || inputStatus === 'rejected') {
          targetDbStatus = 'rejected';
          if (!updatedMessage.includes('[Cancelled]')) {
            updatedMessage = `${updatedMessage} [Cancelled]`.trim();
          }
        } else {
          return res.status(400).json({
            success: false,
            message: 'As the requester, you can only cancel your pending session request.'
          });
        }
      }
    } else if (sessionReq.status === 'accepted') {
      // Either participant can mark an accepted session as completed
      if (inputStatus === 'completed') {
        targetDbStatus = 'completed';
      } else if (inputStatus === 'cancelled' || inputStatus === 'rejected') {
        targetDbStatus = 'rejected';
        if (!updatedMessage.includes('[Cancelled]')) {
          updatedMessage = `${updatedMessage} [Cancelled]`.trim();
        }
      } else {
        return res.status(400).json({
          success: false,
          message: 'Accepted sessions can only be marked as completed or cancelled.'
        });
      }
    }

    // 5. Update database record using parameterized query
    await pool.execute(
      'UPDATE session_requests SET status = ?, message = ? WHERE id = ?',
      [targetDbStatus, updatedMessage, sessionId]
    );

    return res.status(200).json({
      success: true,
      message: `Session request successfully updated to ${inputStatus}.`,
      status: targetDbStatus,
      displayStatus: inputStatus
    });

  } catch (error) {
    console.error('Error updating session status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update session request status in database.'
    });
  }
});

module.exports = router;

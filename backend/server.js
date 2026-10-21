const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pool = require('./db');
const authRoutes = require('./routes/auth');
const skillRoutes = require('./routes/skills');
const matchRoutes = require('./routes/matches');
const sessionRoutes = require('./routes/sessions');
const profileRoutes = require('./routes/profile');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

// Enable Cross-Origin Resource Sharing (CORS) with credentials support
// Explicitly reflect the request origin for localhost (required for credentials: 'include')
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g. curl, Postman) or any localhost origin
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Enable JSON and URL-encoded request body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure session middleware using express-session
app.use(session({
  secret: process.env.SESSION_SECRET || 'campusskillconnect_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if running with HTTPS
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Global middleware to support both session cookies AND Bearer tokens across all routes
app.use(async (req, res, next) => {
  if (req.session && req.session.user && req.session.user.id) {
    return next();
  }

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
          'SELECT id, full_name, email, department, academic_year FROM users WHERE id = ? LIMIT 1',
          [userId]
        );
        if (rows.length > 0) {
          const student = rows[0];
          req.session.user = {
            id: student.id,
            name: student.full_name,
            full_name: student.full_name,
            email: student.email,
            department: student.department,
            year: student.academic_year,
            academic_year: student.academic_year
          };
        }
      } catch (err) {
        console.error('Session restoration error:', err);
      }
    }
  }
  next();
});

// Authentication routes
app.use('/api/auth', authRoutes);

// Skills routes
app.use('/api/skills', skillRoutes);

// Matching routes
app.use('/api/matches', matchRoutes);

// Session requests routes
app.use('/api/sessions', sessionRoutes);

// Student profile routes (GET and PUT /api/profile, GET /api/profile/export)
app.use('/api/profile', profileRoutes);

// Health check endpoint (accurately verifies backend & MySQL database connectivity)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1 AS connected');
    return res.status(200).json({
      status: 'ok',
      database: 'connected',
      message: 'CampusSkillConnect backend and database are running'
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    return res.status(503).json({
      status: 'error',
      database: 'disconnected',
      message: 'Database connection failed'
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server started successfully on port ${PORT}`);
  console.log(`Health check endpoint available at: http://localhost:${PORT}/api/health`);
  console.log(`Auth endpoints available at: http://localhost:${PORT}/api/auth`);
  console.log(`Skills endpoints available at: http://localhost:${PORT}/api/skills`);
  console.log(`Matches endpoints available at: http://localhost:${PORT}/api/matches`);
  console.log(`Sessions endpoints available at: http://localhost:${PORT}/api/sessions`);
});

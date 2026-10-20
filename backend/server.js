const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const authRoutes = require('./routes/auth');
const skillRoutes = require('./routes/skills');
const matchRoutes = require('./routes/matches');
const sessionRoutes = require('./routes/sessions');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

// Enable Cross-Origin Resource Sharing (CORS) with credentials support
app.use(cors({
  origin: true,
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
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication routes
app.use('/api/auth', authRoutes);

// Skills routes
app.use('/api/skills', skillRoutes);

// Matching routes
app.use('/api/matches', matchRoutes);

// Session requests routes
app.use('/api/sessions', sessionRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'CampusSkillConnect backend is running'
  });
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

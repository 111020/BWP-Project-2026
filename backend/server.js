const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = 5000;

// Enable Cross-Origin Resource Sharing (CORS) for frontend requests
app.use(cors());

// Enable JSON request parsing
app.use(express.json());

// Authentication routes
app.use('/api/auth', authRoutes);

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
});

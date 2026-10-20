const mysql = require('mysql2/promise');
const path = require('path');

// Load environment variables from .env in the project root
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Create a reusable MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function setupSkillSharingDB() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3307;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'skill_sharing';

  console.log(`Connecting to MySQL on ${host}:${port}...`);
  const conn = await mysql.createConnection({ host, port, user, password });

  console.log(`Creating database '${database}' if not exists...`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
  await conn.query(`USE \`${database}\`;`);

  // 1. Users table
  console.log("Creating 'users' table...");
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`full_name\` VARCHAR(255) NOT NULL,
      \`email\` VARCHAR(255) UNIQUE NOT NULL,
      \`password_hash\` VARCHAR(255) NOT NULL,
      \`department\` VARCHAR(100) NOT NULL,
      \`academic_year\` INT NOT NULL,
      \`bio\` TEXT,
      \`learning_goals\` TEXT,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 2. Skills table (with 'name' column for Vrund's code)
  console.log("Creating 'skills' table...");
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`skills\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(255) NOT NULL UNIQUE,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 3. User_skills junction table
  console.log("Creating 'user_skills' table...");
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`user_skills\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` INT NOT NULL,
      \`skill_id\` INT NOT NULL,
      \`skill_type\` ENUM('offer', 'learn') NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY \`unique_user_skill\` (\`user_id\`, \`skill_id\`, \`skill_type\`),
      INDEX (\`user_id\`),
      INDEX (\`skill_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 4. Session_requests table
  console.log("Creating 'session_requests' table...");
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`session_requests\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`requester_id\` INT NOT NULL,
      \`receiver_id\` INT NOT NULL,
      \`skill_id\` INT NOT NULL,
      \`proposed_datetime\` DATETIME,
      \`message\` TEXT,
      \`status\` ENUM('pending', 'accepted', 'completed', 'declined', 'cancelled') DEFAULT 'pending',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (\`requester_id\`),
      INDEX (\`receiver_id\`),
      INDEX (\`skill_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Copy any registered users from campusskillconnect into skill_sharing so user doesn't lose their login!
  try {
    await conn.query(`
      INSERT IGNORE INTO \`${database}\`.users (id, full_name, email, password_hash, department, academic_year, bio, learning_goals, created_at)
      SELECT id, full_name, email, password_hash, department, academic_year, bio, learning_goals, created_at
      FROM campusskillconnect.users;
    `);
    console.log("Copied registered users into skill_sharing database.");
  } catch (e) {
    console.log("No previous users to copy or already copied.");
  }

  console.log(`Database '${database}' is fully initialized and ready!`);
  await conn.end();
}

setupSkillSharingDB().catch(err => {
  console.error("Setup error:", err);
  process.exit(1);
});

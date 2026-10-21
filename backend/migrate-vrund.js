const pool = require('./db');

async function migrate() {
  try {
    console.log("Migrating database tables for Vrund's routes...");

    // 1. Ensure 'name' exists in skills table
    try {
      await pool.query('ALTER TABLE skills ADD COLUMN name VARCHAR(255) UNIQUE AFTER id;');
      console.log("Added column 'name' to skills.");
    } catch (e) {
      // Column might already exist
    }

    try {
      await pool.query("UPDATE skills SET name = title WHERE (name IS NULL OR name = '') AND title IS NOT NULL;");
      console.log("Updated skills name from title.");
    } catch (e) {
      // Ignore
    }

    // 2. Create user_skills table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_skills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        skill_id INT NOT NULL,
        skill_type ENUM('offer', 'learn') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (skill_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Verified 'user_skills' table.");

    // 3. Migrate any existing skills into user_skills
    const [existing] = await pool.query("SELECT id, user_id, type FROM skills WHERE user_id IS NOT NULL;");
    for (const s of existing) {
      const dbType = String(s.type).toLowerCase().includes('offer') ? 'offer' : 'learn';
      const [check] = await pool.query("SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ? LIMIT 1", [s.user_id, s.id]);
      if (check.length === 0) {
        await pool.query("INSERT INTO user_skills (user_id, skill_id, skill_type) VALUES (?, ?, ?)", [s.user_id, s.id, dbType]);
      }
    }
    console.log("Synced existing skills into 'user_skills'.");

    // 4. Create session_requests table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        requester_id INT NOT NULL,
        receiver_id INT NOT NULL,
        skill_id INT NOT NULL,
        proposed_datetime DATETIME,
        message TEXT,
        status ENUM('pending', 'accepted', 'completed', 'declined', 'cancelled') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (requester_id),
        INDEX (receiver_id),
        INDEX (skill_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Verified 'session_requests' table.");

    console.log("Database schema successfully synchronized with Vrund's code!");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await pool.end();
  }
}

migrate();

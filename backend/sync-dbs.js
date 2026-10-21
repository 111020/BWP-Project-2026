const mysql = require('mysql2/promise');

async function copyUser() {
  const p3307 = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'skill_sharing' });
  const p3306 = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'skill_sharing' });

  const [users] = await p3307.query('SELECT * FROM users');
  for (const u of users) {
    await p3306.query(
      'INSERT INTO users (id, full_name, email, password_hash, department, academic_year, bio, learning_goals, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), department=VALUES(department)',
      [u.id, u.full_name, u.email, u.password_hash, u.department, u.academic_year, u.bio, u.learning_goals, u.created_at]
    );
  }

  // Also copy Java skill and user_skills link
  await p3306.query("INSERT IGNORE INTO skills (id, name) VALUES (1, 'Java')");
  await p3306.query("INSERT IGNORE INTO user_skills (id, user_id, skill_id, skill_type) VALUES (1, 3, 1, 'offer')");

  console.log('User and skills successfully copied to port 3306 skill_sharing!');
  await p3307.end();
  await p3306.end();
}

copyUser().catch(console.error);

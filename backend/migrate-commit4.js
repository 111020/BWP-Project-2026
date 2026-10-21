const mysql = require('mysql2/promise');

async function migrate() {
  for (const port of [3306, 3307]) {
    try {
      const c = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '', database: 'skill_sharing' });
      try { await c.query('ALTER TABLE users ADD COLUMN mobile_number VARCHAR(30)'); } catch(e){}
      try { await c.query('ALTER TABLE users ADD COLUMN goals TEXT'); } catch(e){}
      try { await c.query("UPDATE users SET goals = learning_goals WHERE (goals IS NULL OR goals = '') AND learning_goals IS NOT NULL"); } catch(e){}
      console.log(`Port ${port} users table successfully updated!`);
      await c.end();
    } catch(e) {
      console.log(`Port ${port} error:`, e.message);
    }
  }
}

migrate();

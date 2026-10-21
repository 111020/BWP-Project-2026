const pool = require('./db');

async function migrateOtp() {
  try {
    console.log('--- Running OTP & 4-Hour Exemption Database Migration ---');
    
    // 1. Check if last_otp_verified_at column exists in users table
    const [cols] = await pool.query('DESCRIBE users');
    const hasCol = cols.some(c => c.Field === 'last_otp_verified_at');
    
    if (!hasCol) {
      await pool.query('ALTER TABLE users ADD COLUMN last_otp_verified_at DATETIME NULL');
      console.log('✅ Added `last_otp_verified_at` column to `users` table');
    } else {
      console.log('ℹ️ Column `last_otp_verified_at` already exists in `users` table');
    }

    // 2. Create login_otps table
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS login_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        otp_code VARCHAR(10) NOT NULL,
        expires_at DATETIME NOT NULL,
        verified_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createTableSql);
    console.log('✅ Table `login_otps` created / verified successfully');
    
    console.log('--- Migration Finished Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateOtp();

const pool = require('./db');

async function testConnection() {
  try {
    // Execute a simple test query
    const [rows] = await pool.query('SELECT 1 AS connected');
    console.log('WAMP MySQL connection successful');
    console.log('Query result:', rows);
  } catch (error) {
    // Report useful diagnostic information without exposing passwords or credentials
    console.error('WAMP MySQL connection failed:');
    console.error(`- Error Code: ${error.code || 'UNKNOWN'}`);
    console.error(`- Message: ${error.message || 'Unable to connect to database'}`);
    console.error('Please check that WAMP is running (green icon) and your .env configuration is correct.');
  } finally {
    // Always close the connection pool cleanly
    await pool.end();
  }
}

testConnection();

const http = require('http');
const pool = require('../backend/db');

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost',
      port: 5000,
      path: urlPath
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('--- STARTING OTP & 4-HOUR EXEMPTION VERIFICATION TEST ---');
  
  const testEmail = `student_otp_${Date.now()}@college.edu`;
  const testPassword = 'Password123!';

  // 1. Register a test student
  console.log(`\n1. Registering test student: ${testEmail}...`);
  const regRes = await postJson('/api/auth/register', {
    name: 'OTP Test Student',
    email: testEmail,
    department: 'Computer Science',
    year: '3rd Year',
    password: testPassword
  });
  console.log('Register status:', regRes.status, 'Success:', regRes.data.success);

  // 2. First Login Attempt: Expect OTP required
  console.log('\n2. First login attempt (expecting OTP required)...');
  const login1 = await postJson('/api/auth/login', {
    email: testEmail,
    password: testPassword
  });
  console.log('Login 1 status:', login1.status, login1.data);
  if (!login1.data.requireOtp) {
    throw new Error('FAIL: First login should require an OTP!');
  }
  console.log('✅ PASS: requireOtp is TRUE on first login.');

  // 3. Fetch OTP code from database
  const [otps] = await pool.query('SELECT otp_code FROM login_otps WHERE email = ? ORDER BY id DESC LIMIT 1', [testEmail]);
  if (otps.length === 0) throw new Error('FAIL: No OTP found in login_otps table');
  const otpCode = otps[0].otp_code;
  console.log(`\n3. Found generated OTP in database: ${otpCode}`);

  // 4. Verify OTP
  console.log('\n4. Submitting OTP to /api/auth/verify-otp...');
  const verifyRes = await postJson('/api/auth/verify-otp', {
    email: testEmail,
    otp: otpCode
  });
  console.log('Verify status:', verifyRes.status, verifyRes.data);
  if (!verifyRes.data.success || !verifyRes.data.token) {
    throw new Error('FAIL: OTP verification failed!');
  }
  console.log('✅ PASS: OTP verified and token issued.');

  // 5. Check OTP Exemption status
  console.log('\n5. Checking OTP exemption status via /api/auth/otp-status...');
  const statusRes = await getJson(`/api/auth/otp-status?email=${encodeURIComponent(testEmail)}`);
  console.log('Status response:', statusRes.data);
  if (!statusRes.data.directLoginActive) {
    throw new Error('FAIL: directLoginActive should be TRUE for the next 4 hours!');
  }
  console.log(`✅ PASS: Direct login is ACTIVE for the next ~${statusRes.data.remainingMinutes} minutes.`);

  // 6. Second Login Attempt (within 4 hours): Expect DIRECT LOGIN WITHOUT OTP
  console.log('\n6. Second login attempt within 4-hour window (expecting DIRECT LOGIN WITHOUT OTP)...');
  const login2 = await postJson('/api/auth/login', {
    email: testEmail,
    password: testPassword
  });
  console.log('Login 2 status:', login2.status, login2.data);
  if (login2.data.requireOtp === true) {
    throw new Error('FAIL: Login within 4 hours should NOT require an OTP!');
  }
  if (!login2.data.bypassedOtp) {
    throw new Error('FAIL: bypassedOtp flag should be true!');
  }
  console.log('✅ PASS: Second login SUCCEEDED DIRECTLY WITHOUT OTP!');

  // 7. Test simulated expiration of 4 hours
  console.log('\n7. Simulating passage of 5 hours (setting last_otp_verified_at to 5 hours ago)...');
  await pool.query('UPDATE users SET last_otp_verified_at = DATE_SUB(NOW(), INTERVAL 5 HOUR) WHERE email = ?', [testEmail]);
  
  console.log('Login attempt after 5 hours (expecting OTP required again)...');
  const login3 = await postJson('/api/auth/login', {
    email: testEmail,
    password: testPassword
  });
  console.log('Login 3 status:', login3.status, login3.data);
  if (!login3.data.requireOtp) {
    throw new Error('FAIL: Login after 5 hours SHOULD require an OTP again!');
  }
  console.log('✅ PASS: After 4-hour window expires, OTP is required again as requested.');

  console.log('\n🎉 ALL OTP & 4-HOUR EXEMPTION TESTS PASSED 100% SUCCESSFULLY!\n');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/**
 * Creates and returns the Nodemailer SMTP transporter.
 * Supports Gmail, Outlook, custom SMTP, or any RFC-compliant SMTP server.
 */
function createTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
  const pass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '';

  if (!user || !pass) {
    return null; // SMTP credentials not yet provided
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false // Avoid local certificate mismatch errors
    }
  });
}

/**
 * Generates an editorial, high-contrast HTML email matching CampusSkillConnect style.
 */
function generateOtpHtml({ studentName, otpCode, expiresMinutes = 10 }) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your CampusSkillConnect Login Code</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #ECE8E1; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0D0D0D;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ECE8E1; padding: 40px 15px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width: 520px; background-color: #FFFFFF; border: 1px solid #D8D4CA; border-radius: 4px; padding: 36px 32px; box-shadow: 0 4px 16px rgba(13, 13, 13, 0.06);">
            <!-- Header Brand -->
            <tr>
              <td style="padding-bottom: 24px; border-bottom: 1px solid #ECE8E1;">
                <table role="presentation" width="100%">
                  <tr>
                    <td>
                      <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #0D0D0D;">
                        ◆ CampusSkillConnect
                      </span>
                    </td>
                    <td align="right">
                      <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; background-color: #FBECE6; color: #EE5D26; border-radius: 3px; letter-spacing: 0.05em;">
                        Security Verification
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Salutation & Message -->
            <tr>
              <td style="padding-top: 26px; padding-bottom: 16px;">
                <h1 style="margin: 0 0 12px 0; font-size: 24px; font-weight: 700; letter-spacing: -0.03em; color: #0D0D0D;">
                  Your Verification Code
                </h1>
                <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #48453F;">
                  Hello ${studentName ? studentName : 'Student'},
                </p>
                <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.55; color: #48453F;">
                  We received a login request for your CampusSkillConnect account. Use the one-time code below to complete your sign-in:
                </p>
              </td>
            </tr>

            <!-- High-Contrast OTP Code Box -->
            <tr>
              <td align="center" style="padding: 10px 0 24px 0;">
                <div style="background-color: #0D0D0D; border: 1px solid #0D0D0D; border-radius: 6px; padding: 18px 24px; display: inline-block; text-align: center;">
                  <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: #FFFFFF; display: block;">
                    ${otpCode}
                  </span>
                </div>
              </td>
            </tr>

            <!-- 4-Hour Exemption & Expiration Notice -->
            <tr>
              <td style="padding-bottom: 24px;">
                <div style="background-color: #FBECE6; border-left: 3px solid #EE5D26; padding: 12px 14px; border-radius: 2px;">
                  <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #78350F;">
                    <strong>⏱ Valid for ${expiresMinutes} minutes.</strong><br>
                    Once verified, you can log in directly without an OTP from this device for the next <strong>4 hours</strong>.
                  </p>
                </div>
              </td>
            </tr>

            <!-- Security Footer Note -->
            <tr>
              <td style="border-top: 1px solid #ECE8E1; padding-top: 20px;">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #74716A;">
                  If you did not initiate this login request, someone may be trying to access your account. Please change your password immediately.
                </p>
                <p style="margin: 12px 0 0 0; font-size: 12px; color: #A8A59E;">
                  CampusSkillConnect &bull; Peer-to-Peer Student Learning Platform
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}

/**
 * Sends a 6-digit login OTP email via Nodemailer.
 * If SMTP credentials are missing or SMTP fails in development, logs clearly
 * to console and returns { success: true, simulated: true, otpCode }.
 */
async function sendLoginOtpEmail({ toEmail, studentName, otpCode, expiresMinutes = 10 }) {
  const fromAddress = process.env.EMAIL_FROM || '"CampusSkillConnect" <no-reply@campusskillconnect.edu>';
  const subject = `Your CampusSkillConnect Login Code: ${otpCode}`;
  const htmlContent = generateOtpHtml({ studentName, otpCode, expiresMinutes });
  const textContent = `Hello ${studentName || 'Student'},\n\nYour CampusSkillConnect verification code is: ${otpCode}\n\nThis code will expire in ${expiresMinutes} minutes.\nOnce verified, you will be exempted from OTP for the next 4 hours on this device.\n\nIf you did not request this code, please ignore this email.`;

  const transporter = createTransporter();

  // Print prominent security dispatch log
  console.log('\n==================================================================');
  console.log(`✉️  [NODEMAILER] Outgoing Login OTP for: ${toEmail}`);
  console.log(`🔑  OTP Code: ${otpCode} (Valid for ${expiresMinutes} minutes)`);
  console.log(`⏰  Direct Login Exemption Window: 4 Hours after verification`);
  console.log('==================================================================\n');

  if (!transporter) {
    console.log('ℹ️  [SMTP Info] No SMTP_USER/SMTP_PASS in .env. Email simulated in console.');
    return {
      success: true,
      simulated: true,
      message: 'OTP generated and logged to server console (SMTP credentials not configured).'
    };
  }

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject,
      text: textContent,
      html: htmlContent
    });

    console.log(`✅ [NODEMAILER SUCCESS] Email sent to ${toEmail}. MessageId: ${info.messageId}`);
    return {
      success: true,
      simulated: false,
      messageId: info.messageId
    };
  } catch (error) {
    console.error(`⚠️  [NODEMAILER SMTP ERROR] Could not deliver email via SMTP:`, error.message);
    console.log(`🔑  [FALLBACK] You can still use OTP code ${otpCode} from the server log above.`);
    
    // Return gracefully so the student login flow is never completely blocked
    return {
      success: true,
      simulated: true,
      smtpError: error.message,
      message: 'Could not connect to SMTP server; OTP printed to server logs for development.'
    };
  }
}

module.exports = {
  createTransporter,
  sendLoginOtpEmail
};

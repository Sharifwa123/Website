// Central mail sender. Uses SMTP via nodemailer — works with Gmail (with an App Password),
// Zoho, your own mail server, or any SMTP provider. Configure it once in .env; nothing here
// needs code changes for day-to-day use.
//
// If SMTP isn't configured yet, calls are logged to the console instead of throwing,
// so the rest of the site keeps working while you're still setting up email.

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // not configured yet
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465, // true for port 465, false for 587/25
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

/**
 * Send one email. Resolves even if SMTP isn't configured (logs instead) so the
 * calling route never crashes because mail isn't set up yet.
 */
async function sendMail({ to, subject, html, attachments }) {
  const t = getTransporter();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@shariftech.local';

  if (!t) {
    console.log('--- MAIL NOT SENT (SMTP not configured in .env) ---');
    console.log('To:', to, '| Subject:', subject);
    console.log(html.replace(/<[^>]+>/g, ' ').slice(0, 300));
    console.log('----------------------------------------------------');
    return { ok: false, reason: 'smtp_not_configured' };
  }

  try {
    await t.sendMail({ from, to, subject, html, attachments: attachments || [] });
    return { ok: true };
  } catch (err) {
    console.error('Mail send failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendMail, getTransporter };

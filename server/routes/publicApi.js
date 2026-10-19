const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { sendMail } = require('../lib/mailer');
const { messageImageUpload } = require('../middleware/uploads');

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- NEWSLETTER SUBSCRIPTION ----------

const subscribeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: { ok: false, error: 'Too many attempts. Please try again later.' }
});

router.post('/subscribe', subscribeLimiter, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  const existing = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);

  if (existing && existing.status === 'confirmed') {
    return res.json({ ok: true, message: "You're already subscribed — thanks for being here!" });
  }

  const confirmToken = crypto.randomBytes(24).toString('hex');
  const unsubscribeToken = existing ? existing.unsubscribe_token : crypto.randomBytes(24).toString('hex');

  if (existing) {
    db.prepare('UPDATE subscribers SET status = ?, confirm_token = ? WHERE id = ?').run(
      'pending', confirmToken, existing.id
    );
  } else {
    db.prepare(
      'INSERT INTO subscribers (email, status, confirm_token, unsubscribe_token) VALUES (?, ?, ?, ?)'
    ).run(email, 'pending', confirmToken, unsubscribeToken);
  }

  const confirmUrl = `${SITE_URL}/api/subscribe/confirm?token=${confirmToken}`;
  const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('site_name');
  const siteName = settings ? settings.value : 'SharifTech';

  await sendMail({
    to: email,
    subject: `Confirm your subscription to ${siteName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2>Confirm your subscription</h2>
        <p>Click the button below to start receiving updates from ${siteName}.</p>
        <p><a href="${confirmUrl}" style="background:#1c5cff;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;">Confirm Subscription</a></p>
        <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `
  });

  res.json({ ok: true, message: 'Almost there! Check your inbox to confirm your subscription.' });
});

router.get('/subscribe/confirm', (req, res) => {
  const { token } = req.query;
  const sub = db.prepare('SELECT * FROM subscribers WHERE confirm_token = ?').get(token);

  if (!sub) {
    return res.render('subscribe-result', { success: false, heading: 'Link Invalid', message: 'That confirmation link is invalid or has already been used.' });
  }

  db.prepare(
    "UPDATE subscribers SET status = 'confirmed', confirm_token = NULL, confirmed_at = datetime('now') WHERE id = ?"
  ).run(sub.id);

  res.render('subscribe-result', { success: true, heading: "You're In!", message: "You're subscribed! Thanks for joining us." });
});

router.get('/unsubscribe', (req, res) => {
  const { token } = req.query;
  const sub = db.prepare('SELECT * FROM subscribers WHERE unsubscribe_token = ?').get(token);

  if (!sub) {
    return res.render('subscribe-result', { success: false, heading: 'Link Invalid', message: 'That unsubscribe link is invalid.' });
  }

  db.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE id = ?").run(sub.id);
  res.render('subscribe-result', { success: true, heading: 'All Set', message: "You've been unsubscribed. We're sorry to see you go." });
});

// ---------- CONTACT / SUPPORT FORM ----------

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { ok: false, error: 'Too many messages sent. Please try again later.' }
});

router.post('/contact', contactLimiter, (req, res) => {
  messageImageUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    const { name, email, subject, body } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Please enter your name.' });
    if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    if (!body || !body.trim()) return res.status(400).json({ ok: false, error: 'Please enter a message.' });

    const attachmentPath = req.file ? req.file.filename : null;

    const info = db.prepare(
      `INSERT INTO messages (name, email, subject, body, attachment_path) VALUES (?, ?, ?, ?, ?)`
    ).run(name.trim().slice(0, 120), email.trim().slice(0, 160), (subject || '').trim().slice(0, 200), body.trim().slice(0, 5000), attachmentPath);

    const notifyEmail = process.env.CONTACT_NOTIFY_EMAIL;
    if (notifyEmail) {
      const attachments = req.file
        ? [{ filename: req.file.originalname, path: req.file.path }]
        : [];
      sendMail({
        to: notifyEmail,
        subject: `New message: ${subject || '(no subject)'} — from ${name}`,
        html: `
          <div style="font-family:sans-serif;">
            <p><strong>From:</strong> ${name} (${email})</p>
            <p><strong>Subject:</strong> ${subject || '(none)'}</p>
            <p><strong>Message:</strong></p>
            <p style="white-space:pre-wrap;">${body}</p>
            ${req.file ? '<p><em>An image is attached to this email.</em></p>' : ''}
          </div>
        `,
        attachments
      }).catch((e) => console.error('Contact notify email failed:', e.message));
    }

    res.json({ ok: true, message: "Thanks — your message was sent. We'll get back to you soon.", id: info.lastInsertRowid });
  });
});

module.exports = router;

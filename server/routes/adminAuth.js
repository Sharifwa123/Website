const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { redirectIfLoggedIn, requireAdmin } = require('../middleware/auth');

// Makes the site's logo/name available on admin pages too (login screen included),
// so a custom uploaded logo shows up everywhere, not just on the public site.
router.use((req, res, next) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => (settings[r.key] = r.value));
  res.locals.settings = settings;
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many login attempts. Please wait 15 minutes and try again.'
});

router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('admin/login', { error: null, layout: false });
});

router.post('/login', loginLimiter, redirectIfLoggedIn, (req, res) => {
  const { email, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get((email || '').trim());

  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).render('admin/login', {
      error: 'Incorrect email or password.',
      layout: false
    });
  }

  req.session.adminId = admin.id;
  req.session.adminName = admin.name;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/change-password', requireAdmin, (req, res) => {
  res.render('admin/change-password', { message: null, error: null });
});

router.post('/change-password', requireAdmin, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);

  if (!bcrypt.compareSync(current_password || '', admin.password_hash)) {
    return res.render('admin/change-password', { message: null, error: 'Current password is incorrect.' });
  }
  if (!new_password || new_password.length < 8) {
    return res.render('admin/change-password', { message: null, error: 'New password must be at least 8 characters.' });
  }
  if (new_password !== confirm_password) {
    return res.render('admin/change-password', { message: null, error: 'New passwords do not match.' });
  }

  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, admin.id);
  res.render('admin/change-password', { message: 'Password updated successfully.', error: null });
});

module.exports = router;

// Shared by server/routes/public.js's router-level middleware and the
// app-level 404/500 handlers in server/index.js (which run outside that
// router, so they can't rely on its res.locals middleware) -- both need the
// same settings/socials lookups to render the shared header/footer partials.
const db = require('../db/connection');

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  rows.forEach((r) => (obj[r.key] = r.value));
  return obj;
}

function getSocials() {
  return db
    .prepare('SELECT * FROM socials WHERE is_active = 1 ORDER BY sort_order ASC')
    .all();
}

module.exports = { getSettings, getSocials };

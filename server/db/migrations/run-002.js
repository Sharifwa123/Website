// Runs the dark theme feature migration against the real database file, using the
// same node:sqlite driver as the rest of the app -- no dependency on the sqlite3 CLI.
//
// USAGE: node server/db/migrations/run-002.js
//
// Safe to run more than once: uses INSERT OR IGNORE, so it never overwrites a value
// you've already changed from the dashboard.

const db = require('../connection');

console.log('Running dark theme feature migration...\n');

const before = db.prepare("SELECT 1 FROM settings WHERE key = 'theme_mode'").get();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('theme_mode', 'light')").run();
console.log(before ? '- setting "theme_mode" already exists, skipping.' : '✔ Added setting "theme_mode" = "light"');

console.log('\nMigration complete.');

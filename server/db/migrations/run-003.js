// Runs the UI Strings feature migration (Phase 1: public-facing pages) against the
// real database file -- creates the ui_strings table, then seeds it with every
// current default value extracted directly from the codebase.
//
// USAGE: node server/db/migrations/run-003.js
//
// Safe to run more than once: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE for every
// row, so re-running this after an admin has already edited some strings will never
// overwrite their edits, and will only add any NEW string keys introduced by a future
// code update that this script doesn't yet know about.

const fs = require('fs');
const path = require('path');
const db = require('../connection');

console.log('Running UI Strings migration (Phase 1: public pages)...\n');

db.exec(`
CREATE TABLE IF NOT EXISTS ui_strings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  string_key    TEXT NOT NULL UNIQUE,
  page_group    TEXT NOT NULL,
  default_value TEXT NOT NULL,
  value         TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ui_strings_group ON ui_strings(page_group);
`);
console.log('✔ ui_strings table ready.');

const seedSql = fs.readFileSync(path.join(__dirname, '003b_ui_strings_seed.sql'), 'utf8');
const before = db.prepare('SELECT COUNT(*) c FROM ui_strings').get().c;
db.exec(seedSql);
const after = db.prepare('SELECT COUNT(*) c FROM ui_strings').get().c;

console.log(`✔ Seed complete. ${before} rows before, ${after} rows after (${after - before} new).`);
console.log('\nMigration complete. All strings currently show their default (English) text');
console.log('until edited from Admin > Settings > UI Text (Phase 2 will add that editor).');

// Runs the AI content module migration against the real database file, using the
// exact same node:sqlite driver the app itself uses (server/db/connection.js) --
// so there's no dependency on the sqlite3 CLI being installed on your VPS.
//
// This is a manual, one-time script. It is NOT run automatically on server startup.
//
// USAGE (run this yourself, once, from the project root):
//   1. Back up first:
//        cp server/db/shariftech.sqlite3 server/db/shariftech.sqlite3.pre-ai-migration.bak
//   2. Run:
//        node server/db/migrations/run-001.js
//
// Safe to run more than once: every statement either uses IF NOT EXISTS, or is
// wrapped so an "already exists" / "duplicate column" error is reported but does not
// stop the script or corrupt anything -- SQLite ALTER TABLE ADD COLUMN has no
// IF NOT EXISTS form, so this script checks column existence first instead.

const fs = require('fs');
const path = require('path');
const db = require('../connection');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function tableExists(name) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

console.log('Running AI content module migration...\n');

// ---------- New tables ----------
const newTablesSql = `
CREATE TABLE IF NOT EXISTS prompt_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type  TEXT NOT NULL,
  name          TEXT NOT NULL,
  template_text TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_type ON prompt_templates(content_type, is_active);

CREATE TABLE IF NOT EXISTS ai_generation_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type        TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'gemini',
  model               TEXT NOT NULL,
  prompt_template_id  INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL,
  triggered_by        TEXT NOT NULL DEFAULT 'manual',
  status              TEXT NOT NULL,
  error_message       TEXT,
  tokens_used         INTEGER,
  result_post_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  result_newsletter_id INTEGER REFERENCES newsletters(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_generation_log_created ON ai_generation_log(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_scheduled_jobs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  content_type        TEXT NOT NULL,
  prompt_template_id  INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL,
  schedule_cron       TEXT NOT NULL,
  is_active           INTEGER NOT NULL DEFAULT 1,
  last_run_at         TEXT,
  last_run_status     TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_scheduled_jobs_active ON ai_scheduled_jobs(is_active);
`;

db.exec(newTablesSql);
console.log('✔ prompt_templates, ai_generation_log, ai_scheduled_jobs tables ready.');

// ---------- Column additions (checked individually -- ALTER TABLE has no IF NOT EXISTS) ----------
const columnsToAdd = [
  { table: 'posts', column: 'source', ddl: `ALTER TABLE posts ADD COLUMN source TEXT NOT NULL DEFAULT 'human'` },
  { table: 'posts', column: 'ai_generation_log_id', ddl: `ALTER TABLE posts ADD COLUMN ai_generation_log_id INTEGER REFERENCES ai_generation_log(id) ON DELETE SET NULL` },
  { table: 'newsletters', column: 'source', ddl: `ALTER TABLE newsletters ADD COLUMN source TEXT NOT NULL DEFAULT 'human'` },
  { table: 'newsletters', column: 'ai_generation_log_id', ddl: `ALTER TABLE newsletters ADD COLUMN ai_generation_log_id INTEGER REFERENCES ai_generation_log(id) ON DELETE SET NULL` }
];

for (const { table, column, ddl } of columnsToAdd) {
  if (!tableExists(table)) {
    console.log(`⚠ Table "${table}" does not exist -- skipping column "${column}". Is this the right database file?`);
    continue;
  }
  if (columnExists(table, column)) {
    console.log(`- ${table}.${column} already exists, skipping.`);
    continue;
  }
  db.exec(ddl);
  console.log(`✔ Added ${table}.${column}`);
}

// ---------- New settings keys ----------
// Uses INSERT OR IGNORE so this is safe to run more than once and never overwrites
// a value you've already changed from the dashboard after the first run.
const settingsToAdd = [
  ['ai_provider', 'gemini'],
  ['ai_model', 'gemini-1.5-flash']
];
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of settingsToAdd) {
  const before = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
  insertSetting.run(key, value);
  console.log(before ? `- setting "${key}" already exists, skipping.` : `✔ Added setting "${key}" = "${value}"`);
}

console.log('\nMigration complete. Existing posts/newsletters were automatically set to source = \'human\'.');

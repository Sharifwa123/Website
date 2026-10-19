// Adds ai_generation_log.generated_text -- see 004_ai_log_full_text.sql for why.
// Safe to run more than once: checks column existence before attempting ADD COLUMN,
// since SQLite's ALTER TABLE has no IF NOT EXISTS form.

const db = require('../connection');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

console.log('Running AI log full-text migration...\n');

if (columnExists('ai_generation_log', 'generated_text')) {
  console.log('- ai_generation_log.generated_text already exists, skipping.');
} else {
  db.exec('ALTER TABLE ai_generation_log ADD COLUMN generated_text TEXT');
  console.log('✔ Added ai_generation_log.generated_text');
}

console.log('\nMigration complete.');

// Updates the site's visual identity to a new palette and the fonts that go
// with it (requested directly: the old navy/serif theme read dated, wanted
// something closer to the clean, confident, modern feel of a site like
// Coursera -- without literally copying it).
//
// The theme_primary/theme_accent/theme_ink settings (Admin > Settings >
// Style) store the actual colors the live site renders (see
// views/partials/head.ejs's inline <style> override) -- the new CSS defaults
// in main.css alone would NOT change anything live, because these stored
// values take precedence. This migration updates them to match the new
// defaults, but only when the stored value still matches the OLD default --
// never overwriting a color an admin deliberately chose, exactly like how
// run-006.js only fills in a category description that's still NULL.
//
// Also re-points theme_accent at its new, narrower meaning: it used to drive
// both --cyan and --accent together, which is exactly backwards for a design
// that wants a bold accent on light backgrounds (now --brand, driven by
// theme_primary) and a separate, lighter tint for legibility on the dark
// header/hero/footer only (--cyan, driven by theme_accent). See the updated
// override logic in partials/head.ejs and the updated field descriptions in
// views/admin/settings.ejs.
//
// Safe to run more than once: every update is guarded on the old value still
// being present.

const db = require('../connection');

console.log('Running theme refresh migration...\n');

const updates = [
  { key: 'theme_primary', oldValue: '#123a8f', newValue: '#2f6fed' },
  { key: 'theme_accent', oldValue: '#3ec6ff', newValue: '#7ab2ff' },
  { key: 'theme_ink', oldValue: '#0a1128', newValue: '#0f1726' }
];

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const updateSetting = db.prepare('UPDATE settings SET value = ? WHERE key = ?');

for (const { key, oldValue, newValue } of updates) {
  const row = getSetting.get(key);
  if (!row) {
    console.log(`- setting "${key}" not found, skipping.`);
    continue;
  }
  if (row.value !== oldValue) {
    console.log(`- "${key}" is "${row.value}" (not the old default "${oldValue}"), leaving it as an admin's own choice.`);
    continue;
  }
  updateSetting.run(newValue, key);
  console.log(`✔ Updated "${key}": ${oldValue} -> ${newValue}`);
}

console.log('\nMigration complete.');

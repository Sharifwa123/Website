-- Dark Theme feature migration.
-- Adds the theme_mode setting (light | dark) that controls whether the optional
-- dark/glow "live UI" theme is active on public-facing pages. Defaults to 'light'
-- so this is purely additive and changes nothing about how the site currently looks
-- until an admin explicitly switches it in Admin > Settings.
--
-- Safe to run against a live database: uses INSERT OR IGNORE, so it never overwrites
-- a value that already exists (e.g. if you already toggled this setting via the
-- dashboard before running this migration for some reason).
--
-- HOW TO RUN: node server/db/migrations/run-002.js

INSERT OR IGNORE INTO settings (key, value) VALUES ('theme_mode', 'light');

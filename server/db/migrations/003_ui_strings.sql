-- UI Strings feature migration (Phase 1: public-facing pages).
-- Adds a table for admin-editable UI text, with every row required to carry a
-- default_value that the app falls back to if the editable value is ever left
-- blank or deleted -- this is what prevents a cleared/garbled string from ever
-- producing a broken or blank UI element (see server/lib/uiStrings.js).
--
-- Safe to run against a live database: CREATE TABLE IF NOT EXISTS, and every row
-- insert uses INSERT OR IGNORE, so re-running this after an admin has already
-- edited some strings will never overwrite their edits.
--
-- HOW TO RUN: node server/db/migrations/run-003.js

CREATE TABLE IF NOT EXISTS ui_strings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  string_key    TEXT NOT NULL UNIQUE, -- e.g. "header.nav.home", "home.hero.cta_primary"
  page_group    TEXT NOT NULL,        -- e.g. "header", "homepage", "blog", "notices", "connect", "contact", "footer"
  default_value TEXT NOT NULL,        -- the original hardcoded text -- NEVER edited by the admin UI, used as fallback
  value         TEXT,                 -- admin-edited override; NULL or empty means "use default_value"
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ui_strings_group ON ui_strings(page_group);

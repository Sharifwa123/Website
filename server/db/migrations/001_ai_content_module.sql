-- AI Content Module migration.
-- This is a ONE-TIME, MANUALLY-RUN migration -- it is NOT executed automatically by
-- server/db/init.js (that file only runs its bundled schema.sql on a fresh install).
--
-- Safe to run against a live database with existing posts/newsletters/subscribers:
--   - Every new table uses CREATE TABLE IF NOT EXISTS (no risk if run twice).
--   - Every new column uses ALTER TABLE ... ADD COLUMN ... DEFAULT (existing rows
--     automatically get the default value; no existing query breaks, since nothing
--     currently selects or filters on these new columns).
--
-- HOW TO RUN THIS (do this manually, once, after backing up the database):
--   1. Back up first:
--        cp server/db/shariftech.sqlite3 server/db/shariftech.sqlite3.pre-ai-migration.bak
--   2. Run:
--        sqlite3 server/db/shariftech.sqlite3 < server/db/migrations/001_ai_content_module.sql
--      (or use the Node runner script provided alongside this file, if you prefer not
--      to depend on the sqlite3 CLI being installed on your VPS)

-- ---------- New: prompt_templates ----------
-- Stores editable prompt templates per content type, versioned so a bad edit can be
-- rolled back. `template_text` uses {{placeholder}} syntax filled in by promptBuilder.js
-- -- it is stored and treated purely as text/config, never executed as code.
CREATE TABLE IF NOT EXISTS prompt_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type  TEXT NOT NULL, -- blog_post | newsletter | seo_meta | social_post | tutorial | announcement | news_summary
  name          TEXT NOT NULL, -- human-readable label shown in the admin UI
  template_text TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_type ON prompt_templates(content_type, is_active);

-- ---------- New: ai_generation_log ----------
-- Every AI generation attempt (successful or not) gets a row here. This is the cost/usage
-- visibility layer -- lets the admin see how many calls were made, against which free-tier
-- limits, and trace any generated post/newsletter back to exactly what produced it.
CREATE TABLE IF NOT EXISTS ai_generation_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type        TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'gemini',
  model               TEXT NOT NULL,
  prompt_template_id  INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL,
  triggered_by        TEXT NOT NULL DEFAULT 'manual', -- manual | scheduled
  status              TEXT NOT NULL, -- success | error
  error_message       TEXT,
  tokens_used         INTEGER,
  result_post_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  result_newsletter_id INTEGER REFERENCES newsletters(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_generation_log_created ON ai_generation_log(created_at DESC);

-- ---------- New: ai_scheduled_jobs ----------
-- Admin-configurable automatic generation schedules. A job firing NEVER publishes
-- anything directly -- it only ever creates a draft post/newsletter via the same code
-- path as a manual "Generate now" click, so the draft-first safety rule holds either way.
CREATE TABLE IF NOT EXISTS ai_scheduled_jobs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  content_type        TEXT NOT NULL,
  prompt_template_id  INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL,
  schedule_cron       TEXT NOT NULL, -- standard 5-field cron expression, e.g. "0 8 * * 1" = every Monday 8am
  is_active           INTEGER NOT NULL DEFAULT 1,
  last_run_at         TEXT,
  last_run_status     TEXT, -- success | error | (null if never run)
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_scheduled_jobs_active ON ai_scheduled_jobs(is_active);

-- ---------- Modify: posts ----------
-- Tags every post with who/what produced it. Existing posts all correctly default to
-- 'human', since every post that exists today genuinely was human-written.
ALTER TABLE posts ADD COLUMN source TEXT NOT NULL DEFAULT 'human'; -- human | ai_generated
ALTER TABLE posts ADD COLUMN ai_generation_log_id INTEGER REFERENCES ai_generation_log(id) ON DELETE SET NULL;

-- ---------- Modify: newsletters ----------
-- Same reasoning as posts.source above.
ALTER TABLE newsletters ADD COLUMN source TEXT NOT NULL DEFAULT 'human'; -- human | ai_generated
ALTER TABLE newsletters ADD COLUMN ai_generation_log_id INTEGER REFERENCES ai_generation_log(id) ON DELETE SET NULL;

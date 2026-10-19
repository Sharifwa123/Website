-- AI Content Module fix: store the full generated text on every log entry.
-- Previously, ai_generation_log only recorded metadata (status, tokens, errors) --
-- the actual generated content was only reviewable by finding the resulting draft
-- post/newsletter (for content types that have one). Content types with no
-- dedicated table (seo_meta, social_post, tutorial, announcement, news_summary)
-- had NO way to review what was actually generated. This column fixes that for
-- every content type, uniformly.
--
-- Safe to run against a live database: ALTER TABLE ... ADD COLUMN with no default
-- needed (NULL is fine for existing rows, which predate this column and have no
-- text to backfill).
--
-- HOW TO RUN: node server/db/migrations/run-004.js

ALTER TABLE ai_generation_log ADD COLUMN generated_text TEXT;

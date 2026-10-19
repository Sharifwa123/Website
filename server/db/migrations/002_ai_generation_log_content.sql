-- Adds ai_generation_log.content: the actual generated text.
--
-- WHY: ai_generation_log previously stored only metadata about a generation attempt
-- (content_type, provider, model, status, tokens_used, error_message) -- never the
-- text itself. For blog_post/newsletter that text ends up in the posts/newsletters
-- table as a draft, so it was recoverable there. For every other content type
-- (seo_meta, social_post, tutorial, announcement, news_summary), which have no
-- dedicated draft table, the generated text had nowhere to live and was discarded
-- the moment the request finished -- despite the log appearing to be where it'd be
-- reviewable. This column is what actually makes that true.
--
-- Reference only -- see run-002.js for the idempotent runner (SQLite's ALTER TABLE
-- has no "ADD COLUMN IF NOT EXISTS", so the runner checks column existence in JS
-- before running this, same pattern as run-001.js).

ALTER TABLE ai_generation_log ADD COLUMN content TEXT;

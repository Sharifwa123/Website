// AIManager -- the single, central entry point for every AI generation request in the
// app. Nothing else in the codebase should ever import a provider adapter directly or
// call a provider's API -- every feature (manual "Generate now" button, the scheduler,
// future newsletter/SEO/social generation) goes through generateContent() below.
//
// This is what makes provider-switching a one-line config change instead of a
// find-and-replace across the codebase: adapters all implement the same interface
// (see adapters/gemini.js), and this file is the only place that picks which one to use.

const db = require('../db/connection');
const { buildPrompt } = require('./promptBuilder');

const ADAPTERS = {
  gemini: require('./adapters/gemini')
  // Future: anthropic: require('./adapters/anthropic'), openai: require('./adapters/openai')
};

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getActivePromptTemplate(contentType) {
  return db
    .prepare(
      `SELECT * FROM prompt_templates
       WHERE content_type = ? AND is_active = 1
       ORDER BY version DESC LIMIT 1`
    )
    .get(contentType);
}

function logAttempt({ contentType, provider, model, promptTemplateId, triggeredBy, status, errorMessage, tokensUsed, generatedText }) {
  const info = db
    .prepare(
      `INSERT INTO ai_generation_log
         (content_type, provider, model, prompt_template_id, triggered_by, status, error_message, tokens_used, generated_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(contentType, provider, model, promptTemplateId || null, triggeredBy, status, errorMessage || null, tokensUsed || null, generatedText || null);
  return info.lastInsertRowid;
}

// System instructions per content type -- these establish the OUTPUT CONTRACT that was
// previously missing entirely (no systemPrompt was ever sent to the provider), which is
// why generation could come back reading like a chatbot's conversational answer ("Here's
// a blog post about...") rather than the actual publishable content itself. Every one of
// these instructs the model to output ONLY the final content, with no meta-commentary, no
// restating the request, and no bracket-style placeholders like [Company Name] left
// unfilled -- if a detail wasn't supplied, the model should write around it naturally
// rather than leave a placeholder in the output. Shared by both the template-based path
// (generateContent) and the direct-prompt path (generateFromPrompt) below, so a quick
// "just type what you want" generation gets exactly the same publish-ready contract as
// a saved template does.
const SYSTEM_PROMPTS = {
  blog_post: `You are a professional content writer producing a publishable blog post for a company website. Output ONLY the final article: start with the title on its own first line, followed by the article body in full paragraphs. Do not include any preamble, explanation, meta-commentary, or phrases like "Here is..." or "Sure, here's...". Do not use placeholder brackets like [Company Name] or [Topic] -- write naturally using the specific details given, and if a detail is missing, write around it without leaving a visible gap. Do not restate the instructions you were given.`,
  newsletter: `You are writing a newsletter email for a company to send to its subscribers. Output ONLY the final newsletter: start with the subject line on its own first line, followed by the email body in full paragraphs. No preamble, no meta-commentary, no restating the request, no placeholder brackets.`,
  seo_meta: `You are writing SEO metadata for a web page. Output ONLY the requested metadata (e.g. title tag and meta description), with no preamble, explanation, or meta-commentary.`,
  social_post: `You are writing a social media post for a company's official account. Output ONLY the final post text, ready to publish as-is. No preamble, no meta-commentary, no hashtag spam, no placeholder brackets.`,
  tutorial: `You are writing a step-by-step technical tutorial for a company blog. Output ONLY the final tutorial: a title on the first line, followed by the full tutorial content with clear steps. No preamble, no meta-commentary, no placeholder brackets.`,
  announcement: `You are writing a company announcement. Output ONLY the final announcement text, ready to publish as-is. No preamble, no meta-commentary.`,
  news_summary: `You are summarizing recent news for a company blog audience. Output ONLY the final summary: a title on the first line, followed by the summary content in full paragraphs. No preamble, no meta-commentary, no placeholder brackets.`
};

function getSystemPrompt(contentType) {
  return SYSTEM_PROMPTS[contentType] || SYSTEM_PROMPTS.blog_post;
}

/**
 * Generates content for a given content type (e.g. 'blog_post', 'newsletter').
 *
 * @param {string} contentType - must match a content_type value used in prompt_templates
 * @param {object} variables - values to fill into the template's {{placeholders}}
 * @param {string} triggeredBy - 'manual' | 'scheduled', for the audit log
 * @returns {{ ok: true, text, logId, tokensUsed } | { ok: false, error, logId }}
 *
 * IMPORTANT: this function only ever RETURNS generated text. It never writes a post
 * or newsletter itself, and never sets anything to 'published' -- the caller (the
 * admin route handling the "Generate" button, or the scheduler) is responsible for
 * taking this text and creating a draft with it. Keeping that boundary here means the
 * draft-first safety rule can't accidentally be bypassed by a future shortcut inside
 * this manager.
 */
async function generateContent(contentType, variables = {}, triggeredBy = 'manual') {
  const provider = getSetting('ai_provider', 'gemini');
  const model = getSetting('ai_model', 'gemini-1.5-flash');

  const adapter = ADAPTERS[provider];
  if (!adapter) {
    const logId = logAttempt({
      contentType, provider, model, triggeredBy,
      status: 'error', errorMessage: `Unknown AI provider "${provider}" -- no adapter registered.`
    });
    return { ok: false, error: `Unknown AI provider "${provider}".`, logId };
  }

  const template = getActivePromptTemplate(contentType);
  if (!template) {
    const logId = logAttempt({
      contentType, provider, model, triggeredBy,
      status: 'error', errorMessage: `No active prompt template found for content type "${contentType}".`
    });
    return { ok: false, error: `No active prompt template for "${contentType}". Create one in Admin > AI > Prompts first.`, logId };
  }

  const userPrompt = buildPrompt(template.template_text, variables);
  const systemPrompt = getSystemPrompt(contentType);

  try {
    const result = await adapter.generate({ systemPrompt, userPrompt, model });
    const logId = logAttempt({
      contentType, provider, model,
      promptTemplateId: template.id,
      triggeredBy,
      status: 'success',
      tokensUsed: result.tokensUsed,
      generatedText: result.text
    });
    return { ok: true, text: result.text, tokensUsed: result.tokensUsed, logId };
  } catch (err) {
    const logId = logAttempt({
      contentType, provider, model,
      promptTemplateId: template.id,
      triggeredBy,
      status: 'error',
      errorMessage: err.message
    });
    return { ok: false, error: err.message, logId };
  }
}

/**
 * Generates content directly from free-form text an admin typed into the quick
 * generator, with no saved prompt template required. The raw text becomes the user
 * prompt as-is; the same per-content-type SYSTEM_PROMPTS contract that generateContent
 * uses still applies, so a quick "just type what you want" generation gets exactly the
 * same publish-ready-output guarantee (no chatbot preamble, no bracket placeholders) as
 * a saved template does -- only the *source* of the user prompt differs.
 *
 * Deliberately a separate function from generateContent (some duplicated structure)
 * rather than a branch inside it, so a future change to the template-based path can't
 * accidentally alter this simpler one, and vice versa -- same reasoning already used
 * for draftFromGeneratedText in server/routes/admin/ai.js.
 *
 * Same contract as generateContent: only ever returns generated text, never writes a
 * post/newsletter itself, and never sets anything to 'published'.
 *
 * @param {string} contentType
 * @param {string} rawPrompt - the admin's own typed text, used as the user prompt as-is
 * @param {string} triggeredBy - always 'manual' in practice (there's no scheduled
 *   equivalent of "type a prompt" -- scheduled jobs use a saved template instead)
 * @returns {{ ok: true, text, logId, tokensUsed } | { ok: false, error, logId }}
 */
async function generateFromPrompt(contentType, rawPrompt, triggeredBy = 'manual') {
  const provider = getSetting('ai_provider', 'gemini');
  const model = getSetting('ai_model', 'gemini-1.5-flash');

  const adapter = ADAPTERS[provider];
  if (!adapter) {
    const logId = logAttempt({
      contentType, provider, model, triggeredBy,
      status: 'error', errorMessage: `Unknown AI provider "${provider}" -- no adapter registered.`
    });
    return { ok: false, error: `Unknown AI provider "${provider}".`, logId };
  }

  if (!rawPrompt || !rawPrompt.trim()) {
    const logId = logAttempt({
      contentType, provider, model, triggeredBy,
      status: 'error', errorMessage: 'A prompt is required.'
    });
    return { ok: false, error: 'Type what you want generated first.', logId };
  }

  const userPrompt = rawPrompt.trim();
  const systemPrompt = getSystemPrompt(contentType);

  try {
    const result = await adapter.generate({ systemPrompt, userPrompt, model });
    const logId = logAttempt({
      contentType, provider, model,
      promptTemplateId: null,
      triggeredBy,
      status: 'success',
      tokensUsed: result.tokensUsed,
      generatedText: result.text
    });
    return { ok: true, text: result.text, tokensUsed: result.tokensUsed, logId };
  } catch (err) {
    const logId = logAttempt({
      contentType, provider, model,
      promptTemplateId: null,
      triggeredBy,
      status: 'error',
      errorMessage: err.message
    });
    return { ok: false, error: err.message, logId };
  }
}

module.exports = { generateContent, generateFromPrompt, getActivePromptTemplate, getSetting };

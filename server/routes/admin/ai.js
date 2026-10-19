const express = require('express');
const router = express.Router();
const sanitizeHtml = require('sanitize-html');
const slugify = require('slugify');
const db = require('../../db/connection');
const { requireAdmin } = require('../../middleware/auth');
const { generateContent, generateFromPrompt, getSetting } = require('../../ai/index');
const { extractPlaceholders } = require('../../ai/promptBuilder');
const { cronMatchesNow } = require('../../ai/scheduler');

router.use(requireAdmin);

// Same badge-count pattern already used in admin.js -- shows AI drafts awaiting review
// in the sidebar, consistent with how the Support Inbox badge already works.
router.use((req, res, next) => {
  res.locals.aiDraftCount = db
    .prepare("SELECT COUNT(*) c FROM posts WHERE source = 'ai_generated' AND status = 'draft'")
    .get().c;
  next();
});

const VALID_CONTENT_TYPES = [
  'blog_post', 'newsletter', 'seo_meta', 'social_post', 'tutorial', 'announcement', 'news_summary'
];

const CONTENT_TYPE_LABELS = {
  blog_post: 'Blog post',
  newsletter: 'Newsletter',
  seo_meta: 'SEO meta',
  social_post: 'Social post',
  tutorial: 'Tutorial',
  announcement: 'Announcement',
  news_summary: 'News summary'
};

function draftFromGeneratedText(contentType, text, logId) {
  // Shared by both the manual-trigger route and (conceptually) the scheduler --
  // duplicated intentionally rather than imported from scheduler.js, since this
  // router should not depend on scheduler internals; keeping the two independent
  // avoids a change to one accidentally breaking the other.
  const firstLine = (text.split('\n')[0] || 'AI-generated draft').slice(0, 200).replace(/^#+\s*/, '');
  const bodyText = text.split('\n').slice(1).join('\n').trim();
  const paragraphs = bodyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const bodyHtml = paragraphs.map((p) => `<p>${p}</p>`).join('\n');

  if (contentType === 'blog_post') {
    let slug = slugify(firstLine, { lower: true, strict: true }) || 'ai-draft';
    let i = 1;
    while (db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug)) {
      slug = `${slug}-${++i}`;
    }
    const excerpt = (paragraphs[0] || firstLine).slice(0, 200);
    const info = db
      .prepare(
        `INSERT INTO posts (title, slug, excerpt, body_html, status, source, ai_generation_log_id)
         VALUES (?, ?, ?, ?, 'draft', 'ai_generated', ?)`
      )
      .run(firstLine, slug, excerpt, bodyHtml, logId);
    db.prepare('UPDATE ai_generation_log SET result_post_id = ? WHERE id = ?').run(info.lastInsertRowid, logId);
    return { table: 'posts', id: info.lastInsertRowid, redirectUrl: `/admin/posts/${info.lastInsertRowid}/edit` };
  }

  if (contentType === 'newsletter') {
    const info = db
      .prepare(
        `INSERT INTO newsletters (subject, body_html, status, source, ai_generation_log_id)
         VALUES (?, ?, 'draft', 'ai_generated', ?)`
      )
      .run(firstLine, bodyHtml, logId);
    db.prepare('UPDATE ai_generation_log SET result_newsletter_id = ? WHERE id = ?').run(info.lastInsertRowid, logId);
    return { table: 'newsletters', id: info.lastInsertRowid, redirectUrl: `/admin/newsletters/${info.lastInsertRowid}/edit` };
  }

  // Other content types (seo_meta, social_post, etc.) have no dedicated draft table yet,
  // so there's no result_post_id/result_newsletter_id to set here -- but the generated
  // text is stored in ai_generation_log.content (see AIManager.generateContent), so it's
  // genuinely reviewable via the Generation Log, not silently discarded.
  return { table: null, id: null, redirectUrl: null };
}

// ---------- DASHBOARD (AI section landing page) ----------

router.get('/', (req, res) => {
  const stats = {
    templates: db.prepare('SELECT COUNT(*) c FROM prompt_templates WHERE is_active = 1').get().c,
    aiDrafts: db.prepare("SELECT COUNT(*) c FROM posts WHERE source = 'ai_generated' AND status = 'draft'").get().c,
    scheduledJobs: db.prepare('SELECT COUNT(*) c FROM ai_scheduled_jobs WHERE is_active = 1').get().c,
    generationsToday: db
      .prepare("SELECT COUNT(*) c FROM ai_generation_log WHERE date(created_at) = date('now')")
      .get().c
  };
  const recentLog = db.prepare('SELECT * FROM ai_generation_log ORDER BY created_at DESC LIMIT 10').all();
  const currentProvider = getSetting('ai_provider', 'gemini');
  const currentModel = getSetting('ai_model', 'gemini-1.5-flash');

  res.render('admin/ai/dashboard', { stats, recentLog, currentProvider, currentModel, active: 'ai' });
});

// ---------- PROMPT TEMPLATES ----------

router.get('/prompts', (req, res) => {
  const templates = db.prepare('SELECT * FROM prompt_templates ORDER BY content_type, version DESC').all();
  res.render('admin/ai/prompts/list', { templates, active: 'ai' });
});

router.get('/prompts/new', (req, res) => {
  res.render('admin/ai/prompts/form', { template: null, contentTypes: VALID_CONTENT_TYPES, active: 'ai' });
});

router.post('/prompts', (req, res) => {
  const { content_type, name, template_text } = req.body;
  if (!VALID_CONTENT_TYPES.includes(content_type)) {
    return res.status(400).send('Invalid content type.');
  }
  if (!name || !name.trim() || !template_text || !template_text.trim()) {
    return res.status(400).send('Name and template text are required.');
  }

  // Deactivate any existing active template for this content type -- only one active
  // template per content type at a time, matching how AIManager.getActivePromptTemplate
  // looks things up (is_active = 1, highest version).
  const tx = db.transaction(() => {
    db.prepare('UPDATE prompt_templates SET is_active = 0 WHERE content_type = ? AND is_active = 1').run(content_type);
    const maxVersion = db
      .prepare('SELECT MAX(version) v FROM prompt_templates WHERE content_type = ?')
      .get(content_type).v || 0;
    db.prepare(
      `INSERT INTO prompt_templates (content_type, name, template_text, version, is_active) VALUES (?, ?, ?, ?, 1)`
    ).run(content_type, name.trim(), sanitizeHtml(template_text, { allowedTags: [], allowedAttributes: {} }), maxVersion + 1);
  });
  tx();

  res.redirect('/admin/ai/prompts');
});

router.get('/prompts/:id/edit', (req, res) => {
  const template = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.redirect('/admin/ai/prompts');
  res.render('admin/ai/prompts/form', { template, contentTypes: VALID_CONTENT_TYPES, active: 'ai' });
});

// Editing creates a NEW version rather than overwriting the row in place -- this is
// what makes "roll back a bad prompt edit" possible later (per the architecture
// discussion's point on prompt versioning), since old versions are never destroyed,
// only deactivated.
router.post('/prompts/:id/edit', (req, res) => {
  const existing = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.redirect('/admin/ai/prompts');

  const { name, template_text } = req.body;
  if (!name || !name.trim() || !template_text || !template_text.trim()) {
    return res.status(400).send('Name and template text are required.');
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE prompt_templates SET is_active = 0 WHERE content_type = ? AND is_active = 1').run(existing.content_type);
    const maxVersion = db
      .prepare('SELECT MAX(version) v FROM prompt_templates WHERE content_type = ?')
      .get(existing.content_type).v || 0;
    db.prepare(
      `INSERT INTO prompt_templates (content_type, name, template_text, version, is_active) VALUES (?, ?, ?, ?, 1)`
    ).run(existing.content_type, name.trim(), sanitizeHtml(template_text, { allowedTags: [], allowedAttributes: {} }), maxVersion + 1);
  });
  tx();

  res.redirect('/admin/ai/prompts');
});

// Re-activates an older version (the "roll back" action).
router.post('/prompts/:id/activate', (req, res) => {
  const template = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.redirect('/admin/ai/prompts');

  const tx = db.transaction(() => {
    db.prepare('UPDATE prompt_templates SET is_active = 0 WHERE content_type = ?').run(template.content_type);
    db.prepare('UPDATE prompt_templates SET is_active = 1 WHERE id = ?').run(template.id);
  });
  tx();

  res.redirect('/admin/ai/prompts');
});

router.post('/prompts/:id/delete', (req, res) => {
  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(req.params.id);
  res.redirect('/admin/ai/prompts');
});

// ---------- MANUAL GENERATION ----------

// The quick generator (a content-type picker + one textarea, no template required) is
// the default and only thing shown here now -- picking a content type and typing a
// prompt is the whole flow, and a saved-template generation used to be the only way to
// generate anything at all (blocking with "No active prompt templates yet" until one
// was created). Saved templates still exist for the scheduler (which has no human
// typing a prompt each time a job fires), managed from Admin > AI > Prompts, but a
// manual "generate now" no longer depends on one existing.
router.get('/generate', (req, res) => {
  const templates = db.prepare('SELECT * FROM prompt_templates WHERE is_active = 1 ORDER BY content_type').all();
  const templatesWithPlaceholders = templates.map((t) => ({
    ...t,
    placeholders: extractPlaceholders(t.template_text)
  }));
  const contentTypes = VALID_CONTENT_TYPES.map((value) => ({ value, label: CONTENT_TYPE_LABELS[value] }));
  res.render('admin/ai/generate', { contentTypes, templates: templatesWithPlaceholders, active: 'ai' });
});

// Generates content and creates a DRAFT post or newsletter -- never sets status to
// 'published'. This is the manual-trigger equivalent of what the scheduler does
// automatically for the same content types.
//
// Two request shapes, both producing an equally publish-ready draft:
//   { content_type, prompt }              -- the quick generator: prompt is typed
//                                             free-form text, used as-is (see
//                                             generateFromPrompt). This is the normal path.
//   { content_type, <template variables> } -- the saved-template path (generateContent),
//                                             kept for the "use a saved template" advanced
//                                             option and for parity with how the scheduler
//                                             generates content.
router.post('/generate', async (req, res) => {
  const { content_type, prompt, ...variables } = req.body;
  if (!VALID_CONTENT_TYPES.includes(content_type)) {
    return res.status(400).json({ ok: false, error: 'Invalid content type.' });
  }

  const result = typeof prompt === 'string' && prompt.trim()
    ? await generateFromPrompt(content_type, prompt, 'manual')
    : await generateContent(content_type, variables, 'manual');
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error });
  }

  const draft = draftFromGeneratedText(content_type, result.text, result.logId);
  res.json({ ok: true, text: result.text, redirectUrl: draft.redirectUrl, logId: result.logId });
});

// ---------- SCHEDULED JOBS ----------

router.get('/schedules', (req, res) => {
  const jobs = db
    .prepare(
      `SELECT ai_scheduled_jobs.*, prompt_templates.name AS template_name
       FROM ai_scheduled_jobs LEFT JOIN prompt_templates ON prompt_templates.id = ai_scheduled_jobs.prompt_template_id
       ORDER BY ai_scheduled_jobs.created_at DESC`
    )
    .all();
  res.render('admin/ai/schedules/list', { jobs, active: 'ai' });
});

router.get('/schedules/new', (req, res) => {
  const templates = db.prepare('SELECT * FROM prompt_templates WHERE is_active = 1').all();
  res.render('admin/ai/schedules/form', { job: null, templates, active: 'ai' });
});

router.post('/schedules', (req, res) => {
  const { name, content_type, prompt_template_id, schedule_cron, auto_publish } = req.body;
  if (!name || !name.trim() || !schedule_cron || !schedule_cron.trim()) {
    return res.status(400).send('Name and schedule are required.');
  }
  if (!VALID_CONTENT_TYPES.includes(content_type)) {
    return res.status(400).send('Invalid content type.');
  }
  // Validate the cron expression using the exact same matcher the scheduler itself
  // uses, so an invalid schedule is caught here rather than silently failing every
  // minute once saved.
  try {
    cronMatchesNow(schedule_cron.trim());
  } catch (err) {
    return res.status(400).send(`Invalid schedule: ${err.message}`);
  }

  // auto_publish only ever does anything for blog_post jobs (see server/ai/scheduler.js) --
  // silently ignored for every other content type, which always lands as a draft/log entry
  // regardless of this flag.
  const autoPublish = auto_publish === '1' && content_type === 'blog_post' ? 1 : 0;

  db.prepare(
    `INSERT INTO ai_scheduled_jobs (name, content_type, prompt_template_id, schedule_cron, is_active, auto_publish) VALUES (?, ?, ?, ?, 1, ?)`
  ).run(name.trim(), content_type, prompt_template_id || null, schedule_cron.trim(), autoPublish);

  res.redirect('/admin/ai/schedules');
});

router.post('/schedules/:id/toggle', (req, res) => {
  const job = db.prepare('SELECT * FROM ai_scheduled_jobs WHERE id = ?').get(req.params.id);
  if (job) {
    db.prepare('UPDATE ai_scheduled_jobs SET is_active = ? WHERE id = ?').run(job.is_active ? 0 : 1, job.id);
  }
  res.redirect('/admin/ai/schedules');
});

router.post('/schedules/:id/delete', (req, res) => {
  db.prepare('DELETE FROM ai_scheduled_jobs WHERE id = ?').run(req.params.id);
  res.redirect('/admin/ai/schedules');
});

// ---------- GENERATION LOG ----------

router.get('/log', (req, res) => {
  const entries = db.prepare('SELECT * FROM ai_generation_log ORDER BY created_at DESC LIMIT 100').all();
  res.render('admin/ai/log', { entries, active: 'ai' });
});

// ---------- SETTINGS (which provider/model is active) ----------

router.get('/settings', (req, res) => {
  const provider = getSetting('ai_provider', 'gemini');
  const model = getSetting('ai_model', 'gemini-1.5-flash');
  res.render('admin/ai/settings', { provider, model, active: 'ai' });
});

router.post('/settings', (req, res) => {
  const { ai_provider, ai_model } = req.body;
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  if (ai_provider) upsert.run('ai_provider', ai_provider);
  if (ai_model) upsert.run('ai_model', ai_model);
  res.redirect('/admin/ai/settings');
});

// ---------- JSON API endpoints (power the interactive/live-updating admin UI) ----------
// These mirror the data already shown by the server-rendered pages above, just as JSON
// for client-side fetch() calls -- so the dashboard can auto-refresh, the log can be
// filtered without a full page reload, etc. Every response here is JSON only (never
// HTML), and every value that gets used with innerHTML client-side must be escaped by
// the calling script -- see the escapeHtml() helper included in each view's <script>.

router.get('/api/stats', (req, res) => {
  const stats = {
    templates: db.prepare('SELECT COUNT(*) c FROM prompt_templates WHERE is_active = 1').get().c,
    aiDrafts: db.prepare("SELECT COUNT(*) c FROM posts WHERE source = 'ai_generated' AND status = 'draft'").get().c,
    scheduledJobs: db.prepare('SELECT COUNT(*) c FROM ai_scheduled_jobs WHERE is_active = 1').get().c,
    generationsToday: db
      .prepare("SELECT COUNT(*) c FROM ai_generation_log WHERE date(created_at) = date('now')")
      .get().c
  };
  const recentLog = db.prepare('SELECT * FROM ai_generation_log ORDER BY created_at DESC LIMIT 10').all();
  res.json({ ok: true, stats, recentLog });
});

// Filterable/searchable generation log, called from the log page's live filter UI.
router.get('/api/log', (req, res) => {
  const { status, content_type, q } = req.query;
  let query = 'SELECT * FROM ai_generation_log WHERE 1=1';
  const params = [];

  if (status && ['success', 'error'].includes(status)) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (content_type && VALID_CONTENT_TYPES.includes(content_type)) {
    query += ' AND content_type = ?';
    params.push(content_type);
  }
  if (q && q.trim()) {
    query += ' AND (content_type LIKE ? OR error_message LIKE ? OR provider LIKE ? OR model LIKE ?)';
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  query += ' ORDER BY created_at DESC LIMIT 100';

  const entries = db.prepare(query).all(...params);
  res.json({ ok: true, entries });
});

// Inline prompt template actions (used by the interactive prompts list, so activating/
// deleting doesn't require a full page reload). Same underlying logic as the existing
// POST /prompts/:id/activate and /:id/delete routes above -- exposed here as JSON so
// the client-side fetch() can update the page in place instead of navigating away.
router.get('/api/prompts', (req, res) => {
  const templates = db.prepare('SELECT * FROM prompt_templates ORDER BY content_type, version DESC').all();
  res.json({ ok: true, templates });
});

router.get('/api/schedules', (req, res) => {
  const jobs = db
    .prepare(
      `SELECT ai_scheduled_jobs.*, prompt_templates.name AS template_name
       FROM ai_scheduled_jobs LEFT JOIN prompt_templates ON prompt_templates.id = ai_scheduled_jobs.prompt_template_id
       ORDER BY ai_scheduled_jobs.created_at DESC`
    )
    .all();
  res.json({ ok: true, jobs });
});

router.post('/api/prompts/:id/activate', (req, res) => {
  const template = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ ok: false, error: 'Template not found.' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE prompt_templates SET is_active = 0 WHERE content_type = ?').run(template.content_type);
    db.prepare('UPDATE prompt_templates SET is_active = 1 WHERE id = ?').run(template.id);
  });
  tx();
  res.json({ ok: true });
});

router.post('/api/prompts/:id/delete', (req, res) => {
  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/api/schedules/:id/toggle', (req, res) => {
  const job = db.prepare('SELECT * FROM ai_scheduled_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Schedule not found.' });
  db.prepare('UPDATE ai_scheduled_jobs SET is_active = ? WHERE id = ?').run(job.is_active ? 0 : 1, job.id);
  res.json({ ok: true, is_active: job.is_active ? 0 : 1 });
});

router.post('/api/schedules/:id/delete', (req, res) => {
  db.prepare('DELETE FROM ai_scheduled_jobs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

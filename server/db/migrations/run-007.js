// Adds opt-in auto-publish support to scheduled AI jobs, and sets up two daily
// blog-post schedules that use it.
//
// Background: ai_scheduled_jobs has always been draft-only by design (see the
// safety-model comment at the top of server/ai/scheduler.js) -- every job, no
// matter how it's configured, created a draft for a human to review and publish.
// That stays the DEFAULT. This migration adds a new `auto_publish` column
// (0 by default, so every existing job's behavior is unchanged) that a specific
// job can opt into, explicitly, from the admin UI -- requested directly by the
// business owner, who wants a steady flow of blog content with zero manual
// publishing steps rather than reviewing two drafts a day indefinitely.
//
// Safe to run more than once: the column is added only if missing, and the two
// schedules/templates are only inserted if a job with the same name doesn't
// already exist (so re-running this after an admin has edited/deleted one of
// them won't resurrect it).

const db = require('../connection');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

console.log('Running auto-publish scheduled jobs migration...\n');

if (columnExists('ai_scheduled_jobs', 'auto_publish')) {
  console.log('- ai_scheduled_jobs.auto_publish already exists, skipping.');
} else {
  db.exec('ALTER TABLE ai_scheduled_jobs ADD COLUMN auto_publish INTEGER NOT NULL DEFAULT 0');
  console.log('✔ Added ai_scheduled_jobs.auto_publish (default 0 -- every existing job keeps its current draft-only behavior)');
}

// Two prompt templates, each covering a different cluster of topics so the two
// daily posts don't drift toward the same subject. No {{placeholders}} -- a
// scheduled job always calls generateContent() with no variables, so a template
// used here must be fully self-contained text.
const templates = [
  {
    name: 'Daily blog — IT & security topics',
    content_type: 'blog_post',
    template_text: `Write a short, practical blog post (roughly 350-550 words) for the SHARIF TECHNOLOGIES company blog, aimed at small and medium business owners in Ghana and West Africa who are not deeply technical.

Pick ONE specific, concrete topic from this list -- choose a different one than you'd typically default to, so the blog stays varied over time:
- password management and account security
- backup strategy (and actually testing backups)
- recognizing phishing and social engineering attempts
- keeping an office Wi-Fi and network secure
- network setup and growth planning for a growing office
- basic security practices for staff working remotely
- what to look for when choosing IT support
- data privacy basics for a small business
- keeping software and devices updated
- physical security of office equipment and servers

Write in a plain, direct, no-hype tone: concrete examples and plain language, no buzzwords, no "in today's digital world" openers, no exclamation marks, nothing that reads like generic AI filler. Use "we" to refer to SHARIF TECHNOLOGIES naturally, without overdoing it. End with one short, understated line pointing the reader to the contact page if they want help with what you just described -- not a hard sales pitch.

Write in plain prose paragraphs only -- no markdown formatting, no bullet points, no headers, no asterisks or hash symbols, no numbered lists. Output ONLY the post: the title on the first line, then the body as plain paragraphs separated by blank lines.`
  },
  {
    name: 'Daily blog — web, mobile & growth topics',
    content_type: 'blog_post',
    template_text: `Write a short, practical blog post (roughly 350-550 words) for the SHARIF TECHNOLOGIES company blog, aimed at small and medium business owners in Ghana and West Africa who are not deeply technical.

Pick ONE specific, concrete topic from this list -- choose a different one than you'd typically default to, so the blog stays varied over time:
- how to tell whether a business needs a website or a full web app
- when a mobile app is actually worth building versus a mobile-friendly website
- what good web hosting and uptime actually require
- planning a website redesign without losing search ranking
- basic, realistic SEO habits for a small business site
- moving a business off spreadsheets and onto proper software
- what slows a website down and how that gets fixed
- getting staff to actually use software the business already pays for
- planning an IT budget as a business grows
- choosing between an off-the-shelf tool and custom-built software

Write in a plain, direct, no-hype tone: concrete examples and plain language, no buzzwords, no "in today's digital world" openers, no exclamation marks, nothing that reads like generic AI filler. Use "we" to refer to SHARIF TECHNOLOGIES naturally, without overdoing it. End with one short, understated line pointing the reader to the contact page if they want help with what you just described -- not a hard sales pitch.

Write in plain prose paragraphs only -- no markdown formatting, no bullet points, no headers, no asterisks or hash symbols, no numbered lists. Output ONLY the post: the title on the first line, then the body as plain paragraphs separated by blank lines.`
  }
];

const getTemplateByName = db.prepare('SELECT * FROM prompt_templates WHERE name = ?');
const insertTemplate = db.prepare(
  `INSERT INTO prompt_templates (content_type, name, template_text, version, is_active) VALUES (?, ?, ?, 1, 1)`
);

const templateIds = {};
for (const t of templates) {
  const existing = getTemplateByName.get(t.name);
  if (existing) {
    console.log(`- template "${t.name}" already exists, skipping.`);
    templateIds[t.name] = existing.id;
    continue;
  }
  const info = insertTemplate.run(t.content_type, t.name, t.template_text);
  templateIds[t.name] = info.lastInsertRowid;
  console.log(`✔ Created template "${t.name}"`);
}

// Two daily schedules, spread across the day, both auto-publishing directly --
// requested explicitly: the business wants a steady flow of content with no
// manual publish step, not two drafts a day to review.
const schedules = [
  {
    name: 'Daily blog post — morning (auto-publish)',
    content_type: 'blog_post',
    template_name: 'Daily blog — IT & security topics',
    schedule_cron: '0 9 * * *'
  },
  {
    name: 'Daily blog post — afternoon (auto-publish)',
    content_type: 'blog_post',
    template_name: 'Daily blog — web, mobile & growth topics',
    schedule_cron: '0 15 * * *'
  }
];

const getJobByName = db.prepare('SELECT id FROM ai_scheduled_jobs WHERE name = ?');
const insertJob = db.prepare(
  `INSERT INTO ai_scheduled_jobs (name, content_type, prompt_template_id, schedule_cron, is_active, auto_publish)
   VALUES (?, ?, ?, ?, 1, 1)`
);

for (const s of schedules) {
  if (getJobByName.get(s.name)) {
    console.log(`- schedule "${s.name}" already exists, skipping.`);
    continue;
  }
  insertJob.run(s.name, s.content_type, templateIds[s.template_name], s.schedule_cron);
  console.log(`✔ Created schedule "${s.name}" (${s.schedule_cron}, auto-publish)`);
}

console.log('\nMigration complete.');

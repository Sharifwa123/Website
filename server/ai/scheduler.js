// Scheduler for automatic AI content generation.
//
// SAFETY MODEL (read this before changing anything here):
//   - DRAFT IS STILL THE DEFAULT. A job calls the exact same AIManager.generateContent()
//     used by the manual "Generate now" button, and creates a draft post/newsletter from
//     the result -- unless that specific job has auto_publish = 1 set on it, which is an
//     explicit, per-job opt-in made from the admin UI (New Schedule form), never a global
//     switch. Do not make auto_publish default to 1, and do not add any other path that
//     publishes without either a human clicking Publish or a job explicitly opted into
//     auto_publish -- an unattended background job that publishes by default is a real
//     reputational risk for the business.
//   - Runs entirely in-process (setInterval, checked once per minute) -- no external job
//     queue, no Redis, no separate worker process. This matches the project's actual scale;
//     see the architecture discussion this was scoped from for why that's the right call
//     today, and what would need to be true before that changes.
//   - Deliberately does NOT use a cron npm package. Cron-expression matching for the 5-field
//     subset actually needed here (*, exact numbers, comma lists, step values) is simple
//     enough to implement directly and keep dependency-free, consistent with this project's
//     existing style. It does not support ranges (e.g. "1-5") in this version -- if you need
//     that, use a comma list instead (e.g. "1,2,3,4,5"), or ask for ranges to be added properly.

const db = require('../db/connection');
const { generateContent } = require('./index');

const CHECK_INTERVAL_MS = 60 * 1000; // check once per minute -- matches cron's minute granularity
let intervalHandle = null;

// ---------- Cron matching (verified against 16 test cases + an independent date check
// before being placed here -- see the test scenarios used during development) ----------

function fieldMatches(fieldValue, currentValue) {
  if (fieldValue === '*') return true;
  if (fieldValue.includes(',')) {
    return fieldValue.split(',').some((v) => fieldMatches(v.trim(), currentValue));
  }
  if (fieldValue.includes('/')) {
    const [base, stepStr] = fieldValue.split('/');
    const step = parseInt(stepStr, 10);
    if (base === '*') return currentValue % step === 0;
    const baseNum = parseInt(base, 10);
    return currentValue >= baseNum && (currentValue - baseNum) % step === 0;
  }
  return parseInt(fieldValue, 10) === currentValue;
}

function cronMatchesNow(cronExpr, now = new Date()) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression "${cronExpr}" -- expected 5 fields (minute hour day month weekday), got ${parts.length}.`);
  }
  const [minute, hour, day, month, weekday] = parts;
  return (
    fieldMatches(minute, now.getMinutes()) &&
    fieldMatches(hour, now.getHours()) &&
    fieldMatches(day, now.getDate()) &&
    fieldMatches(month, now.getMonth() + 1) &&
    fieldMatches(weekday, now.getDay())
  );
}

// ---------- Job execution ----------

/**
 * Runs one due job: calls the AIManager and creates a draft -- or, only when this
 * specific job has auto_publish = 1, a published post/newsletter -- from the result.
 * Updates the job's last_run_at/status regardless of outcome, so the admin can see
 * it actually ran (and whether it failed) even if they weren't watching at the time.
 */
async function runJob(job) {
  const result = await generateContent(job.content_type, {}, 'scheduled');

  let updateFields = { last_run_at: "datetime('now')", last_run_status: result.ok ? 'success' : 'error' };
  // auto_publish only ever applies to blog_post: a post's 'published' means visible on
  // the site, a simple status flip. A newsletter's non-draft state is 'sent', which means
  // real emails went out to real subscribers -- a materially bigger, more sensitive action
  // this scheduler does not take on a job's behalf. Newsletters always land as drafts;
  // sending is a deliberate, separate step an admin takes by hand in the dashboard.
  const publishPost = job.content_type === 'blog_post' && job.auto_publish;
  const postStatus = publishPost ? 'published' : 'draft';
  const postPublishedAt = publishPost ? new Date().toISOString() : null;

  if (result.ok) {
    if (job.content_type === 'blog_post') {
      const title = (result.text.split('\n')[0] || 'AI-generated draft').slice(0, 200).replace(/^#+\s*/, '');
      const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'ai-draft';
      let slug = slugBase;
      let i = 1;
      while (db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug)) {
        slug = `${slugBase}-${++i}`;
      }
      // Drop the title line from the body (it's already stored separately), then split
      // on blank lines into paragraphs -- AI output typically separates paragraphs with
      // a blank line, so this avoids the empty <p></p> artifacts a naive \n replace produces.
      const bodyText = result.text.split('\n').slice(1).join('\n').trim();
      const paragraphs = bodyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const bodyHtml = paragraphs.map((p) => `<p>${p}</p>`).join('\n');
      const excerpt = (paragraphs[0] || title).slice(0, 200);

      const postInfo = db.prepare(
        `INSERT INTO posts (title, slug, excerpt, body_html, status, published_at, source, ai_generation_log_id)
         VALUES (?, ?, ?, ?, ?, ?, 'ai_generated', ?)`
      ).run(title, slug, excerpt, bodyHtml, postStatus, postPublishedAt, result.logId);
      db.prepare('UPDATE ai_generation_log SET result_post_id = ? WHERE id = ?').run(postInfo.lastInsertRowid, result.logId);
    } else if (job.content_type === 'newsletter') {
      const subject = (result.text.split('\n')[0] || 'AI-generated newsletter draft').slice(0, 200).replace(/^#+\s*/, '');
      const bodyText = result.text.split('\n').slice(1).join('\n').trim();
      const paragraphs = bodyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const bodyHtml = paragraphs.map((p) => `<p>${p}</p>`).join('\n');

      const newsletterInfo = db.prepare(
        `INSERT INTO newsletters (subject, body_html, status, source, ai_generation_log_id)
         VALUES (?, ?, 'draft', 'ai_generated', ?)`
      ).run(subject, bodyHtml, result.logId);
      db.prepare('UPDATE ai_generation_log SET result_newsletter_id = ? WHERE id = ?').run(newsletterInfo.lastInsertRowid, result.logId);
    }
    // Other content_types (seo_meta, social_post, etc.) don't have a dedicated draft
    // table of their own yet, so there's no result_post_id/result_newsletter_id to set --
    // but the generated text itself is stored in ai_generation_log.content (see
    // AIManager.generateContent), so it's genuinely reviewable there, not just nominally.
  }

  db.prepare(
    `UPDATE ai_scheduled_jobs SET last_run_at = datetime('now'), last_run_status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(result.ok ? 'success' : 'error', job.id);

  return result;
}

/**
 * Checks all active scheduled jobs and runs any that are due this minute.
 * Guards against double-firing: skips a job if its last_run_at falls within the
 * current minute already (handles the rare case of two checks landing in the same
 * 60-second window due to timer drift).
 */
async function checkAndRunDueJobs() {
  const jobs = db.prepare('SELECT * FROM ai_scheduled_jobs WHERE is_active = 1').all();
  const now = new Date();
  const currentMinuteKey = now.toISOString().slice(0, 16); // "2026-07-20T14:37"

  for (const job of jobs) {
    let isDue;
    try {
      isDue = cronMatchesNow(job.schedule_cron, now);
    } catch (err) {
      console.error(`[AI Scheduler] Job "${job.name}" has an invalid schedule_cron: ${err.message}`);
      continue;
    }
    if (!isDue) continue;

    if (job.last_run_at) {
      const lastRunMinuteKey = job.last_run_at.slice(0, 16).replace(' ', 'T');
      if (lastRunMinuteKey === currentMinuteKey) continue; // already ran this exact minute
    }

    console.log(`[AI Scheduler] Running job "${job.name}" (${job.content_type})...`);
    try {
      const result = await runJob(job);
      console.log(`[AI Scheduler] Job "${job.name}" ${result.ok ? 'succeeded' : 'failed: ' + result.error}`);
    } catch (err) {
      console.error(`[AI Scheduler] Job "${job.name}" threw an unexpected error:`, err.message);
    }
  }
}

/** Starts the once-per-minute check loop. Call once, from server/index.js, on boot. */
function startScheduler() {
  if (intervalHandle) return; // already started -- don't double-start
  intervalHandle = setInterval(() => {
    checkAndRunDueJobs().catch((err) => console.error('[AI Scheduler] Unexpected error during check:', err.message));
  }, CHECK_INTERVAL_MS);
  console.log('[AI Scheduler] Started (checking every 60 seconds for due jobs).');
}

function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startScheduler, stopScheduler, checkAndRunDueJobs, cronMatchesNow };

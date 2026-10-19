const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const slugify = require('slugify');
const db = require('../db/connection');
const { requireAdmin } = require('../middleware/auth');
const { adminImageUpload, UPLOAD_ROOT } = require('../middleware/uploads');
const { sendMail } = require('../lib/mailer');
const { invalidateCache: invalidateUiStringsCache } = require('../lib/uiStrings');

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

router.use(requireAdmin);

// Make badge counts and site settings (logo, name) available to every admin view.
router.use((req, res, next) => {
  res.locals.pendingCount = db.prepare("SELECT COUNT(*) c FROM messages WHERE status='new'").get().c;
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => (settings[r.key] = r.value));
  res.locals.settings = settings;
  next();
});

const sanitizeOpts = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'iframe']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'alt', 'width', 'height'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen'],
    '*': ['style', 'class']
  }
};

function uniqueSlug(table, base) {
  let slug = slugify(base, { lower: true, strict: true }) || 'post';
  let candidate = slug;
  let i = 1;
  while (db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(candidate)) {
    candidate = `${slug}-${++i}`;
  }
  return candidate;
}

// The expiry date field is a plain <input type="date"> (e.g. "2026-07-19"), but
// datetime('now') in SQLite returns a full "YYYY-MM-DD HH:MM:SS" string. Comparing
// those two formats directly as strings is unreliable (a bare date can sort before
// or after a same-day datetime depending on the exact string). Normalizing every
// stored expiry to the END of that day ("2026-07-19 23:59:59") keeps the notice
// visible through its entire expiry date and makes the "expires_at >= datetime('now')"
// check in the public queries behave correctly.
function normalizeExpiry(expiresAt) {
  if (!expiresAt) return null;
  const datePart = expiresAt.slice(0, 10); // tolerate either "YYYY-MM-DD" or a full datetime being passed in
  return `${datePart} 23:59:59`;
}

// ---------- DASHBOARD HOME ----------

router.get('/', (req, res) => {
  const stats = {
    posts: db.prepare("SELECT COUNT(*) c FROM posts").get().c,
    published: db.prepare("SELECT COUNT(*) c FROM posts WHERE status='published'").get().c,
    notices: db.prepare("SELECT COUNT(*) c FROM notices WHERE status='published'").get().c,
    subscribers: db.prepare("SELECT COUNT(*) c FROM subscribers WHERE status='confirmed'").get().c,
    newMessages: db.prepare("SELECT COUNT(*) c FROM messages WHERE status='new'").get().c
  };
  const recentPosts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 5').all();
  const recentMessages = db
    .prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT 5")
    .all();

  res.render('admin/dashboard', { stats, recentPosts, recentMessages, active: 'dashboard' });
});

// ---------- POSTS ----------

router.get('/posts', (req, res) => {
  const posts = db
    .prepare(
      `SELECT posts.*, categories.name AS category_name FROM posts
       LEFT JOIN categories ON categories.id = posts.category_id
       ORDER BY posts.created_at DESC`
    )
    .all();
  res.render('admin/posts/list', { posts, active: 'posts' });
});

router.get('/posts/new', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/posts/form', { post: null, categories, active: 'posts' });
});

router.post('/posts', (req, res) => {
  adminImageUpload.single('cover_image')(req, res, (err) => {
    if (err) return res.status(400).send(err.message);

    const { title, excerpt, body_html, category_id, status } = req.body;
    const slug = uniqueSlug('posts', title);
    const cover = req.file ? path.relative(UPLOAD_ROOT, req.file.path) : null;
    const publishedAt = status === 'published' ? new Date().toISOString() : null;

    db.prepare(
      `INSERT INTO posts (title, slug, excerpt, body_html, cover_image, category_id, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      title,
      slug,
      excerpt || '',
      sanitizeHtml(body_html || '', sanitizeOpts),
      cover,
      category_id || null,
      status || 'draft',
      publishedAt
    );

    res.redirect('/admin/posts');
  });
});

router.get('/posts/:id/edit', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/admin/posts');
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/posts/form', { post, categories, active: 'posts' });
});

router.post('/posts/:id/edit', (req, res) => {
  adminImageUpload.single('cover_image')(req, res, (err) => {
    if (err) return res.status(400).send(err.message);

    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!existing) return res.redirect('/admin/posts');

    const { title, excerpt, body_html, category_id, status } = req.body;
    let cover = existing.cover_image;
    if (req.file) {
      cover = path.relative(UPLOAD_ROOT, req.file.path);
    }

    let publishedAt = existing.published_at;
    if (status === 'published' && !existing.published_at) {
      publishedAt = new Date().toISOString();
    }

    let slug = existing.slug;
    if (title !== existing.title) {
      slug = uniqueSlug('posts', title);
    }

    db.prepare(
      `UPDATE posts SET title=?, slug=?, excerpt=?, body_html=?, cover_image=?, category_id=?, status=?, published_at=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(
      title,
      slug,
      excerpt || '',
      sanitizeHtml(body_html || '', sanitizeOpts),
      cover,
      category_id || null,
      status || 'draft',
      publishedAt,
      req.params.id
    );

    res.redirect('/admin/posts');
  });
});

router.post('/posts/:id/delete', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post && post.cover_image) {
    const p = path.join(UPLOAD_ROOT, post.cover_image);
    fs.unlink(p, () => {});
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.redirect('/admin/posts');
});

// ---------- CATEGORIES ----------

router.get('/categories', (req, res) => {
  const categories = db
    .prepare(
      `SELECT categories.*, COUNT(posts.id) as post_count
       FROM categories LEFT JOIN posts ON posts.category_id = categories.id
       GROUP BY categories.id ORDER BY categories.name`
    )
    .all();
  res.render('admin/categories', { categories, active: 'categories' });
});

router.post('/categories', (req, res) => {
  const { name } = req.body;
  if (name && name.trim()) {
    const slug = uniqueSlug('categories', name);
    db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run(name.trim(), slug);
  }
  res.redirect('/admin/categories');
});

// Edits a category's public-facing "service" fields -- the name/slug/delete
// actions above are unrelated and stay as they were. show_on_services lets a
// category (e.g. Company News) exist for blog filtering without also showing
// up as a service on /services.
router.post('/categories/:id/update', (req, res) => {
  const description = sanitizeHtml(req.body.description || '', { allowedTags: [], allowedAttributes: {} }).trim();
  const sortOrder = parseInt(req.body.sort_order, 10) || 0;
  const showOnServices = req.body.show_on_services ? 1 : 0;
  db.prepare('UPDATE categories SET description = ?, sort_order = ?, show_on_services = ? WHERE id = ?')
    .run(description || null, sortOrder, showOnServices, req.params.id);
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categories');
});

// ---------- NOTICES ----------

router.get('/notices', (req, res) => {
  const notices = db.prepare('SELECT * FROM notices ORDER BY created_at DESC').all();
  res.render('admin/notices/list', { notices, active: 'notices' });
});

router.get('/notices/new', (req, res) => {
  res.render('admin/notices/form', { notice: null, active: 'notices' });
});

router.post('/notices', (req, res) => {
  const { title, body_html, priority, is_pinned, status, expires_at } = req.body;
  db.prepare(
    `INSERT INTO notices (title, body_html, priority, is_pinned, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    title,
    sanitizeHtml(body_html || '', sanitizeOpts),
    priority || 'normal',
    is_pinned ? 1 : 0,
    status || 'published',
    normalizeExpiry(expires_at)
  );
  res.redirect('/admin/notices');
});

router.get('/notices/:id/edit', (req, res) => {
  const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  if (!notice) return res.redirect('/admin/notices');
  res.render('admin/notices/form', { notice, active: 'notices' });
});

router.post('/notices/:id/edit', (req, res) => {
  const { title, body_html, priority, is_pinned, status, expires_at } = req.body;
  db.prepare(
    `UPDATE notices SET title=?, body_html=?, priority=?, is_pinned=?, status=?, expires_at=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    title,
    sanitizeHtml(body_html || '', sanitizeOpts),
    priority || 'normal',
    is_pinned ? 1 : 0,
    status || 'published',
    normalizeExpiry(expires_at),
    req.params.id
  );
  res.redirect('/admin/notices');
});

router.post('/notices/:id/delete', (req, res) => {
  db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id);
  res.redirect('/admin/notices');
});

// ---------- SUBSCRIBERS ----------

router.get('/subscribers', (req, res) => {
  const filter = req.query.status || 'confirmed';
  const subscribers = db
    .prepare('SELECT * FROM subscribers WHERE status = ? ORDER BY created_at DESC')
    .all(filter);
  const counts = {
    confirmed: db.prepare("SELECT COUNT(*) c FROM subscribers WHERE status='confirmed'").get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM subscribers WHERE status='pending'").get().c,
    unsubscribed: db.prepare("SELECT COUNT(*) c FROM subscribers WHERE status='unsubscribed'").get().c
  };
  res.render('admin/subscribers', { subscribers, filter, counts, active: 'subscribers' });
});

// Admin can manually add a subscriber (already confirmed — e.g. importing an existing list).
router.post('/subscribers', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (email) {
    const unsubscribeToken = crypto.randomBytes(24).toString('hex');
    db.prepare(
      `INSERT INTO subscribers (email, status, unsubscribe_token, confirmed_at)
       VALUES (?, 'confirmed', ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET status = 'confirmed', confirmed_at = datetime('now')`
    ).run(email, unsubscribeToken);
  }
  res.redirect('/admin/subscribers');
});

router.post('/subscribers/:id/delete', (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  const referer = req.get('Referer');
  res.redirect(referer && referer.includes('/admin/subscribers') ? referer : '/admin/subscribers');
});

// Export confirmed subscribers as a downloadable CSV (for backup or use with another mail tool).
router.get('/subscribers/export.csv', (req, res) => {
  const rows = db.prepare("SELECT email, created_at, confirmed_at FROM subscribers WHERE status = 'confirmed' ORDER BY created_at").all();
  let csv = 'email,subscribed_at,confirmed_at\n';
  rows.forEach((r) => {
    csv += `${r.email},${r.created_at},${r.confirmed_at || ''}\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
  res.send(csv);
});

// ---------- NEWSLETTERS ----------

router.get('/newsletters', (req, res) => {
  const newsletters = db.prepare('SELECT * FROM newsletters ORDER BY created_at DESC').all();
  const confirmedCount = db.prepare("SELECT COUNT(*) c FROM subscribers WHERE status='confirmed'").get().c;
  res.render('admin/newsletters/list', { newsletters, confirmedCount, active: 'newsletters' });
});

router.get('/newsletters/new', (req, res) => {
  res.render('admin/newsletters/form', { newsletter: null, active: 'newsletters' });
});

router.post('/newsletters', (req, res) => {
  const { subject, body_html } = req.body;
  const info = db.prepare(
    `INSERT INTO newsletters (subject, body_html, status) VALUES (?, ?, 'draft')`
  ).run(subject, sanitizeHtml(body_html || '', sanitizeOpts));
  res.redirect('/admin/newsletters/' + info.lastInsertRowid + '/edit');
});

router.get('/newsletters/:id/edit', (req, res) => {
  const newsletter = db.prepare('SELECT * FROM newsletters WHERE id = ?').get(req.params.id);
  if (!newsletter) return res.redirect('/admin/newsletters');
  res.render('admin/newsletters/form', { newsletter, active: 'newsletters' });
});

router.post('/newsletters/:id/edit', (req, res) => {
  const { subject, body_html } = req.body;
  db.prepare('UPDATE newsletters SET subject = ?, body_html = ? WHERE id = ?').run(
    subject, sanitizeHtml(body_html || '', sanitizeOpts), req.params.id
  );
  res.redirect('/admin/newsletters/' + req.params.id + '/edit');
});

router.post('/newsletters/:id/delete', (req, res) => {
  db.prepare('DELETE FROM newsletters WHERE id = ?').run(req.params.id);
  res.redirect('/admin/newsletters');
});

// Sends the newsletter to every confirmed subscriber, each with a personalized unsubscribe link.
// This can take a while for large lists — sends are fired sequentially with no attachment support
// (attachments belong to the contact-form flow, not bulk mail) to keep things simple and reliable.
router.post('/newsletters/:id/send', async (req, res) => {
  const newsletter = db.prepare('SELECT * FROM newsletters WHERE id = ?').get(req.params.id);
  if (!newsletter) return res.redirect('/admin/newsletters');

  const subscribers = db.prepare("SELECT * FROM subscribers WHERE status = 'confirmed'").all();

  let sentCount = 0;
  for (const sub of subscribers) {
    const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${sub.unsubscribe_token}`;
    const html = `
      ${newsletter.body_html}
      <hr style="margin-top:32px;border:none;border-top:1px solid #eee;">
      <p style="font-size:12px;color:#999;">
        You're receiving this because you subscribed to SharifTech updates.
        <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
    `;
    const result = await sendMail({ to: sub.email, subject: newsletter.subject, html });
    if (result.ok) sentCount++;
  }

  db.prepare(
    "UPDATE newsletters SET status = 'sent', recipients = ?, sent_at = datetime('now') WHERE id = ?"
  ).run(sentCount, newsletter.id);

  res.redirect('/admin/newsletters');
});

// ---------- MESSAGES (support / feedback inbox) ----------

router.get('/messages', (req, res) => {
  const filter = req.query.status || 'all';
  let query = 'SELECT * FROM messages';
  const params = [];
  if (filter !== 'all') {
    query += ' WHERE status = ?';
    params.push(filter);
  }
  query += ' ORDER BY created_at DESC';
  const messages = db.prepare(query).all(...params);
  res.render('admin/messages/list', { messages, filter, active: 'messages' });
});

router.get('/messages/:id', (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!message) return res.redirect('/admin/messages');
  if (message.status === 'new') {
    db.prepare("UPDATE messages SET status = 'read' WHERE id = ?").run(message.id);
    message.status = 'read';
  }
  res.render('admin/messages/detail', { message, active: 'messages' });
});

router.post('/messages/:id/status', (req, res) => {
  const { status } = req.body;
  if (['new', 'read', 'replied', 'archived'].includes(status)) {
    db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, req.params.id);
  }
  res.redirect('/admin/messages/' + req.params.id);
});

router.post('/messages/:id/delete', (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (message && message.attachment_path) {
    fs.unlink(path.join(UPLOAD_ROOT, 'messages', message.attachment_path), () => {});
  }
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.redirect('/admin/messages');
});

// ---------- SOCIALS ----------

router.get('/socials', (req, res) => {
  const socials = db.prepare('SELECT * FROM socials ORDER BY sort_order ASC').all();
  res.render('admin/socials', { socials, active: 'socials' });
});

router.post('/socials', (req, res) => {
  const { platform, url, icon } = req.body;
  const maxOrder = db.prepare('SELECT MAX(sort_order) m FROM socials').get().m || 0;
  db.prepare('INSERT INTO socials (platform, url, icon, sort_order) VALUES (?, ?, ?, ?)').run(
    platform,
    url,
    icon || 'link',
    maxOrder + 1
  );
  res.redirect('/admin/socials');
});

router.post('/socials/:id/edit', (req, res) => {
  const { platform, url, icon } = req.body;
  db.prepare('UPDATE socials SET platform=?, url=?, icon=? WHERE id=?').run(platform, url, icon, req.params.id);
  res.redirect('/admin/socials');
});

router.post('/socials/:id/toggle', (req, res) => {
  const s = db.prepare('SELECT * FROM socials WHERE id = ?').get(req.params.id);
  if (s) db.prepare('UPDATE socials SET is_active = ? WHERE id = ?').run(s.is_active ? 0 : 1, s.id);
  res.redirect('/admin/socials');
});

router.post('/socials/:id/delete', (req, res) => {
  db.prepare('DELETE FROM socials WHERE id = ?').run(req.params.id);
  res.redirect('/admin/socials');
});

// ---------- SETTINGS (site info + AdSense) ----------

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => (settings[r.key] = r.value));
  res.render('admin/settings', { settings, active: 'settings', saved: req.query.saved === '1' });
});

// Handles the site logo upload (if one was chosen) plus every other settings field.
// Uses adminImageUpload so the same size/type rules as post cover images apply.
router.post('/settings', (req, res) => {
  adminImageUpload.single('logo_file')(req, res, (err) => {
    if (err) return res.status(400).send(err.message);

    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const tx = db.transaction((entries) => {
      for (const [k, v] of entries) upsert.run(k, v);
    });

    const booleanKeys = ['adsense_enabled'];
    // theme_mode and theme_font (a light/refined/dark theme switch and a heading-font
    // picker) were removed -- SHARIF TECHNOLOGIES now has one fixed visual identity,
    // not several to drift between. theme_primary/accent/ink remain: they fine-tune
    // that one identity's colors, they don't switch stylesheets.
    const plainFields = [
      'site_name', 'tagline', 'contact_phone', 'contact_email', 'contact_location',
      'adsense_client_id', 'adsense_slot_header', 'adsense_slot_sidebar', 'adsense_slot_in_article',
      'theme_primary', 'theme_accent', 'theme_ink'
    ];
    // These three carry HTML/inline-CSS, so they go through the same sanitizer as
    // blog posts and notices -- strips <script>, event handlers, and javascript: URLs,
    // while still allowing styled divs/cards/layouts via the style attribute.
    const richTextFields = ['about_html', 'homepage_intro_html', 'custom_section_html', 'services_intro_html'];

    const entries = plainFields.map((f) => [f, req.body[f] || '']);
    richTextFields.forEach((f) => entries.push([f, sanitizeHtml(req.body[f] || '', sanitizeOpts)]));
    booleanKeys.forEach((k) => entries.push([k, req.body[k] ? '1' : '0']));

    if (req.file) {
      // Delete the previous custom logo from disk (if any) before switching to the new one —
      // never deletes the bundled default, since that isn't tracked as a setting value.
      const existing = db.prepare("SELECT value FROM settings WHERE key = 'logo_path'").get();
      if (existing && existing.value) {
        fs.unlink(path.join(UPLOAD_ROOT, existing.value), () => {});
      }
      entries.push(['logo_path', path.relative(UPLOAD_ROOT, req.file.path)]);
    } else if (req.body.remove_logo === '1') {
      const existing = db.prepare("SELECT value FROM settings WHERE key = 'logo_path'").get();
      if (existing && existing.value) {
        fs.unlink(path.join(UPLOAD_ROOT, existing.value), () => {});
      }
      entries.push(['logo_path', '']);
    }

    tx(entries);
    res.redirect('/admin/settings?saved=1');
  });
});

// ---------- UI STRINGS (Phase 1: public-facing page text) ----------

router.get('/ui-strings', (req, res) => {
  const rows = db.prepare('SELECT * FROM ui_strings ORDER BY page_group, string_key').all();
  const grouped = {};
  rows.forEach((r) => {
    if (!grouped[r.page_group]) grouped[r.page_group] = [];
    grouped[r.page_group].push(r);
  });
  res.render('admin/ui-strings', { grouped, search: req.query.q || '', active: 'ui-strings' });
});

router.post('/ui-strings/:id/save', (req, res) => {
  const { value } = req.body;
  db.prepare("UPDATE ui_strings SET value = ?, updated_at = datetime('now') WHERE id = ?").run(
    value && value.trim() ? value : null, // empty submission means "use the default" -- never store a blank override
    req.params.id
  );
  invalidateUiStringsCache();
  const referer = req.get('Referer');
  res.redirect(referer && referer.includes('/admin/ui-strings') ? referer : '/admin/ui-strings');
});

router.post('/ui-strings/:id/reset', (req, res) => {
  db.prepare("UPDATE ui_strings SET value = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  invalidateUiStringsCache();
  const referer = req.get('Referer');
  res.redirect(referer && referer.includes('/admin/ui-strings') ? referer : '/admin/ui-strings');
});

module.exports = router;

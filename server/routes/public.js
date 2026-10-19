const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { makeTranslator } = require('../lib/uiStrings');
const { getSettings, getSocials } = require('../lib/siteData');

function getActiveNotices() {
  return db
    .prepare(
      `SELECT * FROM notices
       WHERE status = 'published'
         AND (expires_at IS NULL OR expires_at >= datetime('now'))
       ORDER BY is_pinned DESC, created_at DESC`
    )
    .all();
}

// Make settings/socials/t (editable UI text) available to every view without
// repeating this setup in each route.
router.use((req, res, next) => {
  res.locals.settings = getSettings();
  res.locals.socials = getSocials();
  res.locals.t = makeTranslator();
  next();
});

router.get('/', (req, res) => {
  const posts = db
    .prepare(
      `SELECT posts.*, categories.name AS category_name
       FROM posts LEFT JOIN categories ON categories.id = posts.category_id
       WHERE posts.status = 'published'
       ORDER BY posts.published_at DESC LIMIT 6`
    )
    .all();

  // Full active list (not sliced) — pinned notices need to always be visible in the
  // persistent banner, and the Notices tab shows everything, not just the first few.
  const notices = getActiveNotices();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('home', { posts, notices, categories, page: 'home' });
});

router.get('/blog', (req, res) => {
  const categorySlug = req.query.category || null;
  const search = (req.query.q || '').trim();

  let query = `SELECT posts.*, categories.name AS category_name, categories.slug AS category_slug
               FROM posts LEFT JOIN categories ON categories.id = posts.category_id
               WHERE posts.status = 'published'`;
  const params = [];

  if (categorySlug) {
    query += ' AND categories.slug = ?';
    params.push(categorySlug);
  }
  if (search) {
    query += ' AND (posts.title LIKE ? OR posts.excerpt LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY posts.published_at DESC';

  const posts = db.prepare(query).all(...params);
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('blog', { posts, categories, categorySlug, search, page: 'blog' });
});

router.get('/blog/:slug', (req, res) => {
  const post = db
    .prepare(
      `SELECT posts.*, categories.name AS category_name
       FROM posts LEFT JOIN categories ON categories.id = posts.category_id
       WHERE posts.slug = ? AND posts.status = 'published'`
    )
    .get(req.params.slug);

  if (!post) {
    return res.status(404).render('404', { page: '' });
  }

  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);

  const relatedPosts = db
    .prepare(
      `SELECT * FROM posts
       WHERE status = 'published' AND category_id = ? AND id != ?
       ORDER BY published_at DESC LIMIT 3`
    )
    .all(post.category_id, post.id);

  res.render('post', { post, relatedPosts, page: 'blog' });
});

router.get('/notices', (req, res) => {
  const notices = getActiveNotices();
  res.render('notices', { notices, page: 'notices' });
});

router.get('/connect', (req, res) => {
  res.render('connect', { page: 'connect' });
});

router.get('/contact', (req, res) => {
  res.render('contact', { page: 'contact' });
});

router.get('/about', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('about', { categories, page: 'about' });
});

router.get('/services', (req, res) => {
  const services = db
    .prepare(
      `SELECT categories.*, COUNT(posts.id) AS post_count
       FROM categories LEFT JOIN posts ON posts.category_id = categories.id AND posts.status = 'published'
       WHERE categories.show_on_services = 1
       GROUP BY categories.id
       ORDER BY categories.sort_order, categories.name`
    )
    .all();
  res.render('services', { services, page: 'services' });
});

// Only canonical, indexable entry points -- never /admin, /api, or the
// query-string variants of /blog (category/search), which canonicalize back
// to their base URLs anyway (see blog.ejs) and would just be duplicates here.
router.get('/sitemap.xml', (req, res) => {
  const posts = db
    .prepare(`SELECT slug, published_at, updated_at FROM posts WHERE status = 'published'`)
    .all();

  const toDate = (sqliteDatetime) => {
    if (!sqliteDatetime) return null;
    const d = new Date(sqliteDatetime + ' UTC');
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  const staticUrls = [
    { loc: '/', changefreq: 'daily', priority: '1.0' },
    { loc: '/about', changefreq: 'monthly', priority: '0.8' },
    { loc: '/services', changefreq: 'monthly', priority: '0.8' },
    { loc: '/blog', changefreq: 'daily', priority: '0.9' },
    { loc: '/notices', changefreq: 'weekly', priority: '0.6' },
    { loc: '/connect', changefreq: 'monthly', priority: '0.5' },
    { loc: '/contact', changefreq: 'monthly', priority: '0.5' },
    { loc: '/privacy-policy', changefreq: 'yearly', priority: '0.2' },
    { loc: '/terms-of-service', changefreq: 'yearly', priority: '0.2' },
    { loc: '/cookie-policy', changefreq: 'yearly', priority: '0.2' },
    { loc: '/copyright', changefreq: 'yearly', priority: '0.2' }
  ];

  const siteUrl = res.locals.siteUrl;
  const escapeXml = (s) => s.replace(/&/g, '&amp;');
  const urlEntries = staticUrls
    .map((u) => `  <url><loc>${escapeXml(siteUrl + u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`)
    .concat(
      posts.map((p) => {
        const lastmod = toDate(p.updated_at) || toDate(p.published_at);
        return `  <url><loc>${escapeXml(siteUrl + '/blog/' + p.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.7</priority></url>`;
      })
    )
    .join('\n');

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`
  );
});

// ---------- Legal pages ----------
router.get('/privacy-policy', (req, res) => {
  res.render('legal/privacy-policy', { page: 'privacy-policy' });
});

router.get('/terms-of-service', (req, res) => {
  res.render('legal/terms-of-service', { page: 'terms-of-service' });
});

router.get('/cookie-policy', (req, res) => {
  res.render('legal/cookie-policy', { page: 'cookie-policy' });
});

router.get('/copyright', (req, res) => {
  res.render('legal/copyright', { page: 'copyright' });
});

module.exports = router;

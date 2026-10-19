require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Where the sqlite file + session files live. Defaults to server/db (this
// codebase's original, non-Docker layout) so nothing changes for a bare
// PM2/VPS install per the README -- but in a container, server/db also
// holds pure code (connection.js, init.js, schema.sql, migrations/) that
// must come fresh from every image build. Bind-mounting a persistent
// volume over the whole server/db directory would shadow that code with
// whatever was there when the volume was first created, silently freezing
// future code updates. Pointing DATA_DIR at a separate path (e.g. /app/data
// in docker-compose.yml) keeps the sqlite file + sessions persistent
// without ever touching the code directory.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'db');

const sessionsDir = path.join(DATA_DIR, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

// This existence check MUST run before anything below requires
// ./routes/* -- those transitively require ./db/connection, and simply
// *opening* node:sqlite's DatabaseSync against a path creates an empty
// file as a side effect, even before any table exists. Checking after
// that require would always find the file "already there" (empty) and
// never actually run first-time setup on a genuinely fresh install.
if (!fs.existsSync(path.join(DATA_DIR, 'shariftech.sqlite3'))) {
  console.log('No database found — running first-time setup automatically...');
  require('./db/init');
}

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');

const publicRoutes = require('./routes/public');
const publicApiRoutes = require('./routes/publicApi');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRoutes = require('./routes/admin');
const adminAiRoutes = require('./routes/admin/ai');
const { getSettings, getSocials } = require('./lib/siteData');
const { makeTranslator } = require('./lib/uiStrings');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Ensure required folders exist on first run ----------
const uploadDirs = [
  'admin',    // blog post cover images and other admin-uploaded images
  'messages'  // optional image attachments from the Contact/Support form
];
uploadDirs.forEach((d) => {
  const dir = path.join(__dirname, 'uploads', d);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use((req, res, next) => {
  res.locals.currentUrl = req.originalUrl;
  res.locals.currentPath = req.path;
  next();
});

// Real public URL used to build absolute canonical/OG URLs and the sitemap.
// Falls back to the production domain rather than an empty string so a
// misconfigured .env doesn't silently emit broken "//blog" URLs.
const SITE_URL = (process.env.SITE_URL || 'https://shariftechnologies.online').replace(/\/$/, '');
app.use((req, res, next) => {
  res.locals.siteUrl = SITE_URL;
  next();
});

// ---------- Security & parsing ----------
app.use(
  helmet({
    contentSecurityPolicy: false // relaxed so AdSense scripts / inline styles from CMS content work;
    // tighten this with a custom CSP once you've finalized your ad + embed sources.
  })
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// ---------- Sessions (used for admin login only) ----------
// Sessions are stored as plain JSON files on disk (server/db/sessions/) rather than
// in SQLite — avoids a second native-dependency package for something this small,
// and needs zero setup. Stale session files older than the cookie's maxAge are
// cleaned up automatically.
app.use(
  session({
    store: new FileStore({
      path: path.join(__dirname, 'db', 'sessions'),
      ttl: 60 * 60 * 8, // 8 hours, matches cookie maxAge below
      retries: 1,
      logFn: () => {} // silence session-file-store's default console logging
    }),
    secret: process.env.SESSION_SECRET || 'insecure_dev_secret_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

// ---------- Static files ----------
app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Google AdSense requires ads.txt to be reachable at the site ROOT (/ads.txt), not
// under /static -- a dedicated route is more precise than mounting all of public/
// at root (which would also expose every other public/ file at two different URLs).
app.get('/ads.txt', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ads.txt'));
});

// Same reasoning as /ads.txt above: crawlers expect this at the site root,
// not under /static. Generated (not sendFile'd) so the Sitemap: line always
// matches the real SITE_URL rather than a hardcoded domain that could drift
// from a staging/.env override.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /api/', '', `Sitemap: ${SITE_URL}/sitemap.xml`].join('\n')
  );
});

// ---------- Routes ----------
app.use('/api', publicApiRoutes);
app.use('/admin', adminAuthRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/ai', adminAiRoutes);
app.use('/', publicRoutes);

// ---------- 404 / 500: rendered with the same header/footer as every other
// page (Phase 17 -- a dead end with no navigation is a bad experience and,
// for 404, an indexing dead end too). These run outside publicRoutes'
// router-level middleware, so settings/socials/t are supplied here directly
// rather than assumed to already be on res.locals.
function withSiteLocals(res) {
  res.locals.settings = getSettings();
  res.locals.socials = getSocials();
  res.locals.t = makeTranslator();
}

app.use((req, res) => {
  withSiteLocals(res);
  res.status(404).render('404', { page: '' });
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error(err);
  withSiteLocals(res);
  // Never pass err.message to the view -- it can contain internal details
  // (query text, file paths) depending on what actually failed, and this
  // page is public.
  res.status(500).render('500', { page: '' });
});

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`SharifTech website running → http://${HOST}:${PORT} (accessible on all network interfaces)`);

  // The scheduler only checks for and runs jobs that an admin has explicitly created
  // and activated (see Admin > AI > Schedules) -- starting it here just means it's
  // ready to act on those jobs; on a fresh install with no schedules configured, this
  // is a once-a-minute no-op. Only starts at all if an API key is present, since
  // without one every check would just fail with the same "GEMINI_API_KEY is not set"
  // error repeatedly -- no point running that loop until AI is actually configured.
  if (process.env.GEMINI_API_KEY) {
    const { startScheduler } = require('./ai/scheduler');
    startScheduler();
  } else {
    console.log('GEMINI_API_KEY not set — AI content scheduler not started. Add it to .env to enable AI features.');
  }
});

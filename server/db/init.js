// One-time (and safe-to-rerun) setup script.
// Run with: npm run setup
// Creates the database file, all tables, and your first admin login
// using ADMIN_EMAIL / ADMIN_PASSWORD from your .env file.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./connection');

// If SESSION_SECRET is missing or still the placeholder from .env.example, generate a
// real one and write it into .env automatically -- this is the one field with no
// meaningful default a person could type themselves, so there's no reason to make
// anyone copy/paste a crypto command by hand. Every other setting either has a safe
// built-in default (falls back gracefully) or is something you're expected to choose
// yourself (ADMIN_PASSWORD, SMTP credentials), so those are left alone here.
function ensureSessionSecret() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  const placeholder = 'change_this_to_a_long_random_string';
  const current = process.env.SESSION_SECRET;

  if (current && current !== placeholder) return; // already set to something real

  if (!fs.existsSync(envPath)) {
    console.log('⚠ No .env file found — copy .env.example to .env first, then re-run npm run setup.');
    return;
  }

  const generated = crypto.randomBytes(48).toString('hex');
  let envContent = fs.readFileSync(envPath, 'utf8');

  if (/^SESSION_SECRET=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${generated}`);
  } else {
    envContent += `\nSESSION_SECRET=${generated}\n`;
  }

  fs.writeFileSync(envPath, envContent);
  process.env.SESSION_SECRET = generated;
  console.log('✔ Generated a new SESSION_SECRET and saved it to .env automatically.');
}

function run() {
  ensureSessionSecret();

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  console.log('✔ Tables created (or already existed).');

  // Seed default settings if not already present.
  const defaultSettings = {
    site_name: 'SHARIF TECHNOLOGIES',
    tagline: 'Knowledge Is Power',
    about_html: '<p>SharifTech builds custom software, mobile apps, cybersecurity solutions and network infrastructure — and trains the next generation of ICT talent in Wenchi, Bono Region, Ghana.</p>',
    contact_phone: '0599254830',
    contact_email: 'sharifissah74@gmail.com',
    contact_location: 'Wenchi, Bono Region, Ghana',
    adsense_client_id: process.env.ADSENSE_CLIENT_ID || '',
    adsense_enabled: '0',
    adsense_slot_header: '',
    adsense_slot_sidebar: '',
    adsense_slot_in_article: '',
    theme_primary: '#123a8f',
    theme_accent: '#3ec6ff',
    theme_ink: '#0a1128',
    theme_font: 'fraunces', // fraunces | inter | poppins — see THEME_FONTS in admin routes
    logo_path: '', // empty = use the default bundled logo at /static/images/logo.png
    // Shown ONLY on the homepage hero/intro area -- independent from about_html, which
    // stays reserved for the footer and Connect panel. Splitting these two apart is what
    // lets the homepage carry longer, richer copy without also bloating the footer.
    homepage_intro_html: '',
    // A free-form HTML/CSS block an admin can use to add new visual sections to the
    // homepage without a code deploy -- cards, banners, embeds, custom layouts, styled
    // via inline CSS. Sanitized the same way blog posts and notices are (safe tags/attrs
    // only -- no <script>, no event handlers, no external code execution) so it can't be
    // used to compromise the site or its visitors, even by a trusted admin's own mistake.
    custom_section_html: '',
    // Optional intro paragraph shown at the top of the dedicated /services page,
    // above the per-service cards. Blank by default -- the page works fine without
    // it, using just the category name/description cards.
    services_intro_html: '',
    // AI Content module settings. The API key itself lives in .env (GEMINI_API_KEY),
    // never in this table, since settings are readable/editable from the admin UI and
    // a secret key should never be stored or displayed there. Only non-secret config
    // (which model to use) lives here, so switching models is a dashboard edit, not a
    // code change or redeploy.
    ai_provider: 'gemini',
    ai_model: 'gemini-1.5-flash', // stable, production-ready, most generous free-tier limits as of mid-2026
    // Toggles the optional dark/glow "live UI" theme (public-facing pages only --
    // never affects the admin dashboard). Defaults to 'light' -- the dark theme is
    // strictly opt-in via Admin > Settings, never the default look for new installs.
    theme_mode: 'light' // light | refined | dark
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const settingsTx = db.transaction((entries) => {
    for (const [k, v] of entries) insertSetting.run(k, v);
  });
  settingsTx(Object.entries(defaultSettings));
  console.log('✔ Default settings seeded.');

  // Seed default categories. Categories double as public "services" (see the
  // description/sort_order/show_on_services columns) -- Company News is a real
  // blog category but not a service, so it's excluded from the services page.
  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO categories (name, slug, description, sort_order, show_on_services) VALUES (?, ?, ?, ?, ?)'
  );
  const cats = [
    ['Web Development', 'web-development', 'Websites for businesses that need to present information clearly, and web apps for ones that need logins, accounts, or data that changes per visitor. We build both, and tell you honestly which one your project actually needs before you pay for the more expensive option.', 1, 1],
    ['Mobile Apps', 'mobile-apps', "Native apps for businesses that genuinely need a home-screen icon, offline access, or device features a browser can't reach -- and a mobile-friendly website when that's the better fit instead. We'd rather save you the cost of an app you don't need yet.", 2, 1],
    ['Cybersecurity', 'cybersecurity', 'Practical security assessments and setup: password managers instead of reused passwords, backups stored away from the original data, staff awareness training, and a periodic review of who has access to what. Built to be realistic to maintain, not just secure on day one.', 3, 1],
    ['Networking', 'networking', 'We design, install, and manage office networks -- sized for how many devices you actually have (and will have), with guest and business traffic properly separated, access points placed for your actual building, and monitoring in place so problems get caught early.', 4, 1],
    ['ICT Training', 'ict-training', "Practical, hands-on training in software and web development fundamentals, networking basics, cybersecurity awareness, and general digital skills -- for students, career changers, and staff who need to actually use the tools they're expected to use.", 5, 1],
    ['Company News', 'company-news', null, 6, 0]
  ];
  const catTx = db.transaction((rows) => {
    for (const [name, slug, description, sortOrder, showOnServices] of rows) {
      insertCategory.run(name, slug, description, sortOrder, showOnServices);
    }
  });
  catTx(cats);
  console.log('✔ Default categories seeded.');

  // Seed default socials (edit or delete these anytime from Admin > Socials).
  const socialCount = db.prepare('SELECT COUNT(*) AS c FROM socials').get().c;
  if (socialCount === 0) {
    const insertSocial = db.prepare(
      'INSERT INTO socials (platform, url, icon, sort_order) VALUES (?, ?, ?, ?)'
    );
    const socialTx = db.transaction((rows) => {
      rows.forEach((r, i) => insertSocial.run(r.platform, r.url, r.icon, i));
    });
    socialTx([
      { platform: 'WhatsApp', url: 'https://wa.me/233599254830', icon: 'whatsapp' },
      { platform: 'Email', url: 'mailto:sharifissah74@gmail.com', icon: 'mail' },
      { platform: 'Facebook', url: 'https://facebook.com', icon: 'facebook' },
      { platform: 'YouTube', url: 'https://youtube.com', icon: 'youtube' }
    ]);
    console.log('✔ Default social links seeded (edit these in the dashboard).');
  }

  // Create the first admin if none exists, or keep the existing one in sync
  // with .env on every run (this script runs on every deploy -- see
  // deploy-vps.yml). Without this, ADMIN_EMAIL/ADMIN_PASSWORD only ever took
  // effect at the single moment the admins table first went from empty to
  // non-empty -- changing .env afterward silently did nothing, since login
  // only ever checks the hash already stored in the database. .env is meant
  // to be the source of truth for this one login, so it should actually win.
  //
  // Only touches the existing row when .env actually sets ADMIN_EMAIL or
  // ADMIN_PASSWORD -- never forces the insecure default onto an account that
  // already has a real password just because .env doesn't set one (e.g. a
  // bare `npm run setup` in local dev with no .env at all).
  //
  // Trade-off worth knowing: a password changed via Admin > Change Password
  // in the dashboard gets overwritten back to .env's value on the next
  // deploy. Update .env (and redeploy) to actually change the password
  // going forward, rather than the in-app form, or the two will fight.
  const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  const envEmail = process.env.ADMIN_EMAIL;
  const envPassword = process.env.ADMIN_PASSWORD;

  if (adminCount === 0) {
    const email = envEmail || 'admin@shariftech.com';
    const password = envPassword || 'ChangeMe123!';
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(
      'INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)'
    ).run('Admin', email, hash);
    console.log(`✔ First admin account created: ${email}`);
    if (!envPassword || envPassword === 'ChangeMe123!') {
      console.log('  ⚠ ADMIN_PASSWORD was not set in .env, so the insecure default "ChangeMe123!" was used.');
      console.log('    Log in and change it immediately via Admin > Change Password.');
    } else {
      console.log('  → Log in at /admin/login with the password you set in .env.');
    }
  } else if (envEmail || envPassword) {
    const admin = db.prepare('SELECT * FROM admins ORDER BY id LIMIT 1').get();
    const newEmail = envEmail || admin.email;
    const newHash = envPassword ? bcrypt.hashSync(envPassword, 12) : admin.password_hash;
    db.prepare('UPDATE admins SET email = ?, password_hash = ? WHERE id = ?').run(newEmail, newHash, admin.id);
    console.log(`✔ Admin account synced with .env: ${newEmail}`);
  } else {
    console.log('✔ Admin account already exists — skipping (no ADMIN_EMAIL/ADMIN_PASSWORD set in .env to sync).');
  }

  console.log('\nSetup complete. Start the site with: npm start');
}

run();

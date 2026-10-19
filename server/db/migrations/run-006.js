// Turns the existing blog categories into real, admin-editable "services":
// 1. Adds description/sort_order/show_on_services columns to categories.
// 2. Populates real descriptions for the 5 actual services (sourced from the
//    already-published blog posts in run-005.js, not invented for this page),
//    and excludes "Company News" from the public services page -- it's a real
//    blog category, but not a service.
// 3. Adds the services_intro_html setting (optional free-form intro shown
//    above the service cards on /services).
//
// This is what finally makes the "Services" nav link point at a real,
// indexable /services page instead of a homepage tab anchor (/#services) --
// content lives in the categories table from here on, editable from
// Admin > Categories, not hardcoded into a template.
//
// Safe to run more than once: columns are added only if missing, and
// descriptions are only set for a category whose description is currently
// NULL, so it never overwrites an edit made from the dashboard after the
// first run.

const db = require('../connection');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

console.log('Running services/categories migration...\n');

const columnsToAdd = [
  { column: 'description', ddl: 'ALTER TABLE categories ADD COLUMN description TEXT' },
  { column: 'sort_order', ddl: 'ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0' },
  { column: 'show_on_services', ddl: 'ALTER TABLE categories ADD COLUMN show_on_services INTEGER NOT NULL DEFAULT 1' }
];
for (const { column, ddl } of columnsToAdd) {
  if (columnExists('categories', column)) {
    console.log(`- categories.${column} already exists, skipping.`);
    continue;
  }
  db.exec(ddl);
  console.log(`✔ Added categories.${column}`);
}

const serviceDefaults = [
  {
    slug: 'web-development',
    sort_order: 1,
    description: 'Websites for businesses that need to present information clearly, and web apps for ones that need logins, accounts, or data that changes per visitor. We build both, and tell you honestly which one your project actually needs before you pay for the more expensive option.'
  },
  {
    slug: 'mobile-apps',
    sort_order: 2,
    description: "Native apps for businesses that genuinely need a home-screen icon, offline access, or device features a browser can't reach -- and a mobile-friendly website when that's the better fit instead. We'd rather save you the cost of an app you don't need yet."
  },
  {
    slug: 'cybersecurity',
    sort_order: 3,
    description: 'Practical security assessments and setup: password managers instead of reused passwords, backups stored away from the original data, staff awareness training, and a periodic review of who has access to what. Built to be realistic to maintain, not just secure on day one.'
  },
  {
    slug: 'networking',
    sort_order: 4,
    description: 'We design, install, and manage office networks -- sized for how many devices you actually have (and will have), with guest and business traffic properly separated, access points placed for your actual building, and monitoring in place so problems get caught early.'
  },
  {
    slug: 'ict-training',
    sort_order: 5,
    description: "Practical, hands-on training in software and web development fundamentals, networking basics, cybersecurity awareness, and general digital skills -- for students, career changers, and staff who need to actually use the tools they're expected to use."
  },
  { slug: 'company-news', sort_order: 6, show_on_services: 0 }
];

const getCategory = db.prepare('SELECT * FROM categories WHERE slug = ?');
const updateDescription = db.prepare('UPDATE categories SET description = ? WHERE id = ?');
const updateSortOrder = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
const updateVisibility = db.prepare('UPDATE categories SET show_on_services = ? WHERE id = ?');

for (const svc of serviceDefaults) {
  const category = getCategory.get(svc.slug);
  if (!category) {
    console.log(`! category "${svc.slug}" not found, skipping.`);
    continue;
  }
  if (svc.description) {
    if (category.description === null) {
      updateDescription.run(svc.description, category.id);
      console.log(`✔ Set description for "${svc.slug}"`);
    } else {
      console.log(`- "${svc.slug}" already has a description, leaving it as-is.`);
    }
  }
  if (category.sort_order === 0 && svc.sort_order) {
    updateSortOrder.run(svc.sort_order, category.id);
  }
  if (svc.show_on_services === 0) {
    updateVisibility.run(0, category.id);
    console.log(`✔ Excluded "${svc.slug}" from the public services page`);
  }
}

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
const before = db.prepare("SELECT 1 FROM settings WHERE key = 'services_intro_html'").get();
insertSetting.run('services_intro_html', '');
console.log(before ? '- setting "services_intro_html" already exists, skipping.' : '✔ Added setting "services_intro_html"');

console.log('\nMigration complete.');

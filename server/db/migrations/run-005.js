// Content/branding refresh:
// 1. Removes the old light/refined/dark theme + heading-font settings (the
//    feature itself was removed from head.ejs/admin/settings.ejs/admin.js --
//    this clears any live value an admin had switched to, so the site can't
//    keep rendering a stylesheet that no longer exists).
// 2. Copies the new cover-image assets from server/db/seed-images/ (a normal
//    git-tracked path, safe to ship in the Docker image) into
//    server/uploads/admin/ -- the actual persistent uploads volume at
//    runtime (see docker-compose.yml's website_data/uploads mount), which a
//    plain rsync deploy can never reach since it's bind-mounted from outside
//    the code checkout.
// 3. Seeds one real blog post per existing category, referencing those
//    copied cover images. Content lives in the posts table from here on --
//    editable/replaceable from Admin > Blog Posts like any other post, not
//    hardcoded into a template.
//
// Safe to run more than once: image copies check existence first, and posts
// are looked up by slug before inserting (skipped if already present, so a
// re-run never overwrites admin edits made after the first run).

const fs = require('fs');
const path = require('path');
const db = require('../connection');

console.log('Running content/branding refresh migration...\n');

// ---------- 1. Clear the removed theme settings ----------
const removedThemeKeys = ['theme_mode', 'theme_font'];
const del = db.prepare('DELETE FROM settings WHERE key = ?');
removedThemeKeys.forEach((k) => {
  const existed = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k);
  del.run(k);
  console.log(existed ? `✔ Cleared removed setting "${k}"` : `- setting "${k}" was not set, nothing to clear.`);
});

// ---------- 2. Copy seed cover images into the persistent uploads dir ----------
const SEED_DIR = path.join(__dirname, '..', 'seed-images');
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'admin');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const seedImages = [
  'cybersecurity-cover.jpg',
  'web-development-cover.jpg',
  'networking-cover.jpg',
  'ict-training-cover.jpg',
  'mobile-apps-cover.jpg',
  'company-news-cover.jpg'
];
for (const name of seedImages) {
  const dest = path.join(UPLOAD_DIR, name);
  if (fs.existsSync(dest)) {
    console.log(`- ${name} already present in uploads, skipping copy.`);
  } else {
    fs.copyFileSync(path.join(SEED_DIR, name), dest);
    console.log(`✔ Copied ${name} into uploads/admin/`);
  }
}

// ---------- 3. Seed one real post per category ----------
// post.ejs renders <img src="/uploads/<%= post.cover_image %>">, and the admin
// upload handler stores the path relative to UPLOAD_ROOT (server/uploads/),
// which for a cover image is always "admin/<filename>" -- match that
// convention here so these posts' covers resolve the same way an
// admin-uploaded one would.
const posts = [
  {
    slug: 'a-refreshed-website-for-sharif-technologies',
    category_slug: 'company-news',
    title: 'A Refreshed Website for SHARIF TECHNOLOGIES',
    excerpt: "We've rebuilt this site to actually show what we do -- our services, our work, and easier ways to reach us.",
    cover_image: 'admin/company-news-cover.jpg',
    body_html: `
<p>We've spent time rebuilding this website so it does a better job of showing what SHARIF TECHNOLOGIES actually does, rather than just existing as a placeholder with a contact form.</p>
<p>Here's what's here now:</p>
<ul>
<li><strong>A real blog</strong> -- practical write-ups on software, cybersecurity, networking, mobile apps and ICT training, organized so you can find what's relevant to you.</li>
<li><strong>Notices</strong> -- a place for announcements that matters to our clients and community, kept separate from blog content.</li>
<li><strong>Clearer ways to reach us</strong> -- phone, email, WhatsApp and our other social channels, all in one place on the Connect page.</li>
</ul>
<p>We're based in Wenchi, in Ghana's Bono Region, and we work with businesses and individuals who need software built, systems secured, networks that actually stay up, and people trained to use technology properly. That's the whole focus of this site going forward: useful information, not filler.</p>
<p>If there's something you'd like to see covered here, or a project you want to talk through, <a href="/contact">get in touch</a> -- we read every message.</p>
`.trim()
  },
  {
    slug: 'cybersecurity-is-not-just-antivirus',
    category_slug: 'cybersecurity',
    title: "Cybersecurity Isn't Just Antivirus: What Small Businesses Actually Need",
    excerpt: 'Antivirus software is one small piece. Here is what actually keeps a small business from losing data, money, or customer trust.',
    cover_image: 'admin/cybersecurity-cover.jpg',
    body_html: `
<p>When most small business owners think "cybersecurity," they think antivirus software. It's a useful piece, but it's a small one -- most real incidents we see have nothing to do with viruses at all. They come from weak passwords, no backups, and staff who were never shown what a phishing attempt looks like.</p>
<h2>Where the actual risk is</h2>
<ul>
<li><strong>Reused or weak passwords.</strong> One leaked password from an unrelated site can unlock your email, your accounting software, and your customer database if the same password is used everywhere.</li>
<li><strong>No real backup plan.</strong> A backup that lives on the same computer it's backing up isn't a backup -- it's a second copy of the same risk. If that machine fails or is compromised, both copies go with it.</li>
<li><strong>Untrained staff.</strong> Most break-ins start with someone clicking a link in a convincing email, not a technical exploit. A five-minute conversation about what to look for prevents more incidents than most security software does.</li>
<li><strong>No one checking, ever.</strong> Systems that are set up once and never reviewed tend to accumulate gaps -- an old account that was never disabled, a shared password nobody rotated, a port left open from a project that ended a year ago.</li>
</ul>
<h2>What a proper setup looks like</h2>
<p>In practice, this means: password managers instead of memorized (reused) passwords, backups stored somewhere separate from the original data and tested occasionally, basic staff awareness of phishing and social engineering, and a periodic review of who has access to what.</p>
<p>None of this requires a large budget -- it requires actually doing it, and doing it as an ongoing habit rather than a one-time project. That's the kind of assessment and setup we do for clients: look at what's actually exposed, fix the real gaps, and leave you with a system that's realistic to maintain, not one that only works if someone remembers to babysit it.</p>
<p>If you're not sure where your business actually stands, <a href="/contact">reach out</a> and we'll walk through it with you.</p>
`.trim()
  },
  {
    slug: 'website-or-web-app-what-actually-matters',
    category_slug: 'web-development',
    title: 'Website or Web App? What Actually Matters When Deciding',
    excerpt: 'The difference isn’t about how modern something looks -- it’s about whether visitors just read, or actually do something.',
    cover_image: 'admin/web-development-cover.jpg',
    body_html: `
<p>"Website" and "web app" get used interchangeably, but the difference matters when you're deciding what to actually build and budget for.</p>
<h2>A website</h2>
<p>A website presents information: who you are, what you offer, how to reach you. Visitors read it -- they don't log in, submit orders, or manage an account. Most businesses that just need an online presence -- a menu, a portfolio, a services page, contact details -- need this, not more. It's faster to build, cheaper to maintain, and there's no ongoing need to manage user accounts or data.</p>
<h2>A web app</h2>
<p>A web app is interactive: visitors log in, data is stored per user, and something changes based on what they do -- placing an order, tracking a delivery, managing a booking, viewing account-specific information. This needs a database, user accounts, and ongoing maintenance as the underlying pieces (frameworks, security patches) change over time. It costs more to build and to keep running, because there's more actually happening behind the page.</p>
<h2>How to actually decide</h2>
<p>Ask one question: does a visitor need to see something different from every other visitor, or take an action that changes data? If yes, you need a web app. If every visitor is looking at the same information, a well-built website does the job -- and building a web app for that case just adds cost and maintenance with no real benefit.</p>
<p>We build both, and we'll tell you honestly which one your actual use case needs -- not the more expensive option by default. <a href="/contact">Tell us what you're trying to do</a> and we'll help you figure out which one fits.</p>
`.trim()
  },
  {
    slug: 'do-you-need-a-mobile-app',
    category_slug: 'mobile-apps',
    title: 'Do You Need a Mobile App, or Would a Mobile-Friendly Website Do?',
    excerpt: 'A native app is a real investment. Here is how to tell whether your business actually needs one yet.',
    cover_image: 'admin/mobile-apps-cover.jpg',
    body_html: `
<p>A mobile app feels like the obvious next step once a business is established -- but it's a bigger commitment than most people expect, and it isn't always the right next move.</p>
<h2>What a mobile app actually gives you that a website doesn't</h2>
<ul>
<li><strong>An icon on the home screen</strong> -- repeat visits become a tap instead of a search.</li>
<li><strong>Offline access</strong> to at least some content or functionality.</li>
<li><strong>Push notifications</strong> -- if you genuinely need to reach users directly and often.</li>
<li><strong>Access to device features</strong> a browser can't reliably use -- camera, GPS in the background, certain hardware integrations.</li>
</ul>
<p>If your use case doesn't actually need any of these, a responsive, mobile-friendly website gets you almost the same reach at a fraction of the cost -- no app store approval process, no separate iOS/Android builds to maintain, and no update cycle where users have to actually download a new version before they see a fix.</p>
<h2>When an app is worth it</h2>
<p>It's worth it when customers use your service often enough that a home-screen icon matters, when you need offline functionality, or when the product genuinely depends on device hardware. It's usually not worth it for a business that mainly needs people to find information, place an occasional order, or fill out a form -- a well-built site does that job without the ongoing cost of maintaining two separate app builds.</p>
<p>We build both, and we'd rather tell you a mobile-friendly website is the right call -- and save you the cost -- than sell you an app you don't need yet. <a href="/contact">Talk to us about what you're actually trying to achieve</a> and we'll give you a straight answer.</p>
`.trim()
  },
  {
    slug: 'why-office-networks-fail',
    category_slug: 'networking',
    title: 'Why Office Networks Fail (and How to Set One Up Properly)',
    excerpt: 'Most network problems trace back to how the network was set up in the first place, not bad luck.',
    cover_image: 'admin/networking-cover.jpg',
    body_html: `
<p>Almost every "the internet is slow" or "the network keeps dropping" complaint we get called out for traces back to how the network was originally set up, not a sudden failure.</p>
<h2>The common mistakes</h2>
<ul>
<li><strong>One router doing everything.</strong> A single consumer-grade router serving an entire office, with no separation between guest traffic, staff traffic, and whatever's plugged into a back-room switch, degrades fast as more devices join.</li>
<li><strong>No plan for growth.</strong> A network wired for five devices strains badly at twenty-five -- and by then, ripping out and redoing the cabling is far more disruptive than planning ahead would have been.</li>
<li><strong>Weak Wi-Fi coverage.</strong> One access point in a corner of the building means the far end of the office runs on a weak signal, and everyone blames "the internet" instead of the actual cause.</li>
<li><strong>No monitoring.</strong> Without any visibility into what's actually happening on the network, problems get discovered only when someone notices things are slow -- long after the cause started.</li>
</ul>
<h2>What a proper setup looks like</h2>
<p>Reliable business networking means planning for the number of devices you'll actually have (including growth), separating traffic where it matters (guest Wi-Fi should never share a network with your point-of-sale system), placing access points based on the actual building layout rather than convenience, and having something in place to flag problems before a staff member does.</p>
<p>This is what we design, install, and manage -- not just running a cable and leaving, but a setup built for how the business actually operates day to day. <a href="/contact">Get in touch</a> if your current setup feels like it's held together with guesswork.</p>
`.trim()
  },
  {
    slug: 'what-our-ict-training-actually-covers',
    category_slug: 'ict-training',
    title: 'What Our ICT Training Actually Covers',
    excerpt: 'Practical skills, not just theory -- here is what the training is actually built around and who it is for.',
    cover_image: 'admin/ict-training-cover.jpg',
    body_html: `
<p>"ICT training" can mean almost anything, so here's specifically what ours covers and who it's for.</p>
<h2>What's covered</h2>
<ul>
<li><strong>Software and web development fundamentals</strong> -- for people who want to actually build things, not just use a computer.</li>
<li><strong>Networking basics</strong> -- how networks are actually built and maintained, useful for anyone heading toward IT support or systems work.</li>
<li><strong>Cybersecurity awareness</strong> -- the practical habits covered in our cybersecurity posts, taught directly rather than left for people to pick up by accident.</li>
<li><strong>General digital skills</strong> -- for people who need to be genuinely comfortable and capable with computers and common business software, not just familiar with them.</li>
</ul>
<h2>Who it's for</h2>
<p>Students building a foundation before further study or work, people changing careers into tech, and staff at businesses who need to be brought up to speed on tools they're already expected to use. We keep it practical -- the goal is that you can actually do the thing afterward, not just describe it.</p>
<p>If you're not sure which area fits what you're trying to do, <a href="/contact">reach out</a> and we'll help you figure out where to start.</p>
`.trim()
  }
];

const getCategoryId = db.prepare('SELECT id FROM categories WHERE slug = ?');
const findPost = db.prepare('SELECT id FROM posts WHERE slug = ?');
const insertPost = db.prepare(`
  INSERT INTO posts (title, slug, excerpt, body_html, cover_image, category_id, status, published_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'published', datetime('now'), datetime('now'))
`);

for (const p of posts) {
  if (findPost.get(p.slug)) {
    console.log(`- post "${p.slug}" already exists, skipping.`);
    continue;
  }
  const category = getCategoryId.get(p.category_slug);
  if (!category) {
    console.log(`! category "${p.category_slug}" not found, skipping post "${p.slug}".`);
    continue;
  }
  insertPost.run(p.title, p.slug, p.excerpt, p.body_html, p.cover_image, category.id);
  console.log(`✔ Inserted post "${p.title}"`);
}

console.log('\nMigration complete.');

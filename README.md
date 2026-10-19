# SharifTech Website

> **Deployment note for this copy of the project:** this directory lives inside
> the SHARIF-AI (SAIBA) repo, sharing that project's VPS and Caddy front door
> instead of the standalone PM2/Nginx setup described below. It runs as the
> `website` service in the root `docker-compose.yml`, fronted by the root
> `Caddyfile`'s `shariftechnologies.online` block, and deploys through
> `.github/workflows/deploy-vps.yml` like every other service there (see the
> root `AGENTS.md`). Sections 4 and 5 below (PM2, Nginx) don't apply here —
> everything in them is handled by that shared Docker/Caddy setup instead. The
> `DATA_DIR` environment variable (set in `docker-compose.yml`) controls where
> the sqlite file and session files live, separately from this app's own code
> — see the comment in `server/index.js` for why.

A blog + newsletter + support-inbox website for SHARIF TECHNOLOGIES, with a full
admin dashboard — no code edits needed for day-to-day content management.

**Stack:** Node.js + Express + EJS (server-rendered) + SQLite (single file, no
database server to install) + Nodemailer (SMTP mail). Everything runs on your own
VPS — nothing here depends on any hosted service from Anthropic or anyone else.

## What's included

- **Homepage**: a tabbed disclosure interface (Home / Blog / Notices / Services /
  Connect / Contact) — clicking a tab reveals that section in place instead of a
  long scroll or a new page load. Standalone pages (`/blog`, `/notices`, `/connect`,
  `/contact`) still exist for direct links and sharing.
- **Blog**: posts with categories, cover images, drafts vs. published, view counts.
- **Notices**: pinned/priority announcements. A pinned notice always shows as a
  banner above the homepage tabs, regardless of which tab is open — not just
  buried in the Notices tab.
- **Newsletter**: visitors subscribe with double opt-in (confirmation email);
  admin composes and sends newsletters to all confirmed subscribers from the dashboard;
  every email includes a working unsubscribe link.
- **Contact / Support inbox**: visitors send a message with an optional image
  attachment; you get notified by email and can manage everything (mark read/replied/archived,
  reply by email) from the dashboard.
- **Socials**: manage your WhatsApp/Facebook/YouTube/etc. links from the dashboard.
- **Google AdSense**: toggle on/off and configure ad slots from Settings — no code edits.
- **Admin dashboard**: create/edit/delete posts, notices, socials, subscribers,
  newsletters; moderate messages — all without touching code.

## 1. Requirements on your VPS

- Node.js 22.5 or newer (`node -v` to check) — this project uses Node's built-in
  SQLite support, which needs 22.5+. (Node 24 works great, as does any LTS from
  22.5 onward.)
- npm (comes with Node)
- Nginx (recommended, as a reverse proxy + for HTTPS)
- A domain pointed at your VPS (optional but recommended)

This project deliberately avoids any package that needs native compilation
(no `better-sqlite3`, no `sqlite3`, no `node-gyp` build step) — `npm install`
is pure JavaScript end to end, so it works the same on a VPS, on Termux/Android,
on a Raspberry Pi, anywhere Node runs.

### Running on Termux (Android)

This works, but a couple of things matter:

- **Don't run it from `/storage/emulated/0/...` (Android shared storage).**
  That path doesn't support proper Unix symlinks, which breaks `npm install`
  with `EACCES ... symlink` errors. Keep the project inside Termux's own home
  directory instead: `~/website` (i.e. `/data/data/com.termux/files/home/website`).
- Termux is fine for testing, but isn't a reliable place to host the site for
  real visitors — Android will suspend background processes to save battery,
  there's no static IP, etc. Use it to try things out, then deploy to an actual
  VPS for anything public-facing.

## 2. First-time setup

```bash
# Upload/clone this project to your VPS, then:
cd shariftech-website
npm install

# Copy the environment template and fill in real values
cp .env.example .env
nano .env      # or vim / your editor of choice
```

Fill in `.env` with at minimum:
- `SESSION_SECRET` — generate with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your first admin login (change the password after first login)
- `SITE_URL` — your real domain, e.g. `https://shariftech.com`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — see "Email setup" below
- `CONTACT_NOTIFY_EMAIL` — where support/feedback messages get emailed to

Then initialize the database:

```bash
npm run setup
```

This creates `server/db/shariftech.sqlite3`, all tables, your admin account, and
some sensible defaults (categories, socials) that you can edit or delete from the
dashboard afterward.

Start the site:

```bash
npm start
```

Visit `http://your-server-ip:3000` (or `http://localhost:3000` if testing locally).
Log in at `/admin/login` with the `ADMIN_EMAIL`/`ADMIN_PASSWORD` you set.

## 3. Email setup (required for newsletter + contact form to actually send mail)

Without SMTP configured, the site still works, but instead of sending real emails
it logs what would have been sent to the server console — useful for testing, not
for production.

### Option A — Gmail (simplest for getting started)

1. Enable 2-Step Verification on the Gmail account you'll send from.
2. Create an "App Password" at https://myaccount.google.com/apppasswords
3. In `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=youraddress@gmail.com
   SMTP_PASS=the 16-character app password (no spaces)
   MAIL_FROM=SharifTech <youraddress@gmail.com>
   ```

Gmail's free tier has sending limits (roughly 500/day) — fine for a small newsletter,
but if your subscriber list grows large, consider Option B.

### Option B — A transactional email provider (better for larger lists)

Any SMTP provider works the same way — just fill in that provider's host/port/user/password
in `.env`. Popular choices: Zoho Mail, Brevo (Sendinblue), Amazon SES, Mailgun, Resend.
These typically have better deliverability and higher sending limits than Gmail.

## 4. Running permanently with PM2 (recommended)

PM2 keeps the site running, restarts it if it crashes, and starts it on server reboot.

```bash
npm install -g pm2
pm2 start server/index.js --name shariftech
pm2 save
pm2 startup     # follow the printed instructions to enable on-boot startup
```

Useful commands:
```bash
pm2 logs shariftech       # view live logs
pm2 restart shariftech    # restart after code changes
pm2 stop shariftech
```

## 5. Nginx reverse proxy + HTTPS

Create `/etc/nginx/sites-available/shariftech`:

```nginx
server {
    listen 80;
    server_name shariftech.com www.shariftech.com;

    client_max_body_size 20M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/shariftech /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Free HTTPS certificate via Let's Encrypt:
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d shariftech.com -d www.shariftech.com
```

## 6. Google AdSense

1. Get approved for AdSense and grab your Publisher/Client ID (`ca-pub-XXXXXXXXXXXXXXXX`)
   and ad unit slot IDs from your AdSense dashboard.
2. In your site's Admin → Settings → Google AdSense section:
   - Check "Enable ads site-wide"
   - Paste your Client ID and slot IDs
   - Save

Ads stay completely off (no scripts loaded, no ad boxes shown) until both the
toggle is on AND a Client ID is filled in — so there's no broken/empty ad space
shown to visitors while you're waiting on approval.

## 7. Day-to-day admin usage — no code required

Everything below is done from `/admin` after logging in:

- **Posts**: Admin → Blog Posts → New Post. Set a cover image, category, and status
  (draft/published). Drafts are never shown to visitors.
- **Notices**: Admin → Notices → New Notice. Set priority and optionally pin it
  to the top or give it an expiry date.
- **Newsletters**: Admin → Newsletters → New Newsletter. Write it, save as draft,
  preview, then hit "Send Now" to email every confirmed subscriber.
- **Subscribers**: Admin → Subscribers. See confirmed/pending/unsubscribed lists,
  manually add someone, or export everyone as CSV.
- **Support Inbox**: Admin → Support Inbox. Read messages, view any attached image,
  reply by email (opens your mail client), and track status.
- **Socials**: Admin → Socials. Add/edit/hide/delete links shown in the header,
  footer, and Connect page.
- **Settings**: site name, tagline, about text, contact info, AdSense, and under
  Style — upload/remove your logo, pick primary/accent/ink colors with live color
  pickers, and choose a heading font (Fraunces/Poppins/Inter). Changes apply across
  the whole public site immediately after saving.

## 8. Backing up your data

Everything lives in two places:
- `server/db/shariftech.sqlite3` — all posts, notices, subscribers, messages, settings
- `server/uploads/` — cover images and message attachments

(`server/db/sessions/` holds temporary login session files — safe to ignore for
backups; logged-in admins would just need to log in again if it's lost.)

Back both up regularly, e.g.:
```bash
tar -czf shariftech-backup-$(date +%F).tar.gz server/db/shariftech.sqlite3 server/uploads/
```

## 9. Updating the site later

If you (or a developer) make code changes:
```bash
git pull                 # or re-upload changed files
npm install               # in case dependencies changed
pm2 restart shariftech
```
Your database and uploads are untouched by code updates — they live outside the
code directories that get replaced.

## Project structure

```
server/
  index.js            → app entry point
  db/                 → SQLite connection, schema, first-run setup script
  middleware/          → auth guard, file upload rules
  lib/mailer.js        → SMTP mail sending
  routes/
    public.js          → public pages (home, blog, notices, connect, contact)
    publicApi.js        → subscribe/confirm/unsubscribe, contact form submission
    adminAuth.js        → admin login/logout/change password
    admin.js            → full admin dashboard (posts, notices, subscribers, etc.)
views/                  → EJS templates (public/ and admin/)
public/                 → CSS and static images
```

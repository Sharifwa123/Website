-- SHARIF TECHNOLOGIES website schema.
-- Run automatically by server/db/init.js — you never need to write SQL by hand.

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL DEFAULT 'Admin',
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Site-wide settings the admin can edit from the dashboard (no code edits required).
-- Stored as simple key/value pairs so new settings can be added later without a migration.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,
  slug              TEXT NOT NULL UNIQUE,
  description       TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  show_on_services  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  excerpt       TEXT,
  body_html     TEXT NOT NULL,
  cover_image   TEXT,               -- filename under /uploads/admin
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | published
  views         INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  body_html    TEXT NOT NULL,
  priority     TEXT NOT NULL DEFAULT 'normal', -- normal | important | urgent
  is_pinned    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'published', -- draft | published
  expires_at   TEXT,                 -- optional auto-hide date
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Social/contact links shown in the header, footer, and a dedicated "Connect" section.
CREATE TABLE IF NOT EXISTS socials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  platform   TEXT NOT NULL,   -- e.g. "WhatsApp", "Facebook", "GitHub", "YouTube"
  url        TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT 'link', -- key into the icon set used by the templates
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- Newsletter subscribers. Confirmed via a double opt-in link emailed on signup,
-- and every mailing includes an unsubscribe link built from unsubscribe_token.
CREATE TABLE IF NOT EXISTS subscribers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | unsubscribed
  confirm_token      TEXT,
  unsubscribe_token  TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at       TEXT
);

-- Support / feedback messages submitted from the Contact page, optionally with one image attached.
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  attachment_path TEXT,          -- filename under /uploads/messages, or NULL
  status          TEXT NOT NULL DEFAULT 'new', -- new | read | replied | archived
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Newsletters the admin has composed and sent (or saved as draft) to confirmed subscribers.
CREATE TABLE IF NOT EXISTS newsletters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | sent
  recipients    INTEGER NOT NULL DEFAULT 0,
  sent_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_notices_status ON notices(status, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, created_at DESC);

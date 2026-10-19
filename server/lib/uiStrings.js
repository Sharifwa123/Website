// UI Strings helper -- the lookup function behind every editable piece of text on
// public-facing pages (Phase 1). Every call site provides its own hardcoded default,
// so even if the database has no row for a key, or the row's `value` is null/empty,
// the page always renders correct English text -- never blank, never broken.
//
// Usage in routes (see server/routes/public.js):
//   res.locals.t = makeTranslator();
//
// Usage in views:
//   <%= t('header.nav.home', 'Home') %>
//
// The second argument (the hardcoded default) is REQUIRED at every call site by
// convention -- this file does not enforce that syntactically (EJS can't check
// call-site arity), but every conversion done as part of this feature passes one.
// This is the actual safety net: even a fully empty ui_strings table still renders
// the entire site correctly, since every call carries its own fallback.

const db = require('../db/connection');
const sanitizeHtml = require('sanitize-html');

let cache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5000; // short TTL -- keeps admin edits appearing quickly without
                            // hitting the database on literally every single string
                            // lookup on every request (a page can have 30+ calls to t()).

function loadStrings() {
  const now = Date.now();
  if (cache && (now - cacheLoadedAt) < CACHE_TTL_MS) return cache;
  const rows = db.prepare('SELECT string_key, value FROM ui_strings').all();
  cache = {};
  rows.forEach((r) => {
    if (r.value != null && r.value !== '') {
      cache[r.string_key] = r.value;
    }
  });
  cacheLoadedAt = now;
  return cache;
}

/**
 * Returns a `t(key, fallback)` function bound for the current request.
 * `fallback` is REQUIRED -- always pass the original hardcoded text as the second
 * argument at every call site, so the page is correct even with an empty table.
 */
function makeTranslator() {
  const strings = loadStrings();
  const t = function t(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(strings, key)) {
      return strings[key];
    }
    return fallback;
  };

  // For the small number of strings that legitimately need inline HTML (e.g. the
  // hero heading's <span class="accent"> / <br>), this sanitizes whatever the admin
  // typed before it's ever rendered unescaped -- same allowlist as blog posts/notices
  // (safe formatting tags only, no <script>, no event handlers). Without this, an
  // admin-editable field rendered via <%- %> would be an unsanitized injection point,
  // which is exactly the class of risk this project has avoided everywhere else.
  const sanitizeOpts = {
    allowedTags: ['span', 'br', 'strong', 'em', 'b', 'i'],
    allowedAttributes: { span: ['class'] }
  };
  t.html = function tHtml(key, fallback) {
    const raw = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : fallback;
    return sanitizeHtml(raw, sanitizeOpts);
  };

  return t;
}

/** Forces the next call to re-read from the database -- used right after an admin
 * saves an edit, so they see their change immediately rather than waiting out the
 * cache TTL. */
function invalidateCache() {
  cache = null;
}

module.exports = { makeTranslator, invalidateCache };

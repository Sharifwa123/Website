// Opens (and creates, if missing) the single SQLite database file.
//
// Uses Node's BUILT-IN sqlite module (node:sqlite, stable since Node 22.5) instead of
// the better-sqlite3 npm package. This means zero native compilation step during
// `npm install` — important because native modules routinely fail to build on
// constrained/non-standard environments like Termux on Android (no working
// Android NDK path for node-gyp). If you're running this on a normal Linux VPS,
// node:sqlite still works identically and needs nothing extra installed.
//
// The whole database lives in one file: server/db/shariftech.sqlite3

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// See the DATA_DIR comment in server/index.js -- defaults to this file's own
// directory (unchanged behavior for a bare, non-Docker install) but can be
// pointed elsewhere so a persistent volume never has to cover this directory's
// code files (init.js, schema.sql, migrations/) too.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'shariftech.sqlite3');
const raw = new DatabaseSync(DB_PATH);

// Sensible reliability defaults for a single-file production DB.
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

// node:sqlite's StatementSync.prepare() only supports positional (?) parameters and
// .run()/.get()/.all(), which is exactly what this codebase already uses everywhere —
// so `db.prepare(sql).run(...)` / `.get(...)` / `.all(...)` all work unchanged.
// The one thing node:sqlite doesn't provide is better-sqlite3's `db.transaction(fn)`
// helper, so we add a small equivalent below — same call shape, same behavior
// (wraps the function in BEGIN/COMMIT, rolls back on error).
raw.prepare = raw.prepare.bind(raw);
raw.exec = raw.exec.bind(raw);

raw.transaction = function transaction(fn) {
  return function runInTransaction(...args) {
    raw.exec('BEGIN');
    try {
      const result = fn(...args);
      raw.exec('COMMIT');
      return result;
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  };
};

module.exports = raw;

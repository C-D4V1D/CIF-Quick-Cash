-- CIF Cash — Cloudflare D1 Schema
-- Run via: wrangler d1 execute <DB_NAME> --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id          TEXT    PRIMARY KEY,
  username    TEXT    NOT NULL UNIQUE,
  password    TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'user',
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Default admin user
INSERT OR IGNORE INTO users (id, username, password, role, name)
  VALUES ('admin', 'cifadmin', 'CIF@dm!n#2025xQ8p', 'admin', 'Administrator');

CREATE TABLE IF NOT EXISTS transactions (
  ref         TEXT    PRIMARY KEY,
  data        TEXT    NOT NULL,  -- JSON blob
  status      TEXT    NOT NULL DEFAULT 'active',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_status     ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);

CREATE TABLE IF NOT EXISTS drafts (
  ref         TEXT    PRIMARY KEY,
  data        TEXT    NOT NULL,  -- JSON blob
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,  -- JSON blob
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  description TEXT,
  amount      REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date DESC);

CREATE TABLE IF NOT EXISTS capital (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT    NOT NULL,
  amount  REAL    NOT NULL,
  date    TEXT    NOT NULL,
  method  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS declined_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  date    TEXT    NOT NULL,
  item    TEXT    NOT NULL,
  reason  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_declined_log_date ON declined_log (date DESC);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id     TEXT    NOT NULL,
  username    TEXT    NOT NULL,
  user_role   TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  entity_type TEXT    NOT NULL,
  entity_id   TEXT,
  description TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);

-- NIN/BVN verification cache — stores successful API results so we don't pay for duplicates
CREATE TABLE IF NOT EXISTS nin_bvn_cache (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  id_type     TEXT    NOT NULL,  -- 'nin' or 'bvn'
  id_number   TEXT    NOT NULL,
  data        TEXT    NOT NULL,  -- full JSON response from the API (includes photo as base64)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nin_bvn_cache_type_number ON nin_bvn_cache (id_type, id_number);

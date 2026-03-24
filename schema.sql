-- CIF Cash — Cloudflare D1 Schema
-- Run via: wrangler d1 execute <DB_NAME> --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id          TEXT    PRIMARY KEY,
  username    TEXT    NOT NULL UNIQUE,
  password    TEXT    NOT NULL, -- PBKDF2-SHA256 hash string
  role        TEXT    NOT NULL DEFAULT 'user',
  roles       TEXT    NOT NULL DEFAULT '[]',  -- JSON array of additional roles, e.g. '["stakeholder"]'
  name        TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Migration for existing databases:
-- ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE users ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';

-- Default admin user
INSERT OR IGNORE INTO users (id, username, password, role, name)
  VALUES ('admin', 'cifadmin', 'pbkdf2_sha256$100000$u7LD0M2xIoi2gVt1cujVBw==$MhniNOx1JQYo18UYqwk+6AS6SPW5j8zTyqXQG9Lv900=', 'admin', 'Administrator'); -- default password: CifAdmin@1 (change immediately)

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
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT    NOT NULL,
  category      TEXT    NOT NULL,
  description   TEXT,
  amount        REAL    NOT NULL,
  registered_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date DESC);

-- Migration for existing databases (run once against live D1):
-- ALTER TABLE expenses ADD COLUMN registered_by TEXT;

CREATE TABLE IF NOT EXISTS capital (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT    NOT NULL,
  amount  REAL    NOT NULL,
  date    TEXT    NOT NULL,
  method  TEXT    NOT NULL,
  receipt TEXT,
  user_id TEXT    REFERENCES users(id)
);

-- Migrations for existing databases (run once against live D1):
-- ALTER TABLE capital ADD COLUMN receipt TEXT;
-- ALTER TABLE capital ADD COLUMN user_id TEXT REFERENCES users(id);

CREATE TABLE IF NOT EXISTS declined_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT    NOT NULL,
  ref           TEXT,
  customer_name TEXT,
  nin_bvn       TEXT,
  item          TEXT    NOT NULL,
  reason        TEXT    NOT NULL,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_declined_log_date ON declined_log (date DESC);

CREATE TABLE IF NOT EXISTS profit_distributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT    NOT NULL,
  amount      REAL    NOT NULL,
  method      TEXT    NOT NULL,
  note        TEXT,
  receipt     TEXT,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_profit_distributions_date ON profit_distributions (date DESC);

-- Migration for existing databases (run once against live D1):
-- CREATE TABLE IF NOT EXISTS profit_distributions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL, note TEXT, receipt TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- CREATE INDEX IF NOT EXISTS idx_profit_distributions_date ON profit_distributions (date DESC);

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

-- SMS logs — one row per outgoing SMS (automated or manual)
CREATE TABLE IF NOT EXISTS sms_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_ref TEXT    NOT NULL,
  sent_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  trigger_type    TEXT    NOT NULL,  -- e.g. 'due_2d', 'due_today', 'ownership_3d', 'ownership_today', 'manual'
  message         TEXT    NOT NULL,
  recipient       TEXT    NOT NULL,  -- phone number (international format)
  status          TEXT    NOT NULL DEFAULT 'pending',  -- 'sent', 'failed'
  termii_response TEXT               -- raw JSON from Termii
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_transaction_ref ON sms_logs (transaction_ref);
CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at         ON sms_logs (sent_at DESC);

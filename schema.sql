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
  phone1      TEXT    DEFAULT NULL,
  phone2      TEXT    DEFAULT NULL,
  email       TEXT    DEFAULT NULL,
  signature   TEXT    DEFAULT NULL, -- /api/photos/:key URL for refined signature PNG
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Migration for existing databases:
-- ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE users ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';
-- ALTER TABLE users ADD COLUMN phone1 TEXT DEFAULT NULL;
-- ALTER TABLE users ADD COLUMN phone2 TEXT DEFAULT NULL;
-- ALTER TABLE users ADD COLUMN email  TEXT DEFAULT NULL;
-- ALTER TABLE users ADD COLUMN signature TEXT DEFAULT NULL;
-- (Or run: migrate-user-contact.sql)

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
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT               -- user ID of the staff member who started the wizard
);

-- Migration for existing databases (run once against live D1):
-- ALTER TABLE drafts ADD COLUMN created_by TEXT;

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
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT    NOT NULL,
  amount           REAL    NOT NULL,
  method           TEXT    NOT NULL,
  note             TEXT,
  receipt          TEXT,
  created_by       TEXT,
  decision_ids     TEXT,              -- JSON array of distribution_decisions IDs paid
  stakeholder_name TEXT,              -- which stakeholder was paid
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
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
  termii_response TEXT,              -- raw JSON from Termii send response
  message_id      TEXT,              -- Termii message_id, used to correlate DLR callbacks
  delivery_status TEXT               -- delivery receipt from Termii webhook, e.g. 'DeliveredToTerminal', 'Expired', 'DND'
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_transaction_ref ON sms_logs (transaction_ref);
CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at         ON sms_logs (sent_at DESC);

-- Login attempt tracking for brute-force protection
CREATE TABLE IF NOT EXISTS login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL,
  attempted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  success      INTEGER NOT NULL DEFAULT 0  -- 0 = failed, 1 = succeeded
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts (username, attempted_at DESC);

-- Migration for existing databases (run once against live D1):
-- CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, attempted_at TEXT NOT NULL DEFAULT (datetime('now')), success INTEGER NOT NULL DEFAULT 0);
-- CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts (username, attempted_at DESC);

-- Distribution decisions — tracks each stakeholder's distribute-or-reinvest choice per profit period
CREATE TABLE IF NOT EXISTS distribution_decisions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  period              TEXT    NOT NULL,              -- e.g. '2026-03'
  user_id             TEXT    NOT NULL REFERENCES users(id),
  stakeholder_name    TEXT    NOT NULL,
  profit_amount       REAL    NOT NULL,              -- calculated profit share
  capital_days        REAL    NOT NULL,              -- their capital-days (audit trail)
  total_capital_days  REAL    NOT NULL,              -- total capital-days across all stakeholders
  reinvest_amount     REAL    NOT NULL DEFAULT 0,    -- max reinvest (from expected contribution)
  distribute_amount   REAL    NOT NULL DEFAULT 0,    -- balance (profit_amount - reinvest_amount)
  decision            TEXT    NOT NULL DEFAULT 'pending', -- 'pending', 'reinvest_and_distribute', 'distribute_all'
  decided_at          TEXT,                          -- when decision was made (or auto-decided)
  auto_decided        INTEGER NOT NULL DEFAULT 0,    -- 1 if auto-resolved after deadline
  capital_surplus     INTEGER NOT NULL DEFAULT 0,    -- 1 if surplus detected at generation time
  system_note         TEXT,                          -- plain English explanation of automated decisions
  deadline            TEXT    NOT NULL,              -- 3 days after notification sent
  paid_at             TEXT,                          -- when the distribute portion was paid out
  paid_by             TEXT,                          -- who recorded the payout
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_distribution_decisions_period ON distribution_decisions (period);
CREATE INDEX IF NOT EXISTS idx_distribution_decisions_user   ON distribution_decisions (user_id);

-- Migration for existing databases (run once against live D1):
-- CREATE TABLE IF NOT EXISTS distribution_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), stakeholder_name TEXT NOT NULL, profit_amount REAL NOT NULL, capital_days REAL NOT NULL, total_capital_days REAL NOT NULL, reinvest_amount REAL NOT NULL DEFAULT 0, distribute_amount REAL NOT NULL DEFAULT 0, decision TEXT NOT NULL DEFAULT 'pending', decided_at TEXT, auto_decided INTEGER NOT NULL DEFAULT 0, capital_surplus INTEGER NOT NULL DEFAULT 0, system_note TEXT, deadline TEXT NOT NULL, paid_at TEXT, paid_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- CREATE INDEX IF NOT EXISTS idx_distribution_decisions_period ON distribution_decisions (period);
-- CREATE INDEX IF NOT EXISTS idx_distribution_decisions_user ON distribution_decisions (user_id);
-- If distribution_decisions already exists (from earlier migration), add new columns:
-- ALTER TABLE distribution_decisions ADD COLUMN reinvest_amount REAL NOT NULL DEFAULT 0;
-- ALTER TABLE distribution_decisions ADD COLUMN distribute_amount REAL NOT NULL DEFAULT 0;
-- ALTER TABLE distribution_decisions ADD COLUMN capital_surplus INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE distribution_decisions ADD COLUMN system_note TEXT;
-- ALTER TABLE distribution_decisions ADD COLUMN paid_at TEXT;
-- ALTER TABLE distribution_decisions ADD COLUMN paid_by TEXT;
-- ALTER TABLE profit_distributions ADD COLUMN decision_ids TEXT;
-- ALTER TABLE profit_distributions ADD COLUMN stakeholder_name TEXT;

-- ============================================================
-- Public item valuation rate-limiting table
-- Tracks how many free valuations each IP has used per day.
-- ============================================================
CREATE TABLE IF NOT EXISTS public_valuation_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pvr_ip ON public_valuation_requests (ip, created_at DESC);

-- Migration for existing databases (run once against live D1):
-- CREATE TABLE IF NOT EXISTS public_valuation_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- CREATE INDEX IF NOT EXISTS idx_pvr_ip ON public_valuation_requests (ip, created_at DESC);

-- ============================================================
-- Staff points — fractional credit per step/task action.
-- Each row credits one user for performing one step of work,
-- weighted so that handoffs (one staff starts, another finishes)
-- share credit fairly. Aggregated for performance reporting and
-- for splitting the Staff Pool of the monthly profit.
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_points (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT    NOT NULL,
  entity_ref      TEXT    NOT NULL,        -- e.g. 'tx:REF', 'expense:42', 'sms:1234'
  step_key        TEXT    NOT NULL,        -- e.g. 'customer_intake', 'cash_disbursement', 'expense_entry'
  weight          REAL    NOT NULL,
  awarded_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, entity_ref, step_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_points_user_time ON staff_points (user_id, awarded_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_points_entity ON staff_points (entity_ref);
CREATE INDEX IF NOT EXISTS idx_staff_points_awarded_at ON staff_points (awarded_at DESC);

-- Migration for existing databases (run once against live D1):
-- CREATE TABLE IF NOT EXISTS staff_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity_ref TEXT NOT NULL, step_key TEXT NOT NULL, weight REAL NOT NULL, awarded_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, entity_ref, step_key));
-- CREATE INDEX IF NOT EXISTS idx_staff_points_user_time ON staff_points (user_id, awarded_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_staff_points_entity ON staff_points (entity_ref);
-- CREATE INDEX IF NOT EXISTS idx_staff_points_awarded_at ON staff_points (awarded_at DESC);

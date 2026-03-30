-- Push subscription storage for Web Push notifications (RFC 8030 / VAPID)
-- Each row represents one browser/device subscription for a user.
-- The endpoint is unique per subscription; ON CONFLICT updates the row when the
-- browser renews a subscription rather than inserting a duplicate.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,  -- subscriber public key (base64url)
  auth       TEXT NOT NULL,  -- subscriber auth secret (base64url)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON push_subscriptions(user_id);

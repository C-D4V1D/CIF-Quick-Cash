-- Migration: Add sms_logs table for Termii automated SMS tracking
-- Run once against live D1: wrangler d1 execute cifcash-db --file=migrate-sms.sql

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

-- Migration: Add message_id and delivery_status columns to sms_logs for Termii DLR webhook support
-- Run once against live D1: wrangler d1 execute cifcash-db --file=migrate-sms-dlr.sql

ALTER TABLE sms_logs ADD COLUMN message_id      TEXT;  -- Termii message_id from send response
ALTER TABLE sms_logs ADD COLUMN delivery_status TEXT;  -- delivery receipt from Termii webhook

CREATE INDEX IF NOT EXISTS idx_sms_logs_message_id ON sms_logs (message_id);

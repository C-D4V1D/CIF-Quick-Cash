-- Migration: add registered_by column to expenses table
-- Run once against the live D1 database:
--   wrangler d1 execute <DB_NAME> --file=migrate-expenses-registered-by.sql --remote

ALTER TABLE expenses ADD COLUMN registered_by TEXT;

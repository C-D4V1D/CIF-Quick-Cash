-- Migration: add ref, customer_name, nin_bvn, notes columns to declined_log
-- Run once against the live D1 database:
--   wrangler d1 execute <DB_NAME> --file=migrate-declined-log.sql --remote

ALTER TABLE declined_log ADD COLUMN ref           TEXT;
ALTER TABLE declined_log ADD COLUMN customer_name TEXT;
ALTER TABLE declined_log ADD COLUMN nin_bvn       TEXT;
ALTER TABLE declined_log ADD COLUMN notes         TEXT;

-- clear-main-records.sql
-- Clears all transactional records from the production (main) database.
-- KEEPS: users, settings
-- CLEARS: everything else
--
-- Run against production:
--   npx wrangler d1 execute cifcash-db --remote --file=clear-main-records.sql

DELETE FROM push_subscriptions;
DELETE FROM public_valuation_requests;
DELETE FROM login_attempts;
DELETE FROM sms_logs;
DELETE FROM nin_bvn_cache;
DELETE FROM activity_logs;
DELETE FROM distribution_decisions;
DELETE FROM profit_distributions;
DELETE FROM declined_log;
DELETE FROM capital;
DELETE FROM expenses;
DELETE FROM drafts;
DELETE FROM transactions;

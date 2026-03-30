-- Migration: add created_by column to drafts table
-- Run once against your live D1 database:
--
--   wrangler d1 execute <DB_NAME> --remote --file=migrate-drafts-created_by.sql
--
-- This column records which staff member started each draft so that staff users
-- only see their own drafts while admins continue to see all.
-- The column is nullable; existing rows will have NULL (treated as visible to all roles).

ALTER TABLE drafts ADD COLUMN created_by TEXT;

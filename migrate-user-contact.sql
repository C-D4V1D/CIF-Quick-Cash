-- Migration: add contact fields (phone1, phone2, email) to users table
-- Run via: wrangler d1 execute <DB_NAME> --file=migrate-user-contact.sql

ALTER TABLE users ADD COLUMN phone1 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN phone2 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN email  TEXT DEFAULT NULL;

-- Run this once to update the default admin credentials on your live D1 database.
-- Command: wrangler d1 execute <DB_NAME> --file=migrate-admin-credentials.sql --remote
--
-- IMPORTANT: The old hash used 210,000 PBKDF2 iterations which exceeds the Cloudflare
-- Workers Web Crypto limit of 100,000. This migration resets the admin password to the
-- temporary value below. Change it immediately after running this migration.
--
-- Temporary password: CifAdmin@1  (hash uses 100,000 iterations, SHA-256)

UPDATE users
SET username = 'cifadmin',
    password = 'pbkdf2_sha256$100000$u7LD0M2xIoi2gVt1cujVBw==$MhniNOx1JQYo18UYqwk+6AS6SPW5j8zTyqXQG9Lv900='
WHERE id = 'admin';

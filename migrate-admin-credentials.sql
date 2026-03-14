-- Run this once to update the default admin credentials on your live D1 database.
-- Command: wrangler d1 execute <DB_NAME> --file=migrate-admin-credentials.sql --remote

UPDATE users
SET username = 'cifadmin',
    password = 'CIF@dm!n#2025xQ8p'
WHERE id = 'admin';

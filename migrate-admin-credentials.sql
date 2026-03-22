-- Run this once to update the default admin credentials on your live D1 database.
-- Command: wrangler d1 execute <DB_NAME> --file=migrate-admin-credentials.sql --remote

UPDATE users
SET username = 'cifadmin',
    password = 'pbkdf2_sha256$210000$owReP1/ifmilje/3sEldAA==$I+5MqLOqWJRQ6DwHV1Ck3D2E42E6t9/XFhkfvEZE0ZA='
WHERE id = 'admin';

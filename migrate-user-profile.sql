-- Add user profile contact fields
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN phone1 TEXT;
ALTER TABLE users ADD COLUMN phone2 TEXT;

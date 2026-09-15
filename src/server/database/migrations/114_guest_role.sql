-- 114: Guest collaborator role columns on users table
ALTER TABLE users ADD COLUMN is_guest TINYINT(1) DEFAULT 0;
ALTER TABLE users ADD COLUMN guest_invited_by VARCHAR(36) NULL;
ALTER TABLE users ADD COLUMN guest_expires_at TIMESTAMP NULL;

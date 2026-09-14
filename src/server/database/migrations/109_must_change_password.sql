-- Enhancement C: Flag to force password change on first login (auto-created users)
ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;

-- Migration 136 (2026-10-12): sign in with Google.
-- A Google account (its never-changing "sub" id) belongs to one Kovarti user. People are found by
-- this id, never by email: a Google address can change hands, and linking an existing account by
-- matching email would let anyone with a Google account under that address take it over — linking
-- needs the account's password (or an emailed link) first.
-- People who sign up with Google have no password: users.password_hash stays '' (no password
-- matches an empty hash; utils/googleOnlyAccount.ts explains them).
CREATE TABLE IF NOT EXISTS user_identities (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  email_at_link VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uk_identity_provider_subject (provider, subject),
  INDEX idx_identity_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

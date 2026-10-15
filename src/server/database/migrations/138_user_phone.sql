-- A phone number for each person (user 2026-10-14, U5): asked — and required — on the setup
-- screen after sign-up, changeable in Settings › Profile. Used by Kovarti for sales and support
-- follow-up only (no text messages). Existing accounts have none until they add it.

ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL DEFAULT NULL;

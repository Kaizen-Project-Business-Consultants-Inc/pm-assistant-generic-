-- Track which waitlist subscribers have received the launch announcement email
ALTER TABLE waitlist
  ADD COLUMN launch_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN launch_email_sent_at DATETIME NULL;

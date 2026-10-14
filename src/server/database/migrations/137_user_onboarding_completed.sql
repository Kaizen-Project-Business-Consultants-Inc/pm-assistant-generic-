-- Setup screens are decided by an explicit "setup finished" moment, not by whether the person has
-- a name (2026-10-14). The free-trial and Google sign-ups already give a name, so they went straight
-- to the dashboard and never saw setup (no "Explore a sample project", no first-project step).
-- Everyone who already has a name has been through sign-up: mark them finished so nobody existing
-- is sent back to setup. People with no name yet keep going to setup, as before.

ALTER TABLE users ADD COLUMN onboarding_completed_at DATETIME NULL DEFAULT NULL;

UPDATE users
   SET onboarding_completed_at = COALESCE(updated_at, created_at, NOW())
 WHERE onboarding_completed_at IS NULL
   AND full_name IS NOT NULL AND full_name <> '';

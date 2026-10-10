-- Migration 131 (2026-10-09, audit H1): a Claude connection remembers which company the person
-- was in when they connected. Renewal (mcp-server oauth/provider.ts exchangeRefreshToken) refuses
-- if the person has since moved company, been deactivated, or must change their password.
-- Existing connections take the person's current company (NULL = no company).
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36) NULL DEFAULT NULL;

UPDATE oauth_tokens t
  JOIN users u ON u.id = t.user_id
   SET t.organization_id = u.organization_id
 WHERE t.organization_id IS NULL;

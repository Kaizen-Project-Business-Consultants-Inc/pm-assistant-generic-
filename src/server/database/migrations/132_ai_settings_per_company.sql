-- Migration 132 (2026-10-09): project AI settings are kept per company.
-- ai_context_configs is one shared table for every company, keyed by scope + scope id. Project ids
-- are only unique inside a company — every company's sample project is `demo-sample-webapp` — so a
-- PM in any company could set AI instructions that Mjuzi then used for EVERY company's sample
-- project, and read other companies' entries. Project rows now also carry the company id (org_id).
-- Org and user rows keep org_id = '' (their ids are already unique everywhere).
ALTER TABLE ai_context_configs ADD COLUMN IF NOT EXISTS org_id VARCHAR(36) NOT NULL DEFAULT '' AFTER scope_id;

-- Settings written on the shared sample id can't be traced to one company and may have been
-- written by another company: remove them (their history goes with them, ON DELETE CASCADE).
DELETE FROM ai_context_configs WHERE scope = 'project' AND scope_id = 'demo-sample-webapp';

-- Other project rows take the company of the person who wrote them (project ids are unique
-- outside the sample), so they keep applying. A row whose writer has no company keeps '':
-- a single-company install still uses it; a multi-company server no longer does.
UPDATE ai_context_configs c JOIN users u ON u.id = c.created_by
   SET c.org_id = u.organization_id
 WHERE c.scope = 'project' AND c.org_id = '' AND u.organization_id IS NOT NULL;

ALTER TABLE ai_context_configs DROP INDEX IF EXISTS idx_acc_scope_key;
ALTER TABLE ai_context_configs ADD UNIQUE INDEX IF NOT EXISTS idx_acc_scope_key (scope, scope_id, org_id, config_key);

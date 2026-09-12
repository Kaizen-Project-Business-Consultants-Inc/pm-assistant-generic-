-- T038: Add scope column for cross-project (portfolio) automations
ALTER TABLE automations ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'project' AFTER trigger_entity_type;
CREATE INDEX idx_auto_scope_trigger ON automations (scope, trigger_event_type, status);

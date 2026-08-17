-- T001_baseline.sql — Consolidated tenant database schema
-- This creates all domain tables for a new tenant database.
-- Foreign keys to users table are omitted (users live in control plane DB).
-- Run via tenantMigrationRunner when provisioning a new organization.

-- ============================================================
-- Core Domain Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  category VARCHAR(100) DEFAULT NULL,
  project_type ENUM('it','construction','infrastructure','roads','other') NOT NULL DEFAULT 'other',
  methodology ENUM('waterfall','agile','hybrid') NOT NULL DEFAULT 'waterfall',
  status ENUM('planning','active','on_hold','completed','cancelled') NOT NULL DEFAULT 'planning',
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  budget_allocated DECIMAL(15,2) DEFAULT NULL,
  budget_spent DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  location VARCHAR(255) DEFAULT NULL,
  location_lat DECIMAL(10,7) DEFAULT NULL,
  location_lon DECIMAL(10,7) DEFAULT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  project_manager_id VARCHAR(36) DEFAULT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_projects_status (status),
  INDEX idx_projects_type (project_type),
  INDEX idx_projects_created_by (created_by),
  INDEX idx_projects_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_members (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  user_name VARCHAR(255) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  role ENUM('owner','manager','editor','viewer') NOT NULL DEFAULT 'viewer',
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_project_user (project_id, user_id),
  INDEX idx_pm_user_id (user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedules (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('pending','active','completed','on_hold','cancelled') NOT NULL DEFAULT 'active',
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_schedules_project_id (project_id),
  INDEX idx_schedules_status (status),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  status ENUM('pending','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  assigned_to VARCHAR(36) DEFAULT NULL,
  due_date DATE DEFAULT NULL,
  estimated_days INT DEFAULT NULL,
  estimated_duration_hours DECIMAL(8,2) DEFAULT NULL,
  actual_duration_hours DECIMAL(8,2) DEFAULT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  progress_percentage TINYINT UNSIGNED DEFAULT 0,
  dependency VARCHAR(36) DEFAULT NULL,
  dependency_type ENUM('FS','SS','FF','SF') DEFAULT NULL,
  risks TEXT DEFAULT NULL,
  issues TEXT DEFAULT NULL,
  comments TEXT DEFAULT NULL,
  parent_task_id VARCHAR(36) DEFAULT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  recurrence_rule VARCHAR(255) DEFAULT NULL,
  recurrence_parent_id VARCHAR(36) DEFAULT NULL,
  is_recurrence_template TINYINT(1) DEFAULT 0,
  is_milestone TINYINT(1) NOT NULL DEFAULT 0,
  dependency_lag_days INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  INDEX idx_tasks_schedule_id (schedule_id),
  INDEX idx_tasks_status (status),
  INDEX idx_tasks_assigned_to (assigned_to),
  INDEX idx_tasks_parent_task_id (parent_task_id),
  INDEX idx_tasks_dependency (dependency),
  INDEX idx_tasks_end_date (end_date),
  INDEX idx_tasks_recurrence_parent (recurrence_parent_id),
  INDEX idx_tasks_recurrence_template (is_recurrence_template),
  INDEX idx_tasks_schedule_sort (schedule_id, sort_order),
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_dependencies (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  dependency_id VARCHAR(36) NOT NULL,
  dependency_type ENUM('FS','SS','FF','SF') NOT NULL DEFAULT 'FS',
  lag_days INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_dep (task_id, dependency_id),
  INDEX idx_dep_id (dependency_id),
  INDEX idx_task_deps_dependency_id (dependency_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (dependency_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS resources (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  capacity_hours_per_week INT NOT NULL DEFAULT 40,
  skills JSON DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  cost_rate_hourly DECIMAL(10,2) DEFAULT NULL,
  INDEX idx_resources_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS resource_availability (
  id VARCHAR(36) PRIMARY KEY,
  resource_id VARCHAR(36) NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  type ENUM('vacation','holiday','unavailable','reduced') NOT NULL DEFAULT 'unavailable',
  hours_available DECIMAL(4,1) DEFAULT NULL,
  note VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
  INDEX idx_avail_resource (resource_id),
  INDEX idx_avail_dates (date_from, date_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Agent & AI Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_proposals (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  schedule_id VARCHAR(36),
  agent_id VARCHAR(255) NOT NULL,
  agent_version VARCHAR(50) NOT NULL,
  status ENUM('pending','approved','rejected','expired','executing','executed','rolled_back','failed') NOT NULL DEFAULT 'pending',
  title VARCHAR(500) NOT NULL,
  reasoning TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL,
  confidence_factors JSON,
  risk_level ENUM('low','medium','high','critical') NOT NULL,
  data_snapshot_version VARCHAR(64),
  expires_at DATETIME,
  created_by VARCHAR(36) NOT NULL,
  reviewed_by VARCHAR(36),
  reviewed_at DATETIME,
  executed_at DATETIME,
  rolled_back_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_id, status),
  INDEX idx_agent_status (agent_id, status),
  INDEX idx_expires (expires_at),
  INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_proposal_actions (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL,
  execution_order INT NOT NULL,
  action_type ENUM('update_task_dates','reassign_resource','update_dependency','update_progress','create_change_request','update_budget','send_notification') NOT NULL,
  target_entity_type VARCHAR(50) NOT NULL,
  target_entity_id VARCHAR(36) NOT NULL,
  old_value JSON,
  new_value JSON,
  reasoning TEXT,
  status ENUM('pending','executed','rolled_back','failed','skipped') NOT NULL DEFAULT 'pending',
  executed_at DATETIME,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES agent_proposals(id) ON DELETE CASCADE,
  INDEX idx_proposal_order (proposal_id, execution_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_proposal_reviews (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL,
  reviewer_id VARCHAR(36) NOT NULL,
  decision ENUM('approved','rejected','requested_changes') NOT NULL,
  comment TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES agent_proposals(id) ON DELETE CASCADE,
  INDEX idx_proposal (proposal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_feedback (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL,
  submitted_by VARCHAR(36) NOT NULL,
  outcome ENUM('effective','partially_effective','ineffective','made_worse','rolled_back') NOT NULL,
  comment TEXT,
  metrics_before JSON,
  metrics_after JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES agent_proposals(id) ON DELETE CASCADE,
  UNIQUE KEY idx_proposal_unique (proposal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_cost_ledger (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(36),
  scan_id VARCHAR(36),
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  model VARCHAR(100),
  latency_ms INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_date (agent_id, created_at),
  INDEX idx_project_date (project_id, created_at),
  INDEX idx_scan (scan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_confidence_log (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36),
  agent_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL,
  data_quality_score DECIMAL(5,2),
  historical_accuracy_score DECIMAL(5,2),
  model_certainty_score DECIMAL(5,2),
  factors JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_project (agent_id, project_id),
  INDEX idx_proposal (proposal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_activity_log (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  agent_name VARCHAR(50) NOT NULL,
  result VARCHAR(20) NOT NULL,
  summary TEXT NOT NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_log_project (project_id, created_at),
  INDEX idx_agent_log_agent (agent_name),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_autonomy_config (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(100) NOT NULL,
  project_id VARCHAR(36) DEFAULT NULL,
  autonomy_tier INT NOT NULL DEFAULT 2,
  min_confidence_threshold INT NOT NULL DEFAULT 80,
  max_risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
  enabled_by VARCHAR(36) NOT NULL,
  enabled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disabled_at TIMESTAMP NULL,
  UNIQUE KEY uq_agent_project (agent_id, project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_memory (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  agent_id VARCHAR(100) NOT NULL,
  memory_type ENUM('session','project','role','reflection') NOT NULL,
  entity_id VARCHAR(36) DEFAULT NULL,
  key_name VARCHAR(255) NOT NULL,
  value JSON NOT NULL,
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_memory_lookup (agent_id, memory_type, entity_id, key_name),
  INDEX idx_memory_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  agent_role ENUM('admin','executive','project_manager','team_member','scrum_master','finance_officer',
    'risk_manager','pmo','ba','qa','tester','devops','claude_sme') NOT NULL DEFAULT 'project_manager',
  capability VARCHAR(100) NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  permissions JSON DEFAULT NULL,
  config JSON DEFAULT NULL,
  timeout_ms INT NOT NULL DEFAULT 60000,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_agents_enabled (is_enabled),
  INDEX idx_agents_role (agent_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Notifications & Proposals
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  severity ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  title VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  project_id VARCHAR(36) NULL,
  schedule_id VARCHAR(36) NULL,
  link_type VARCHAR(50) NULL,
  link_id VARCHAR(255) NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id),
  INDEX idx_notif_user_unread (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reschedule_proposals (
  id VARCHAR(36) PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  proposal_data JSON NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  feedback TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_proposal_schedule (schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- P4 Features: Attachments, Time Tracking, Custom Fields
-- ============================================================

CREATE TABLE IF NOT EXISTS file_attachments (
  id VARCHAR(36) PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  uploaded_by VARCHAR(36) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INT NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  parent_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attach_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_entries (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  schedule_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  hours DECIMAL(5,2) NOT NULL,
  description TEXT NULL,
  billable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_time_task (task_id),
  INDEX idx_time_project (project_id),
  INDEX idx_time_user_date (user_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_fields (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(20) NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  field_label VARCHAR(100) NOT NULL,
  field_type VARCHAR(20) NOT NULL,
  options JSON NULL,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cf_project (project_id, entity_type),
  UNIQUE KEY uq_cf_name (project_id, entity_type, field_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_field_values (
  id VARCHAR(36) PRIMARY KEY,
  field_id VARCHAR(36) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  value_text TEXT NULL,
  value_number DECIMAL(15,4) NULL,
  value_date DATE NULL,
  value_boolean BOOLEAN NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cfv (field_id, entity_id),
  FOREIGN KEY (field_id) REFERENCES custom_fields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- P5 Features: Approvals, Portal, Integrations, Sprints, Reports, Intake
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_workflows (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  entity_type VARCHAR(30) NOT NULL,
  steps JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_aw_project (project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS change_requests (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  workflow_id VARCHAR(36) NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(30) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  impact_summary TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  current_step INT NOT NULL DEFAULT 0,
  requested_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cr_project (project_id),
  INDEX idx_cr_status (status),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES approval_workflows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_actions (
  id VARCHAR(36) PRIMARY KEY,
  change_request_id VARCHAR(36) NOT NULL,
  step_order INT NOT NULL,
  action VARCHAR(20) NOT NULL,
  comment TEXT NULL,
  acted_by VARCHAR(36) NOT NULL,
  acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aa_cr (change_request_id),
  FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_links (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(200) NULL,
  permissions JSON NOT NULL,
  expires_at DATETIME NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pl_project (project_id),
  INDEX idx_pl_token (token),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_comments (
  id VARCHAR(36) PRIMARY KEY,
  portal_link_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pc_entity (entity_type, entity_id),
  FOREIGN KEY (portal_link_id) REFERENCES portal_links(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integrations (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NULL,
  user_id VARCHAR(36) NOT NULL,
  provider VARCHAR(30) NOT NULL,
  config JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_int_user (user_id),
  INDEX idx_int_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_sync_log (
  id VARCHAR(36) PRIMARY KEY,
  integration_id VARCHAR(36) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL,
  items_synced INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  INDEX idx_sync_log_integration (integration_id),
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sprints (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  schedule_id VARCHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  goal TEXT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'planning',
  velocity_commitment INT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sprint_project (project_id),
  INDEX idx_sprint_schedule (schedule_id),
  INDEX idx_sprints_project_id (project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sprint_tasks (
  id VARCHAR(36) PRIMARY KEY,
  sprint_id VARCHAR(36) NOT NULL,
  task_id VARCHAR(36) NOT NULL,
  story_points INT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sprint_task (sprint_id, task_id),
  INDEX idx_sprint_tasks_sprint_id (sprint_id),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_templates (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  config JSON NOT NULL,
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rt_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_schedules (
  id VARCHAR(36) PRIMARY KEY,
  template_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  frequency ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'weekly',
  day_of_week TINYINT NULL,
  day_of_month TINYINT NULL,
  time_of_day VARCHAR(5) NOT NULL DEFAULT '08:00',
  recipients JSON NOT NULL,
  format ENUM('csv') NOT NULL DEFAULT 'csv',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at DATETIME NOT NULL,
  last_run_at DATETIME NULL,
  last_run_status VARCHAR(20) NULL,
  last_run_error TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_next_run (is_active, next_run_at),
  INDEX idx_template (template_id),
  INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS intake_forms (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  fields JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_if_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS intake_submissions (
  id VARCHAR(36) PRIMARY KEY,
  form_id VARCHAR(36) NOT NULL,
  submitted_by VARCHAR(36) NOT NULL,
  values_json JSON NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  reviewer_id VARCHAR(36) NULL,
  review_notes TEXT NULL,
  converted_project_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_is_form (form_id),
  INDEX idx_is_status (status),
  FOREIGN KEY (form_id) REFERENCES intake_forms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Webhooks
-- ============================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  url VARCHAR(2000) NOT NULL,
  secret VARCHAR(128) NOT NULL,
  events JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INT NOT NULL DEFAULT 0,
  last_triggered_at DATETIME NULL,
  last_status_code INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_wh_user (user_id),
  INDEX idx_wh_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Audit & Policy
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entry_uuid CHAR(36) NOT NULL UNIQUE,
  prev_hash CHAR(64) NOT NULL,
  entry_hash CHAR(64) NOT NULL,
  actor_id VARCHAR(36) NOT NULL,
  actor_type ENUM('user','api_key','system') NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) DEFAULT NULL,
  payload JSON NOT NULL,
  source ENUM('web','mcp','api','system') NOT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  session_id VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_project (project_id, created_at),
  INDEX idx_actor (actor_id, created_at),
  INDEX idx_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only triggers for audit ledger
DROP TRIGGER IF EXISTS audit_ledger_no_update;
CREATE TRIGGER audit_ledger_no_update BEFORE UPDATE ON audit_ledger
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_ledger is append-only';

DROP TRIGGER IF EXISTS audit_ledger_no_delete;
CREATE TRIGGER audit_ledger_no_delete BEFORE DELETE ON audit_ledger
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_ledger is append-only';

CREATE TABLE IF NOT EXISTS policies (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) DEFAULT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  action_pattern VARCHAR(100) NOT NULL,
  condition_expr JSON NOT NULL,
  enforcement ENUM('log_only','require_approval','block') NOT NULL DEFAULT 'log_only',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project (project_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS policy_evaluations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_id VARCHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(50) DEFAULT NULL,
  entity_id VARCHAR(36) DEFAULT NULL,
  matched TINYINT(1) NOT NULL,
  enforcement_result ENUM('allowed','blocked','pending_approval') NOT NULL,
  context_snapshot JSON,
  created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (policy_id) REFERENCES policies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DAG Workflows
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) DEFAULT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project (project_id, is_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id VARCHAR(36) PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  node_type ENUM('trigger','condition','action','approval','delay','agent') NOT NULL,
  name VARCHAR(200) NOT NULL,
  config JSON NOT NULL,
  position_x INT NOT NULL DEFAULT 0,
  position_y INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_edges (
  id VARCHAR(36) PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  source_node_id VARCHAR(36) NOT NULL,
  target_node_id VARCHAR(36) NOT NULL,
  condition_expr JSON DEFAULT NULL,
  label VARCHAR(100) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  INDEX idx_workflow (workflow_id),
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_node_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_executions (
  id VARCHAR(36) PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  trigger_node_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  status ENUM('running','completed','failed','cancelled','waiting') NOT NULL DEFAULT 'running',
  context JSON NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  INDEX idx_workflow (workflow_id),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_status (status),
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_node_executions (
  id VARCHAR(36) PRIMARY KEY,
  execution_id VARCHAR(36) NOT NULL,
  node_id VARCHAR(36) NOT NULL,
  status ENUM('pending','running','completed','failed','skipped','waiting') NOT NULL DEFAULT 'pending',
  input_data JSON DEFAULT NULL,
  output_data JSON DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  started_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  INDEX idx_execution (execution_id),
  INDEX idx_node (node_id),
  FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Embeddings, Lessons Learned, Meeting Analyses
-- ============================================================

CREATE TABLE IF NOT EXISTS lessons_learned (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  project_name VARCHAR(200) NOT NULL,
  project_type VARCHAR(100) NOT NULL,
  category ENUM('schedule','budget','resource','risk','technical','communication','stakeholder','quality') NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  impact ENUM('positive','negative','neutral') NOT NULL,
  recommendation TEXT NOT NULL,
  confidence TINYINT UNSIGNED NOT NULL DEFAULT 80,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ll_project (project_id),
  INDEX idx_ll_category (category),
  INDEX idx_ll_project_type (project_type),
  INDEX idx_lessons_project_id (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_analyses (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  schedule_id VARCHAR(36) NULL,
  transcript LONGTEXT NOT NULL,
  summary MEDIUMTEXT NULL,
  action_items MEDIUMTEXT NULL,
  decisions MEDIUMTEXT NULL,
  risks MEDIUMTEXT NULL,
  task_updates MEDIUMTEXT NULL,
  applied_items MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ma_project (project_id),
  INDEX idx_ma_schedule (schedule_id),
  INDEX idx_meetings_project_id (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS embeddings (
  id VARCHAR(36) PRIMARY KEY,
  document_type ENUM('lesson','meeting') NOT NULL,
  document_id VARCHAR(64) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  embedding BLOB NOT NULL,
  model VARCHAR(50) NOT NULL DEFAULT 'text-embedding-3-small',
  dimensions SMALLINT UNSIGNED NOT NULL DEFAULT 1536,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_emb_document (document_type, document_id),
  INDEX idx_emb_type (document_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Goals / OKR
-- ============================================================

CREATE TABLE IF NOT EXISTS goals (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  owner_id VARCHAR(36) NOT NULL,
  parent_id VARCHAR(36) NULL,
  goal_type ENUM('objective','key_result') NOT NULL DEFAULT 'objective',
  status ENUM('on_track','at_risk','behind','completed') NOT NULL DEFAULT 'on_track',
  progress DECIMAL(5,2) NOT NULL DEFAULT 0,
  target_value DECIMAL(10,2) NULL,
  current_value DECIMAL(10,2) NULL,
  unit VARCHAR(50) NULL,
  start_date DATE NULL,
  due_date DATE NULL,
  project_id VARCHAR(36) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_owner (owner_id),
  INDEX idx_parent (parent_id),
  INDEX idx_project (project_id),
  INDEX idx_type (goal_type),
  INDEX idx_goals_parent_type (parent_id, goal_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- AI Usage & Dead Letter Queue
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NULL,
  feature VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_estimate DECIMAL(10,6) NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT NULL,
  request_context JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_usage_user_created (user_id, created_at),
  INDEX idx_ai_usage_feature (feature),
  INDEX idx_ai_usage_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id VARCHAR(36) PRIMARY KEY,
  operation VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  error_message TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  max_attempts INT NOT NULL DEFAULT 3,
  status ENUM('pending','retrying','failed','resolved') NOT NULL DEFAULT 'pending',
  next_retry_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  INDEX idx_dlq_status_retry (status, next_retry_at),
  INDEX idx_dlq_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Chat
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_conversations (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) DEFAULT NULL,
  context_type VARCHAR(20) NOT NULL DEFAULT 'general',
  title VARCHAR(255) NOT NULL,
  token_count INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_conv_user (user_id, is_active, updated_at),
  INDEX idx_conv_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  content TEXT NOT NULL,
  actions JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_msg_conv (conversation_id, created_at),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Health & RAID
-- ============================================================

CREATE TABLE IF NOT EXISTS project_health_history (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  health_score INT NOT NULL,
  risk_level ENUM('low','medium','high','critical') NOT NULL,
  schedule_health INT,
  budget_health INT,
  risk_health INT,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_date (project_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_risks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  type ENUM('risk','issue','action','decision') NOT NULL DEFAULT 'risk',
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category ENUM('schedule','budget','resource','technical','regulatory','stakeholder','weather','dependency','other') NOT NULL DEFAULT 'other',
  severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  probability TINYINT UNSIGNED NOT NULL DEFAULT 3 CHECK (probability BETWEEN 1 AND 5),
  impact TINYINT UNSIGNED NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  risk_score TINYINT UNSIGNED GENERATED ALWAYS AS (probability * impact) STORED,
  status ENUM('proposed','open','monitoring','mitigating','mitigated','closed','resolved',
    'cancelled','reversed','in_progress','completed','pending_decision','decided','deferred') NOT NULL DEFAULT 'open',
  trigger_condition TEXT,
  triggered BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_at TIMESTAMP NULL,
  mitigation_plan TEXT,
  response_plan TEXT,
  owner_id CHAR(36),
  source ENUM('manual','ai_detected','agent') NOT NULL DEFAULT 'manual',
  source_agent_id VARCHAR(64),
  ai_confidence DECIMAL(3,2),
  linked_task_ids JSON,
  linked_proposal_id CHAR(36),
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  sequence_number INT UNSIGNED NULL,
  record_id VARCHAR(10) NULL,
  due_date DATE NULL,
  action_type ENUM('preventive','corrective','improvement') NULL,
  rationale TEXT NULL,
  decided_by CHAR(36) NULL,
  decision_date DATE NULL,
  alternatives_considered TEXT NULL,
  stakeholders_consulted JSON NULL,
  cancel_reason TEXT NULL,
  linked_raid_ids JSON NULL,
  root_cause TEXT NULL,
  impact_assessment TEXT NULL,
  workaround TEXT NULL,
  INDEX idx_project_risks_project_type_status (project_id, type, status),
  INDEX idx_project_risks_project_triggered (project_id, triggered),
  INDEX idx_project_risks_project_agent (project_id, source_agent_id),
  UNIQUE INDEX idx_project_risks_record_id (record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raid_sequence_counter (
  type VARCHAR(10) PRIMARY KEY,
  next_val INT UNSIGNED NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO raid_sequence_counter (type, next_val)
  VALUES ('risk', 1), ('issue', 1), ('action', 1), ('decision', 1);

CREATE TABLE IF NOT EXISTS raid_activity_log (
  id CHAR(36) PRIMARY KEY,
  raid_item_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  action_type ENUM('comment','status_change','field_update','created','cancelled','reversed','linked','update_added','update_deleted') NOT NULL,
  field_name VARCHAR(64) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_raid_activity_item (raid_item_id, created_at),
  INDEX idx_raid_activity_project (project_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raid_updates (
  id CHAR(36) PRIMARY KEY,
  raid_item_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_raid_updates_item (raid_item_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Project Expenses
-- ============================================================

CREATE TABLE IF NOT EXISTS project_expenses (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  category ENUM('labor','materials','software','hardware','travel','contractors','training','consulting','licenses','other') NOT NULL DEFAULT 'other',
  vendor VARCHAR(255) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  receipt_attachment_id VARCHAR(36) DEFAULT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_expenses_project (project_id),
  INDEX idx_expenses_date (project_id, date),
  INDEX idx_expenses_category (project_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Seed Data: Default workflow definitions
-- ============================================================

INSERT INTO workflow_definitions (id, project_id, name, description, is_enabled, version, created_by) VALUES
  ('wf-seed-1', NULL, 'Auto-complete on 100% progress', 'When a task reaches 100% progress, automatically set status to completed', 1, 1, 'system'),
  ('wf-seed-2', NULL, 'Log when task starts', 'Log activity when a task moves to in_progress', 1, 1, 'system'),
  ('wf-seed-3', NULL, 'Notify on cancellation', 'Send notification when a task is cancelled', 1, 1, 'system'),
  ('wf-seed-4', NULL, 'On task overdue — reschedule agent', 'When a task passes its end date, invoke the auto-reschedule agent and notify the PM', 1, 1, 'system'),
  ('wf-seed-5', NULL, 'On task marked urgent — notify PM', 'When a task priority changes to urgent, send a high-severity notification', 1, 1, 'system');

INSERT INTO workflow_nodes (id, workflow_id, node_type, name, config, position_x, position_y) VALUES
  ('wf-seed-1-trigger', 'wf-seed-1', 'trigger', 'Progress reaches 100%', '{"triggerType":"progress_threshold","progressThreshold":100,"progressDirection":"above"}', 0, 0),
  ('wf-seed-1-action', 'wf-seed-1', 'action', 'Set status to completed', '{"actionType":"update_field","field":"status","value":"completed"}', 0, 100),
  ('wf-seed-2-trigger', 'wf-seed-2', 'trigger', 'Status changes to in_progress', '{"triggerType":"status_change","toStatus":"in_progress"}', 0, 0),
  ('wf-seed-2-action', 'wf-seed-2', 'action', 'Log activity', '{"actionType":"log_activity","message":"Task work has started"}', 0, 100),
  ('wf-seed-3-trigger', 'wf-seed-3', 'trigger', 'Status changes to cancelled', '{"triggerType":"status_change","toStatus":"cancelled"}', 0, 0),
  ('wf-seed-3-action', 'wf-seed-3', 'action', 'Send notification', '{"actionType":"send_notification","message":"A task has been cancelled"}', 0, 100),
  ('wf-seed-4-trigger', 'wf-seed-4', 'trigger', 'Task overdue', '{"triggerType":"date_passed"}', 0, 0),
  ('wf-seed-4-agent', 'wf-seed-4', 'agent', 'Run reschedule agent', '{"capabilityId":"auto-reschedule-v1","input":{"scheduleId":"{{task.scheduleId}}"},"retries":1,"backoffMs":2000}', 0, 100),
  ('wf-seed-4-notify', 'wf-seed-4', 'action', 'Notify PM', '{"actionType":"send_notification","severity":"high","message":"Agent detected overdue task and generated a reschedule proposal."}', 0, 200),
  ('wf-seed-5-trigger', 'wf-seed-5', 'trigger', 'Priority changed to urgent', '{"triggerType":"priority_change","toPriority":"urgent"}', 0, 0),
  ('wf-seed-5-action', 'wf-seed-5', 'action', 'Notify PM of urgent task', '{"actionType":"send_notification","severity":"high","message":"Task priority escalated to urgent: {{task.name}}"}', 0, 100);

INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, sort_order) VALUES
  ('wf-seed-1-edge', 'wf-seed-1', 'wf-seed-1-trigger', 'wf-seed-1-action', 0),
  ('wf-seed-2-edge', 'wf-seed-2', 'wf-seed-2-trigger', 'wf-seed-2-action', 0),
  ('wf-seed-3-edge', 'wf-seed-3', 'wf-seed-3-trigger', 'wf-seed-3-action', 0),
  ('wf-seed-4-edge1', 'wf-seed-4', 'wf-seed-4-trigger', 'wf-seed-4-agent', 0),
  ('wf-seed-4-edge2', 'wf-seed-4', 'wf-seed-4-agent', 'wf-seed-4-notify', 0),
  ('wf-seed-5-edge', 'wf-seed-5', 'wf-seed-5-trigger', 'wf-seed-5-action', 0);

-- Seed agents
INSERT INTO agents (id, display_name, description, agent_role, capability, version, permissions, timeout_ms) VALUES
  ('auto-reschedule-v1', 'Auto-Reschedule Agent', 'Detects schedule delays and generates reschedule proposals', 'project_manager', 'schedule.optimize', '1.0.0', '["agent:schedule"]', 120000),
  ('budget-forecast-v1', 'Budget Forecast Agent', 'Generates budget forecasts using earned value management', 'finance_officer', 'budget.forecast', '1.0.0', '["agent:budget"]', 60000),
  ('monte-carlo-v1', 'Monte Carlo Agent', 'Runs Monte Carlo simulations for schedule risk analysis', 'risk_manager', 'schedule.simulate', '1.0.0', '["agent:schedule"]', 60000),
  ('meeting-followup-v1', 'Meeting Follow-up Agent', 'Extracts action items and tasks from meeting transcripts', 'ba', 'meeting.extract', '1.0.0', '["agent:meeting"]', 60000),
  ('schedule-recovery-v1', 'Schedule Recovery Agent', 'Analyzes schedule failures and generates recovery plans', 'project_manager', 'schedule.recover', '1.0.0', '["agent:schedule"]', 120000),
  ('scope-creep-detection-v1', 'Scope Creep Detector', 'Detects scope creep by analyzing task additions, expansions, and timeline changes', 'project_manager', 'risk.scope', '1.0.0', '["agent:risk"]', 120000),
  ('budget-intelligence-v1', 'Budget Intelligence Agent', 'Detects budget anomalies, spending patterns, and cost risks', 'finance_officer', 'budget.analyze', '1.0.0', '["agent:budget"]', 120000),
  ('resource-optimization-v1', 'Resource Optimization Agent', 'Analyzes resource allocation and suggests rebalancing', 'project_manager', 'resource.optimize', '1.0.0', '["agent:resource"]', 120000),
  ('cross-project-intelligence-v1', 'Cross-Project Intelligence Agent', 'Analyzes patterns across the entire portfolio for systemic risks and optimization', 'pmo', 'portfolio.analyze', '1.0.0', '["agent:portfolio"]', 120000),
  ('risk-escalation-v1', 'Risk Escalation Agent', 'Aggregates findings from all agents and escalates compound risks', 'risk_manager', 'risk.escalate', '1.0.0', '["agent:risk"]', 120000),
  ('stakeholder-communication-v1', 'Stakeholder Communication Agent', 'Generates stakeholder updates and status communications', 'project_manager', 'communication.generate', '1.0.0', '["agent:communication"]', 120000),
  ('project-hygiene-v1', 'Project Hygiene Agent', 'Checks project data quality, missing fields, stale tasks, and naming conventions', 'qa', 'quality.hygiene', '1.0.0', '["agent:quality"]', 120000),
  ('dependency-risk-v1', 'Dependency Risk Agent', 'Analyzes task dependencies for critical path risks and bottlenecks', 'project_manager', 'risk.dependency', '1.0.0', '["agent:risk"]', 120000),
  ('lessons-learned-v1', 'Lessons Learned Agent', 'Extracts lessons from completed projects and applies to active ones', 'ba', 'knowledge.lessons', '1.0.0', '["agent:knowledge"]', 120000),
  ('predictive-alerting-v1', 'Predictive Alerting Agent', 'Detects patterns that predict project problems using velocity trends and risk accumulation', 'risk_manager', 'prediction.alert', '1.0.0', '["agent:prediction"]', 180000),
  ('rag-query-v1', 'RAG Query Agent', 'Retrieves and synthesizes information from project documents using embeddings', 'claude_sme', 'knowledge.query', '1.0.0', '["agent:knowledge"]', 60000);

-- Seed default policies
-- MCP tool invocation logging
CREATE TABLE IF NOT EXISTS mcp_tool_invocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) DEFAULT NULL,
  api_key_id VARCHAR(36) DEFAULT NULL,
  session_id VARCHAR(64) DEFAULT NULL,
  tool_name VARCHAR(128) NOT NULL,
  duration_ms INT UNSIGNED DEFAULT NULL,
  is_success TINYINT(1) NOT NULL DEFAULT 1,
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_mcp_inv_user_created (user_id, created_at),
  INDEX idx_mcp_inv_tool_created (tool_name, created_at),
  INDEX idx_mcp_inv_apikey_created (api_key_id, created_at),
  INDEX idx_mcp_inv_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO policies (id, project_id, name, description, action_pattern, condition_expr, enforcement, is_active, created_by) VALUES
  ('pol-budget-10pct', NULL, 'Budget Change >10% Requires Approval',
   'Any budget change exceeding 10% of allocated budget must be approved',
   'budget.*',
   '{"type":"threshold","field":"percentageChange","operator":"gt","value":10}',
   'require_approval', 1, 'system'),
  ('pol-reschedule-block', NULL, 'Block Agent Reschedule on Active Sprint Tasks',
   'Prevent automatic rescheduling of tasks currently in an active sprint',
   'schedule.reschedule',
   '{"type":"context","field":"isInActiveSprint","operator":"eq","value":true}',
   'block', 1, 'system'),
  ('pol-cost-audit', NULL, 'Audit High-Value Changes',
   'Log all changes affecting cost or budget fields for compliance',
   'task.update',
   '{"type":"field_changed","fields":["estimated_cost","actual_cost","budget_allocated"]}',
   'log_only', 1, 'system');

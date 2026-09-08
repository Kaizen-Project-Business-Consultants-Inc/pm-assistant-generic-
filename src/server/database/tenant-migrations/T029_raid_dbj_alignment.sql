-- T029: RAID Log alignment with DBJ spreadsheet
-- Adds assumption and dependency types, expands enums, adds missing columns

-- 1. Expand type ENUM
ALTER TABLE project_risks MODIFY COLUMN type ENUM('risk','issue','action','decision','assumption','dependency') NOT NULL;

-- 2. Expand category ENUM
ALTER TABLE project_risks MODIFY COLUMN category ENUM('schedule','budget','resource','technical','regulatory','stakeholder','weather','dependency','other','financial','functional','operational','legal') NOT NULL DEFAULT 'other';

-- 3. Expand action_type ENUM
ALTER TABLE project_risks MODIFY COLUMN action_type ENUM('preventive','corrective','improvement','financial','functional','technical','operational','legal') DEFAULT NULL;

-- 4. Expand status ENUM
ALTER TABLE project_risks MODIFY COLUMN status ENUM('proposed','open','monitoring','mitigating','mitigated','closed','resolved','cancelled','reversed','in_progress','completed','pending_decision','decided','deferred','validated','unverified','at_risk','complete','pending') NOT NULL DEFAULT 'open';

-- 5. Add new columns
ALTER TABLE project_risks
  ADD COLUMN validation_plan TEXT DEFAULT NULL AFTER workaround,
  ADD COLUMN dependent_entity VARCHAR(500) DEFAULT NULL AFTER validation_plan,
  ADD COLUMN forum VARCHAR(255) DEFAULT NULL AFTER dependent_entity,
  ADD COLUMN source_meeting VARCHAR(255) DEFAULT NULL AFTER forum,
  ADD COLUMN owner_name VARCHAR(255) DEFAULT NULL AFTER source_meeting;

-- 6. Sequence counter rows for new types
INSERT IGNORE INTO raid_sequence_counter (type, next_val) VALUES ('assumption', 1);
INSERT IGNORE INTO raid_sequence_counter (type, next_val) VALUES ('dependency', 1);

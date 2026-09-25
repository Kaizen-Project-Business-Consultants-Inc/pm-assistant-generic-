-- Three new project types so Schedule Review can apply web / app specific checks
-- (task length limits, expected phases and milestones). Existing values are unchanged;
-- appending to an ENUM is a metadata-only change in MariaDB.
-- Keep in step with src/server/constants/projectTypes.ts.
ALTER TABLE projects
  MODIFY project_type ENUM('it','construction','infrastructure','roads','other','web_design','web_application','app_development') NOT NULL DEFAULT 'other';

-- T083: where the nightly agent scan got to, per project (2026-10-07). A company with hundreds of
-- projects can't be scanned inside the job's 5 minutes, so each night picks the projects scanned
-- longest ago and stops at its time limit; the rest go first the next night. Monte Carlo (the slow
-- check) runs at most once a week per project.
CREATE TABLE IF NOT EXISTS agent_scan_state (
  project_id VARCHAR(36) NOT NULL PRIMARY KEY,
  last_scanned_at DATETIME NULL,
  last_monte_carlo_at DATETIME NULL
);

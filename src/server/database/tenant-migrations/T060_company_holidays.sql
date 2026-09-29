-- Company holidays (2026-09-29): one list per company, picked up by every project's
-- working calendar. A project can still add its own days off, or mark a company
-- holiday as a working day for that project (calendar_exceptions type 'working').
CREATE TABLE IF NOT EXISTS company_holidays (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  holiday_date DATE NOT NULL,
  name VARCHAR(255) DEFAULT NULL,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_holiday_date (holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

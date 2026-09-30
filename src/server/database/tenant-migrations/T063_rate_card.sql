-- Rate card (2026-09-30): hourly cost rates by role, each with the date it starts.
-- Time is costed at the rate in force on the day (week) it was worked, so a raise from
-- 1 October doesn't change September's cost. A resource uses the card only when
-- use_rate_card = 1; everyone starts on their own rate, so no cost changes on day one.
CREATE TABLE IF NOT EXISTS rate_card (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  role VARCHAR(100) NOT NULL,
  hourly_rate DECIMAL(10,2) NOT NULL,
  overtime_rate DECIMAL(10,2) DEFAULT NULL,
  effective_from DATE NOT NULL,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rate_card_role_from (role, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE resources ADD COLUMN IF NOT EXISTS use_rate_card TINYINT(1) NOT NULL DEFAULT 0;

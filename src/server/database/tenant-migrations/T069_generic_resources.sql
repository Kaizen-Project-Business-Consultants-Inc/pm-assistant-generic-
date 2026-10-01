-- Generic resources (2026-10-01): every resource is either a real person, who has an email
-- (and can be invited, appears on a project's Team, gets notified), or a generic role
-- ("Generic Developer") — a stand-in for work not yet staffed: no email, no login, never on a
-- Team list, not counted as over-booked. The PM swaps in a real person later.

ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_generic TINYINT(1) NOT NULL DEFAULT 0;

-- Default generic roles (the PM can add more)
INSERT INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, is_generic)
SELECT UUID(), 'Generic Developer', 'Developer', '', 40, '[]', 1, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM resources WHERE is_generic = 1 AND name = 'Generic Developer');
INSERT INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, is_generic)
SELECT UUID(), 'Generic Business Analyst', 'Business Analyst', '', 40, '[]', 1, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM resources WHERE is_generic = 1 AND name = 'Generic Business Analyst');
INSERT INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, is_generic)
SELECT UUID(), 'Generic QA / Tester', 'QA / Tester', '', 40, '[]', 1, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM resources WHERE is_generic = 1 AND name = 'Generic QA / Tester');
INSERT INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, is_generic)
SELECT UUID(), 'Generic Designer', 'Designer', '', 40, '[]', 1, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM resources WHERE is_generic = 1 AND name = 'Generic Designer');
INSERT INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, is_generic)
SELECT UUID(), 'Generic Architect', 'Architect', '', 40, '[]', 1, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM resources WHERE is_generic = 1 AND name = 'Generic Architect');
INSERT INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, is_generic)
SELECT UUID(), 'Generic Project Manager', 'Project Manager', '', 40, '[]', 1, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM resources WHERE is_generic = 1 AND name = 'Generic Project Manager');

-- People without an email get a placeholder, firstname.lastname@example.com. example.com is
-- reserved (it can never receive mail) and the app never sends to it (utils/placeholderEmail.ts).
UPDATE resources
SET email = CONCAT(
  COALESCE(NULLIF(TRIM(BOTH '.' FROM REGEXP_REPLACE(LOWER(TRIM(name)), '[^a-z0-9]+', '.')), ''), CONCAT('resource.', LEFT(id, 8))),
  '@example.com')
WHERE is_generic = 0 AND TRIM(email) = '';

-- Two people with the same name would share a placeholder: tell them apart
UPDATE resources r
JOIN (SELECT email FROM resources WHERE email LIKE '%@example.com' GROUP BY email HAVING COUNT(*) > 1) d ON d.email = r.email
SET r.email = CONCAT(SUBSTRING_INDEX(r.email, '@', 1), '.', LEFT(r.id, 8), '@example.com');

-- Migration 127 (2026-09-30): one text collation for every shared table that joins to users /
-- organizations. These were created without a COLLATE clause and got the server default
-- (utf8mb4_general_ci), while users and organizations are utf8mb4_unicode_ci — so any JOIN on
-- their ids failed with "Illegal mix of collations". The admin Feedback page has been failing
-- on this ("Failed to load feedback"); token top-ups and the template/automation marketplaces
-- join on user/organization ids the same way. Same fix as 051 (organizations).
ALTER TABLE feedback CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE token_top_ups CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE template_marketplace CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE automation_marketplace CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE tier_features CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE pricing_config CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

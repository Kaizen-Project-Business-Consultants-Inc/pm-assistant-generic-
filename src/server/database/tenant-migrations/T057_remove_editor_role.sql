-- The Editor project role was removed (Sep 2026): only a project's Manager or Owner may
-- change project data; everyone else on the team reads. The code already treats a stored
-- 'editor' as read-only; this renames any remaining editors to 'viewer' so the Team tab
-- shows what they can actually do. The ENUM keeps 'editor' so old rows/exports still load.
UPDATE project_members SET role = 'viewer' WHERE role = 'editor';

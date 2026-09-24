-- A RAID item's owner_id has always meant a real login account — used to send
-- notifications, filter "my RAID items," and check viewer edit rights. External
-- personnel who exist only as a `resources` row with no linked `resources.user_id`
-- (e.g. subcontractor teams who will never log in) could never own a RAID item;
-- resolveOwnerId() silently returned null for them and the item ended up with no
-- real owner. owner_resource_id lets a resource own an item directly, with no
-- account required. At most one of owner_id / owner_resource_id is ever set —
-- enforced in RiskRepository, not by a DB constraint (matches this table's
-- existing style: owner_id itself has no FK either).
ALTER TABLE project_risks
  ADD COLUMN owner_resource_id CHAR(36) NULL AFTER owner_id,
  ADD INDEX idx_project_risks_owner_resource (owner_resource_id);

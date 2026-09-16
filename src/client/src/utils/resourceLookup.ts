/**
 * Find the resource a task's `assignedTo` value refers to.
 *
 * `assignedTo` normally holds a resource ID (or the linked user ID), but
 * schedules imported before resources were linked hold the person's name.
 * Match by ID first, then fall back to a case-insensitive name match so those
 * older schedules still resolve in pickers and displays.
 */
export interface AssignableResource {
  id: string;
  name: string;
  userId?: string | null;
}

export function findResourceForAssignee<T extends AssignableResource>(
  resources: T[],
  value: string | null | undefined,
): T | null {
  const v = value?.trim();
  if (!v) return null;
  const byId = resources.find(r => r.id === v || (r.userId != null && r.userId === v));
  if (byId) return byId;
  const lower = v.toLowerCase();
  return resources.find(r => r.name.trim().toLowerCase() === lower) ?? null;
}

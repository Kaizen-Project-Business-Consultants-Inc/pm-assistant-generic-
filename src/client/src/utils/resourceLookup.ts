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

const ID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What to show for a task's Assigned To value: the person's name; an older plain-text name as it
 * is; "Unknown person" for an id nobody visible matches (removed, or not on this person's list).
 * A raw id is never shown. `loaded` = the people list has arrived: until then an id shows nothing
 * rather than flashing "Unknown person".
 */
export function assigneeLabel(value: string | null | undefined, names: ReadonlyMap<string, string>, loaded = true): string {
  const v = value?.trim();
  if (!v) return '';
  const name = names.get(v);
  if (name) return name;
  if (!ID_LIKE.test(v)) return v;
  return loaded ? 'Unknown person' : '';
}

interface PeopleOnTask {
  assignedTo?: string | null;
  assignments?: ReadonlyArray<{ resourceId: string; allocationPct?: number }> | null;
}

/**
 * Everyone on a task as one list for the single Assigned To column: the main person first (the
 * Assigned To value, else the first person listed), then the others. `text` is "Main +N", `title`
 * lists everyone with their %, `names` is everyone's name (exports, search).
 */
export function assigneeSummary(
  task: PeopleOnTask, names: ReadonlyMap<string, string>, loaded = true,
): { text: string; title: string; names: string[] } {
  const label = (id: string) => assigneeLabel(id, names, loaded);
  const pctOf = new Map((task.assignments ?? []).map(a => [label(a.resourceId), a.allocationPct ?? 100]));
  const main = label(task.assignedTo ?? '') || label(task.assignments?.[0]?.resourceId ?? '');
  const others = [...new Set((task.assignments ?? []).map(a => label(a.resourceId)).filter(n => n && n !== main))];
  const all = main ? [main, ...others] : others;
  const show = (n: string) => (pctOf.has(n) ? `${n} ${pctOf.get(n)}%` : n);
  return {
    text: others.length > 0 && main ? `${main} +${others.length}` : main,
    title: all.length > 1 ? all.map(show).join(', ') : '',
    names: all,
  };
}

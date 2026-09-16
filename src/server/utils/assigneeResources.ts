/**
 * Resolve imported assignee names to resource IDs.
 *
 * Spreadsheet and MS Project imports only ever carry people's names, while
 * tasks store `assignedTo` as a resource ID. This helper matches each name
 * against existing resources (case-insensitive, trimmed) and creates any that
 * are missing, so imported tasks can be linked to real resource records.
 */

export interface AssigneeResourceRef {
  id: string;
  name: string;
}

export interface AssigneeResolution {
  /** lower-cased, trimmed assignee name → resource ID */
  idByName: Map<string, string>;
  /** number of resources created during resolution */
  created: number;
}

export function normalizeAssigneeName(name: string): string {
  return name.trim().toLowerCase();
}

export async function resolveAssigneeResources(
  names: Iterable<string>,
  existing: AssigneeResourceRef[],
  createResource: (name: string) => Promise<AssigneeResourceRef>,
): Promise<AssigneeResolution> {
  const idByName = new Map<string, string>();
  for (const r of existing) {
    const key = normalizeAssigneeName(r.name);
    if (key && !idByName.has(key)) idByName.set(key, r.id);
  }

  let created = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = normalizeAssigneeName(name);
    if (idByName.has(key)) continue;
    const resource = await createResource(name);
    idByName.set(key, resource.id);
    created++;
  }

  return { idByName, created };
}

/** Return the resource ID for an assignee name, or the raw name when unknown. */
export function assigneeToResourceId(name: string | undefined, idByName: Map<string, string>): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  return idByName.get(normalizeAssigneeName(trimmed)) ?? trimmed;
}

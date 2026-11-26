/**
 * One list of people on a task (Assigned To, 2026-11-26). The task still stores a main person
 * (assignedTo) and a list with % and role (assignments); the form shows them as one list, the
 * main person first. Saving a list makes the server set assignedTo to the first person in it.
 * Workload counts the main person at 100% unless they are in the list with a %.
 */
export interface PersonRow { resourceId: string; allocationPct: number; roleOnTask: string; hoursPlanned?: number }

/** The saved main person and list as one list: main first, added at 100% when not in the list yet. */
export function peopleRows(mainId: string, assignments: ReadonlyArray<PersonRow>): PersonRow[] {
  if (!mainId) return [...assignments];
  const rest = assignments.filter(a => a.resourceId !== mainId);
  const own = assignments.find(a => a.resourceId === mainId);
  return [own ?? { resourceId: mainId, allocationPct: 100, roleOnTask: '' }, ...rest];
}

/**
 * What to save for the list on screen: blanks and repeats dropped, the first person is the main
 * one. One person at 100% with no role needs no list, unless the task already had one (then the
 * list is rewritten, or the old rows would stay). `assignments` undefined = leave the saved list
 * alone. With nobody left the old Assigned To text is kept when it was a name nobody matched
 * (`keepMain`), else cleared.
 */
export function peopleToSave(rows: ReadonlyArray<PersonRow>, keepMain: string, hadList = false): { assignedTo: string; assignments?: PersonRow[] } {
  const seen = new Set<string>();
  const filled = rows.filter(r => r.resourceId && !seen.has(r.resourceId) && !!seen.add(r.resourceId));
  if (filled.length === 0) return { assignedTo: keepMain, assignments: hadList ? [] : undefined };
  const alone = filled.length === 1 && filled[0].allocationPct === 100 && !filled[0].roleOnTask && !filled[0].hoursPlanned;
  return { assignedTo: filled[0].resourceId, assignments: alone && !hadList ? undefined : filled };
}

/**
 * The Table / Gantt cell changes the MAIN person ('' = take them off). On a task that has a list the
 * list changes with it, so the cell never keeps showing someone it just replaced.
 */
export function changeMain(assignments: ReadonlyArray<Omit<PersonRow, 'roleOnTask'> & { roleOnTask?: string }> | undefined, newId: string): { assignedTo: string; assignments?: PersonRow[] } {
  const list = (assignments ?? []).map(a => ({ resourceId: a.resourceId, allocationPct: a.allocationPct, roleOnTask: a.roleOnTask ?? '', hoursPlanned: a.hoursPlanned }));
  if (list.length === 0) return { assignedTo: newId };
  if (!newId) { const rest = list.slice(1); return { assignedTo: rest[0]?.resourceId ?? '', assignments: rest }; }
  return { assignedTo: newId, assignments: [{ ...list[0], resourceId: newId }, ...list.slice(1).filter(a => a.resourceId !== newId)] };
}

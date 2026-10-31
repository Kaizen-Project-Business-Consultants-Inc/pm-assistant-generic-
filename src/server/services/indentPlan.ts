/** Where indent_tasks puts each task (Mjuzi): the Gantt's own meaning, worked out from the plan as it stands */
interface PlanTask { id: string; name: string; parentTaskId?: string | null; isMilestone?: boolean | null; dependencies?: Array<{ dependencyId: string }> }
interface Move { id: string; parentId: string | null }
type MovePlan = { moves: Move[]; target: string } | { refuse: string; error: string };

const refuse = (text: string, error: string): MovePlan => ({ refuse: text, error });

/** indent: under the row above the FIRST named task (the Tab key) */
function planIndent(ordered: PlanTask[], all: PlanTask[], row: (id: string) => number): MovePlan {
  const above = all.find(t => row(t.id) === row(ordered[0].id) - 1);
  if (!above) return refuse('There is no row above the first task to put it under, so nothing was moved.', 'Nothing above');
  const moves = ordered.filter(t => t.parentTaskId !== above.id).map(t => ({ id: t.id, parentId: above.id }));
  return { moves, target: above.id };
}

/** outdent: each task with a heading goes to that heading's own parent (or the top) */
function planOutdent(ordered: PlanTask[], byId: Map<string, PlanTask>): MovePlan {
  const moves = ordered.filter(t => t.parentTaskId).map(t => ({ id: t.id, parentId: byId.get(t.parentTaskId!)?.parentTaskId ?? null }));
  return { moves, target: '' };
}

/** A named task whose heading (at any level) is also named moves with it: only the topmost are moved */
function withoutPickedDescendants(ordered: PlanTask[], byId: Map<string, PlanTask>, selected: Set<string>): PlanTask[] {
  const hasPickedAncestor = (t: PlanTask) => {
    const seen = new Set<string>();
    for (let cur = t.parentTaskId; cur && !seen.has(cur); cur = byId.get(cur)?.parentTaskId) {
      if (selected.has(cur)) return true;
      seen.add(cur);
    }
    return false;
  };
  return ordered.filter(t => !hasPickedAncestor(t));
}

/** Every named task goes under the named heading, which must be in the same plan and not one of them */
function planUnder(ordered: PlanTask[], byId: Map<string, PlanTask>, selected: Set<string>, underTaskId: string, label: (id: string) => string): MovePlan {
  const heading = byId.get(underTaskId);
  if (!heading) return refuse('The heading must be a task in the same schedule, so nothing was moved.', 'Parent not in this schedule');
  if (selected.has(heading.id)) return refuse(`${label(heading.id)} can't be moved under itself, so nothing was moved.`, 'Task under itself');
  return { moves: ordered.filter(t => t.parentTaskId !== heading.id).map(t => ({ id: t.id, parentId: heading.id })), target: heading.id };
}

export function planMoves(
  ids: string[], all: PlanTask[], rowOf: Map<string, number>,
  how: { direction?: string; underTaskId?: string },
): MovePlan {
  const byId = new Map(all.map(t => [t.id, t]));
  const row = (id: string) => rowOf.get(id) ?? 0;
  const label = (id: string) => `row ${row(id)} "${byId.get(id)?.name ?? id}"`;
  const selected = new Set(ids);
  const ordered = withoutPickedDescendants(ids.map(id => byId.get(id)!).sort((a, b) => row(a.id) - row(b.id)), byId, selected);

  const planned = how.underTaskId ? planUnder(ordered, byId, selected, String(how.underTaskId), label)
    : how.direction === 'indent' ? planIndent(ordered, all, row)
      : planOutdent(ordered, byId);
  if ('refuse' in planned) return planned;

  // the loop and depth checks run in the transaction that saves (ChangeHistoryService.reparentTasksWithHistory)
  return linkOrMilestoneRefusal(planned.moves, all, byId) ?? planned;
}

/** A task can't go under a milestone, nor under a heading it (or anything under it) is linked to: the schedule would link a heading to its own parts */
function linkOrMilestoneRefusal(moves: Move[], all: PlanTask[], byId: Map<string, PlanTask>): MovePlan | null {
  const childrenOf = new Map<string, string[]>();
  for (const t of all) if (t.parentTaskId) childrenOf.set(t.parentTaskId, [...(childrenOf.get(t.parentTaskId) ?? []), t.id]);
  const subtree = (id: string): string[] => [id, ...(childrenOf.get(id) ?? []).flatMap(subtree)];
  const linked = (a: string, b: string) => byId.get(a)?.dependencies?.some(d => d.dependencyId === b) || byId.get(b)?.dependencies?.some(d => d.dependencyId === a);
  const name = (id: string) => byId.get(id)?.name ?? id;
  for (const m of moves) {
    if (!m.parentId) continue;
    if (byId.get(m.parentId)?.isMilestone) return refuse(`${name(m.parentId)} is a milestone, and a milestone can't have tasks under it. Nothing was moved.`, 'Milestone parent');
    const headings: string[] = [];
    for (let cur: string | null | undefined = m.parentId; cur && !headings.includes(cur); cur = byId.get(cur)?.parentTaskId) headings.push(cur);
    for (const own of subtree(m.id)) {
      // eslint-disable-next-line no-restricted-syntax -- small: the headings above one new parent (an outline is a few levels deep)
      const heading = headings.find(h => linked(own, h));
      if (heading) return refuse(`${name(own)} is linked to ${name(heading)}; remove the link first. Nothing was moved.`, 'Linked to its new heading');
    }
  }
  return null;
}

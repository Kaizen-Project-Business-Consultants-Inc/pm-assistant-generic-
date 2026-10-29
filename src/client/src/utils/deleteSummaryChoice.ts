/** What happens to the tasks under a deleted heading: they stay (moved up a level) or go with it */
export type DeleteChildren = 'keep' | 'delete';

export interface DeleteCandidate {
  id: string;
  name: string;
  parentTaskId?: string | null;
}

interface DeleteChoice {
  /** The selected headings that have tasks under them which are not selected too */
  headings: DeleteCandidate[];
  /** Every task (any depth) under those headings that the delete would otherwise leave behind */
  below: DeleteCandidate[];
}

/**
 * Which of the tasks about to be deleted are headings with tasks under them that are NOT being
 * deleted too — the only case that needs the "heading only, or heading and its tasks?" question.
 * Returns null when there is nothing to ask (no headings, empty headings, or their tasks are all
 * selected as well).
 */
export function summariesNeedingChoice(tasks: DeleteCandidate[], ids: string[]): DeleteChoice | null {
  const selected = new Set(ids);
  const kids = new Map<string, DeleteCandidate[]>();
  for (const t of tasks) {
    if (!t.parentTaskId) continue;
    const list = kids.get(t.parentTaskId);
    if (list) list.push(t); else kids.set(t.parentTaskId, [t]);
  }
  const headings: DeleteCandidate[] = [];
  const below = new Map<string, DeleteCandidate>();
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const id of ids) {
    const heading = byId.get(id);
    if (!heading) continue;
    const found: DeleteCandidate[] = [];
    const seen = new Set<string>([id]);
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length) {
      const t = stack.pop()!;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (!selected.has(t.id)) found.push(t);
      stack.push(...(kids.get(t.id) ?? []));
    }
    if (found.length > 0) {
      headings.push(heading);
      for (const t of found) below.set(t.id, t);
    }
  }
  if (headings.length === 0) return null;
  return { headings, below: [...below.values()] };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `"a", "b", "c" and 2 more` — the names shown in the question */
function namesPreview(items: DeleteCandidate[], max = 3): string {
  const shown = items.slice(0, max).map(t => `"${t.name}"`).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

/**
 * The sentence for the Undo toast and the screen-reader announcement after deleting headings:
 * "Deleted 'test'. 1 task kept" or "Deleted 'test' and 1 task". `selected` is what was picked,
 * `below` how many tasks sat under the headings.
 */
export function deletedHeadingMessage(selected: DeleteCandidate[], below: number, children: DeleteChildren): string {
  const subject = selected.length === 1 ? `'${selected[0].name}'` : plural(selected.length, 'task');
  return children === 'delete' ? `Deleted ${subject} and ${plural(below, 'task')}` : `Deleted ${subject}. ${plural(below, 'task')} kept`;
}

export const headingTitle = (c: DeleteChoice) =>
  c.headings.length === 1 ? `Delete "${c.headings[0].name}"?` : `Delete ${c.headings.length} headings?`;

export const headingBody = (c: DeleteChoice) =>
  `${c.headings.length === 1 ? 'This heading has' : 'These headings have'} ${plural(c.below.length, 'task')} under ${c.headings.length === 1 ? 'it' : 'them'} (${namesPreview(c.below)}).`;

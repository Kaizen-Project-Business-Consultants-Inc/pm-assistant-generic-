/**
 * How much one AI tool call may hand back to the model (audit 2026-10-10 H1).
 *
 * Tool results are added to the conversation and resent on every later turn of a tool loop, so a
 * whole 5,000-task plan in one result costs about 150k tokens per turn and overflows the model's
 * context after the earlier turns were already paid for. Lists are cut to the first rows and say
 * how many there were, so the answer stays honest ("showing 200 of 5,000").
 */
import { databaseService } from '../database/connection';

export const MAX_TOOL_ROWS = 200;

interface LimitedRows<T> {
  rows: T[];
  total: number;
  /** Set only when rows were cut */
  note?: string;
}

const NARROWER = 'Ask a narrower question (one plan, a status, a person) to see others.';
/** The cut-off note for task lists: the filters reach any task, however big the plan */
export const TASK_FILTER_HINT = 'Use nameContains, status or assignedTo to find the others.';

export function limitRows<T>(rows: T[], max = MAX_TOOL_ROWS, hint = NARROWER): LimitedRows<T> {
  if (rows.length <= max) return { rows, total: rows.length };
  return {
    rows: rows.slice(0, max),
    total: rows.length,
    note: `Showing ${max} of ${rows.length}. ${hint}`,
  };
}

/** The optional filters of the task-list tools (Mjuzi's and NL query's list_tasks) */
interface TaskFilter {
  nameContains?: unknown;
  status?: unknown;
  assignedTo?: unknown;
}

/** Their JSON-schema properties, shared by both tool definitions */
export const TASK_FILTER_PROPERTIES = {
  nameContains: { type: 'string', description: 'Only tasks whose name contains this text (any case). Use it to find a task by name in a big plan.' },
  status: { type: 'string', description: 'Only tasks with this status, e.g. pending, in_progress, completed, cancelled' },
  assignedTo: { type: 'string', description: 'Only tasks assigned to this person (their name — any case, part of the name is enough — or their id)' },
} as const;

/**
 * Tasks matching the filters, applied BEFORE the row limit, so a task deep in a 5,000-task plan
 * can always be found (audit 2026-10-10 review). An empty filter keeps every task.
 * A task holds its person's id, not their name, so `assignedTo` is matched by looking up the
 * people (this company's resources) whose name contains it — one query — plus the text as an id.
 */
export async function filterTasks<T extends { name: string; status: string; assignedTo?: string | null }>(tasks: T[], filter: TaskFilter): Promise<T[]> {
  const name = typeof filter.nameContains === 'string' ? filter.nameContains.trim().toLowerCase() : '';
  const status = typeof filter.status === 'string' ? filter.status.trim().toLowerCase() : '';
  const person = typeof filter.assignedTo === 'string' ? filter.assignedTo.trim() : '';
  if (!name && !status && !person) return tasks;
  const people = person ? await peopleNamed(person) : new Set<string>();
  return tasks.filter((t) => (!name || t.name.toLowerCase().includes(name))
    && (!status || t.status.toLowerCase() === status)
    && (!person || (!!t.assignedTo && people.has(t.assignedTo))));
}

/** The ids of the people whose name contains `text` (any case), and `text` itself as an id */
async function peopleNamed(text: string): Promise<Set<string>> {
  const like = `%${text.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = await databaseService.query<{ id: string }>('SELECT id FROM resources WHERE name LIKE ?', [like]);
  return new Set([text, ...rows.map((r) => r.id)]);
}

/** "nameContains "x", status y" — for a list's summary line */
export function describeTaskFilter(filter: TaskFilter): string {
  const parts: string[] = [];
  if (typeof filter.nameContains === 'string' && filter.nameContains.trim()) parts.push(`name contains "${filter.nameContains.trim()}"`);
  if (typeof filter.status === 'string' && filter.status.trim()) parts.push(`status ${filter.status.trim()}`);
  if (typeof filter.assignedTo === 'string' && filter.assignedTo.trim()) parts.push(`assigned to "${filter.assignedTo.trim()}"`);
  return parts.join(', ');
}

/** Rows grouped by plan, cut to `max` in total, in plan order (later plans may get none) */
export function limitGrouped<T>(groups: T[][], max = MAX_TOOL_ROWS): T[][] {
  let room = max;
  return groups.map((rows) => {
    const shown = rows.slice(0, Math.max(0, room));
    room -= shown.length;
    return shown;
  });
}

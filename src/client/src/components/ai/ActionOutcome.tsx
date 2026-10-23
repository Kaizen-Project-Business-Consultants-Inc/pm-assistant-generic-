import { Link } from 'react-router-dom';
import { CheckCircle, XCircle } from 'lucide-react';
import type { ActionResult } from '../../stores/aiChatStore';

/**
 * What Mjuzi did, as a person reads it (U57, approved mock https://claude.ai/artifact/PP6uLZfCCZBPRVrWqwMXNC):
 * "Marked complete (4)" with each task's name linking to it in the schedule. Look-ups are not
 * shown, nor a change that failed and then worked on a later step; no ids or field names. A
 * change that really failed says so in one line.
 */

type Item = { id?: string; name?: string; scheduleId?: string; projectId?: string };
type Stored = ActionResult & { refs?: Item[] };

/** Tools that change something (the rest only look things up) */
const WRITE_TOOLS = new Set([
  'create_task', 'split_task', 'update_task', 'update_tasks', 'delete_task', 'reschedule_task', 'cascade_reschedule',
  'set_dependency', 'remove_dependency', 'clear_all_dependencies', 'create_project', 'update_project',
]);
/** Failures that were Mjuzi guessing (a wrong id), retried on a later step */
const GUESS = /couldn't tell which project|not found/i;
const UUID = /\(?(ID: )?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)?/gi;
/** A summary without its ids (and the gap they leave) */
const withoutIds = (s: string) => s.replace(UUID, '').replace(/ {2,}/g, ' ').replace(/ :/g, ':').trim();

/** update_task and update_tasks are one kind of change; every other tool is its own */
const familyOf = (tool: string) => (tool === 'update_tasks' ? 'update_task' : tool);

/** The items one action names: from the reply's data, or what a stored message kept */
function itemsOf(a: Stored): Item[] {
  if (a.refs?.length) return a.refs;
  const d = a.data;
  if (!d || typeof d !== 'object') return [];
  if (Array.isArray(d.updated)) return d.updated as Item[];
  if (Array.isArray(d.pieces)) return (d.pieces as Item[]).map(p => ({ id: p.id, name: p.name, scheduleId: d.scheduleId, projectId: d.projectId }));
  if (typeof d.taskId === 'string') return [{ id: d.taskId, name: d.name, scheduleId: d.scheduleId, projectId: d.projectId }];
  if (typeof d.projectId === 'string' && typeof d.name === 'string') return [{ name: d.name, projectId: d.projectId }];
  return [];
}

/** "Marked complete", "Updated", "Added"… */
function verbOf(a: Stored): string {
  const completed = /status: completed/.test(a.summary) || a.data?.status === 'completed';
  switch (a.toolName) {
    case 'update_task': case 'update_tasks': return completed ? 'Marked complete' : 'Updated';
    case 'create_task': return 'Added';
    case 'split_task': return 'Split into';
    case 'delete_task': return 'Deleted';
    case 'reschedule_task': case 'cascade_reschedule': return 'Moved';
    case 'set_dependency': return 'Linked';
    case 'remove_dependency': case 'clear_all_dependencies': return 'Links removed';
    case 'create_project': return 'Project created';
    case 'update_project': return 'Project updated';
    default: return 'Done';
  }
}

interface Outcome {
  groups: Array<{ verb: string; items: Item[]; plain: string[] }>;
  failures: string[];
}

export function summarizeActions(actions: Stored[]): Outcome {
  const writes = actions.filter(a => WRITE_TOOLS.has(a.toolName));
  const groups = new Map<string, { verb: string; items: Item[]; plain: string[] }>();
  const failures: string[] = [];
  writes.forEach((a, i) => {
    if (!a.success) {
      // a wrong guess that a later step of the same kind got right is a step, not a result (a failed
      // delete followed by a successful update is still a failed delete)
      const retried = GUESS.test(a.summary) && writes.slice(i + 1).some(b => b.success && familyOf(b.toolName) === familyOf(a.toolName));
      if (!retried) failures.push(withoutIds(a.summary));
      return;
    }
    const verb = verbOf(a);
    const g = groups.get(verb) ?? { verb, items: [], plain: [] };
    const items = itemsOf(a);
    if (items.length) {
      for (const it of items) if (!g.items.some(x => x.id && x.id === it.id)) g.items.push(it);
    } else {
      g.plain.push(withoutIds(a.summary));
    }
    groups.set(verb, g);
  });
  return { groups: [...groups.values()], failures };
}

function ItemLink({ it }: { it: Item }) {
  const label = it.name || 'A task';
  if (it.projectId && it.id) {
    const to = `/project/${it.projectId}?tab=schedule${it.scheduleId ? `&schedule=${it.scheduleId}` : ''}&task=${it.id}`;
    return <Link to={to} className="underline hover:no-underline">{label}</Link>;
  }
  return <span>{label}</span>;
}

export function ActionOutcome({ actions }: { actions: ActionResult[] }) {
  const { groups, failures } = summarizeActions(actions as Stored[]);
  if (groups.length === 0 && failures.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5 border-t border-gray-200 dark:border-gray-600 pt-2">
      {groups.map(g => (
        <div key={g.verb} className="rounded-lg px-2.5 py-1.5 text-xs bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300">
          <p className="flex items-center gap-1.5 font-semibold">
            <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            {g.verb}{g.items.length > 0 ? ` (${g.items.length})` : ''}
          </p>
          {g.items.length > 0 && (
            <ul className="mt-1 ml-5 list-disc space-y-0.5">
              {g.items.map((it, i) => <li key={it.id ?? i}><ItemLink it={it} /></li>)}
            </ul>
          )}
          {g.plain.map((p, i) => <p key={i} className="mt-0.5 ml-5">{p}</p>)}
        </div>
      ))}
      {failures.map((f, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>Not changed: {f}</span>
        </div>
      ))}
    </div>
  );
}

import { scheduleService, type Task } from '../ScheduleService';
import { changeHistoryService, type PreviousValues, type LinksBefore } from '../ChangeHistoryService';
import type { AIActionExecutor, ActionResult } from '../aiActionExecutor';
import { computeScheduleRowNumbers } from '../../utils/scheduleRowNumbers';
import { toDateString } from '../../utils/calendarDate';
import { HELP_TEXT, STATUS_LABEL, type ChatCommand } from './parseChatCommand';

/**
 * Does one typed command (parseChatCommand) through the same tools Mjuzi uses — so the same policy,
 * project rights and audit apply — and records what it changed in Schedule History, so the reply's
 * Undo link is the History undo ("latest change only").
 *
 * The reply carries one `typed_command` result: its `data` is what the chat shows (the "done by the app"
 * label, the Confirm button of a delete, the Undo link). The tool results come first, so the chat
 * refreshes the plan the way it does after any change Mjuzi makes.
 */

export interface CommandContext {
  userId: string;
  userRole: string;
  /** The project the chat is open on */
  projectId?: string;
  /** The plan open on screen (row numbers belong to one plan) */
  scheduleId?: string;
}

export interface TypedReplyData {
  typed: true;
  /** A delete waiting for Confirm */
  pending?: { taskId: string };
  /** Schedule History entry that undoes this command */
  undo?: { scheduleId: string; changeId: string; projectId: string };
}

export interface CommandReply {
  reply: string;
  actions: ActionResult[];
}

const answer = (reply: string, data: Partial<TypedReplyData> = {}, tools: ActionResult[] = [], success = true): CommandReply => ({
  reply,
  actions: [...tools, { success, toolName: 'typed_command', summary: reply, data: { typed: true, ...data } }],
});
const nothing = (reply: string, tools: ActionResult[] = []): CommandReply => answer(reply, {}, tools, false);

const dayOf = (v: unknown): string | null => toDateString(v);

/** "14 Oct" from a calendar day */
function shortDay(v: unknown): string {
  const day = dayOf(v);
  if (!day) return '—';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const label = (row: number, t: Pick<Task, 'name'>) => `task ${row}, **${t.name}**`;

interface Plan {
  scheduleId: string;
  projectId: string;
  tasks: Task[];
  rowOf: Map<string, number>;
  byRow: Map<number, Task>;
}

async function loadPlan(scheduleId: string, projectId: string): Promise<Plan> {
  const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
  const rowOf = computeScheduleRowNumbers(tasks);
  const byRow = new Map<number, Task>();
  for (const t of tasks) {
    const row = rowOf.get(t.id);
    if (row != null) byRow.set(row, t);
  }
  return { scheduleId, projectId, tasks, rowOf, byRow };
}

/** The plan the row numbers belong to: the one open on screen, else the project's only plan */
async function planFor(ctx: CommandContext): Promise<{ plan: Plan } | { refusal: string }> {
  if (!ctx.projectId) return { refusal: "Open a project's plan first, then type the command. Row numbers belong to one plan." };
  let scheduleId: string | undefined;
  if (ctx.scheduleId) {
    const s = await scheduleService.findById(ctx.scheduleId);
    if (s && s.projectId === ctx.projectId) scheduleId = s.id;
  }
  if (!scheduleId) {
    const list = await scheduleService.findByProjectId(ctx.projectId);
    if (list.length === 0) return { refusal: 'This project has no plan yet, so there are no rows to number.' };
    if (list.length > 1) return { refusal: 'This project has more than one plan. Open the plan you mean (Schedule tab), then type the command.' };
    scheduleId = list[0].id;
  }
  return { plan: await loadPlan(scheduleId, ctx.projectId) };
}

/** A delete's Confirm names the task by id: its plan is where it lives, and that plan must be this project's */
async function planOfTask(taskId: string, ctx: CommandContext): Promise<{ plan: Plan } | { refusal: string }> {
  if (!ctx.projectId) return { refusal: "Open the project's plan first." };
  const task = await scheduleService.findTaskById(taskId);
  if (!task) return { refusal: 'That task is already gone.' };
  const s = await scheduleService.findById(task.scheduleId);
  if (!s || s.projectId !== ctx.projectId) return { refusal: "That task isn't in this project." };
  return { plan: await loadPlan(s.id, s.projectId) };
}

/** The task on a row, or the sentence that says why not */
function taskAt(plan: Plan, row: number): { task: Task } | { refusal: string } {
  const task = plan.byRow.get(row);
  if (task) return { task };
  const last = plan.byRow.size;
  return { refusal: last === 0 ? `There is no task ${row}. This plan has no tasks yet.` : `There is no task ${row}. This plan has tasks 1 to ${last}.` };
}

/** Every task under this one (a phase's tasks go with it) */
function descendantCount(plan: Plan, id: string): number {
  const kidsOf = new Map<string, string[]>();
  for (const t of plan.tasks) {
    if (t.parentTaskId) kidsOf.set(t.parentTaskId, [...(kidsOf.get(t.parentTaskId) ?? []), t.id]);
  }
  const count = (of: string): number => (kidsOf.get(of) ?? []).reduce((n, kid) => n + 1 + count(kid), 0);
  return count(id);
}

/** Tasks, other than `skipId`, whose dates differ between two readings of the plan: their OLD dates, for Undo */
function datesMoved(before: Task[], after: Task[], skipId?: string): Array<{ taskId: string; startDate: string | null; endDate: string | null }> {
  const now = new Map(after.map(t => [t.id, t]));
  const moved: Array<{ taskId: string; startDate: string | null; endDate: string | null }> = [];
  for (const old of before) {
    const cur = now.get(old.id);
    if (!cur || old.id === skipId) continue;
    if (dayOf(old.startDate) !== dayOf(cur.startDate) || dayOf(old.endDate) !== dayOf(cur.endDate)) {
      moved.push({ taskId: old.id, startDate: dayOf(old.startDate), endDate: dayOf(old.endDate) });
    }
  }
  return moved;
}

const linksOf = (t: Task) => t.dependencies.map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays ?? 0 }));

/** The sentence for a refused tool call */
function whyRefused(r: ActionResult): string {
  if (r.error === 'Not allowed' && /Manager or Owner/.test(r.summary)) return 'Only the PM can change this.';
  return r.summary;
}

/** The Undo the reply offers: the History entry the command wrote */
const undoOf = (plan: Plan, changeId: string | null): Partial<TypedReplyData> =>
  (changeId ? { undo: { scheduleId: plan.scheduleId, changeId, projectId: plan.projectId } } : {});

type Mutating = Exclude<ChatCommand, { kind: 'help' } | { kind: 'invalid' }>;
type Handler<K extends Mutating['kind']> = (cmd: Extract<Mutating, { kind: K }>, plan: Plan, ctx: CommandContext, executor: AIActionExecutor) => Promise<CommandReply>;

export async function runChatCommand(cmd: ChatCommand, ctx: CommandContext, executor: AIActionExecutor): Promise<CommandReply> {
  if (cmd.kind === 'help') return answer(HELP_TEXT);
  if (cmd.kind === 'invalid') return nothing(cmd.message);

  const found = cmd.kind === 'confirm_delete' ? await planOfTask(cmd.taskId, ctx) : await planFor(ctx);
  if ('refusal' in found) return nothing(found.refusal);
  const { plan } = found;
  switch (cmd.kind) {
    case 'delete': return askDelete(cmd, plan);
    case 'confirm_delete': return confirmDelete(cmd, plan, ctx, executor);
    case 'rename': return renameTask(cmd, plan, ctx, executor);
    case 'status':
    case 'priority':
    case 'progress': return setField(cmd, plan, ctx, executor);
    case 'start':
    case 'end': return setDate(cmd, plan, ctx, executor);
    case 'link':
    case 'unlink': return changeLink(cmd, plan, ctx, executor);
    case 'add': return addTask(cmd, plan, ctx, executor);
  }
}

function askDelete(cmd: { row: number }, plan: Plan): CommandReply {
  const at = taskAt(plan, cmd.row);
  if ('refusal' in at) return nothing(at.refusal);
  const inside = descendantCount(plan, at.task.id);
  const links = at.task.dependencies.length + plan.tasks.filter(t => t.dependencies.some(d => d.dependencyId === at.task.id)).length;
  const tail = [
    inside > 0 ? `the ${inside} task${inside === 1 ? '' : 's'} inside it` : '',
    links > 0 ? `its ${links} link${links === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' and ');
  return answer(`Delete ${label(cmd.row, at.task)}?${tail ? ` ${tail.charAt(0).toUpperCase()}${tail.slice(1)} will go too.` : ''}`, { pending: { taskId: at.task.id } });
}

const confirmDelete: Handler<'confirm_delete'> = async (cmd, plan, ctx, executor) => {
  const task = plan.tasks.find(t => t.id === cmd.taskId);
  if (!task) return nothing('That task is already gone.');
  const r = await executor.execute('delete_task', { taskId: task.id }, { userId: ctx.userId, userRole: ctx.userRole });
  if (!r.success) return nothing(whyRefused(r), [r]);
  const changeId = typeof r.data?.changeId === 'string' ? r.data.changeId : null;
  return answer(`Deleted ${label(plan.rowOf.get(task.id) ?? 0, task)}.`, undoOf(plan, changeId), [r]);
};

const renameTask: Handler<'rename'> = async (cmd, plan, ctx, executor) => {
  const at = taskAt(plan, cmd.row);
  if ('refusal' in at) return nothing(at.refusal);
  if (at.task.name === cmd.name) return nothing(`Task ${cmd.row} is already called **${cmd.name}**. Nothing changed.`);
  return edit(plan, ctx, executor, at.task, 'update_task', { taskId: at.task.id, name: cmd.name }, ['name'],
    `Mjuzi: renamed "${at.task.name}" to "${cmd.name}"`, `Renamed.\n${at.task.name} → ${cmd.name}`);
};

/** What one status / priority / progress command changes: the tool's field, History's column, the words */
function fieldChange(cmd: Extract<Mutating, { kind: 'status' | 'priority' | 'progress' }>, t: Task) {
  if (cmd.kind === 'status') {
    const what = STATUS_LABEL[cmd.status];
    return { same: t.status === cmd.status, field: { status: cmd.status }, column: 'status', sameText: `is already ${what}`, history: `set "${t.name}" to ${what}`, done: `is now ${what}` };
  }
  if (cmd.kind === 'priority') {
    return { same: t.priority === cmd.priority, field: { priority: cmd.priority }, column: 'priority', sameText: `already has ${cmd.priority} priority`, history: `set "${t.name}" to ${cmd.priority} priority`, done: `now has ${cmd.priority} priority` };
  }
  return { same: Number(t.progressPercentage ?? 0) === cmd.percent, field: { progressPercentage: cmd.percent }, column: 'progress_percentage', sameText: `is already at ${cmd.percent}%`, history: `set "${t.name}" to ${cmd.percent}% done`, done: `is now ${cmd.percent}% done` };
}

const setField: Handler<'status' | 'priority' | 'progress'> = async (cmd, plan, ctx, executor) => {
  const at = taskAt(plan, cmd.row);
  if ('refusal' in at) return nothing(at.refusal);
  const t = at.task;
  if (cmd.kind !== 'priority' && t.isSummary) return nothing(`Task ${cmd.row} is a phase: its status and progress follow the tasks inside it.`);
  const c = fieldChange(cmd, t);
  if (c.same) return nothing(`Task ${cmd.row} ${c.sameText}. Nothing changed.`);
  const opts: EditOptions = cmd.kind === 'progress'
    ? { keptAs: fresh => Number(fresh.progressPercentage ?? 0) === cmd.percent, notKept: `Not changed. Task ${cmd.row}'s progress comes from its approved hours, so it can't be typed.` }
    : {};
  return edit(plan, ctx, executor, t, 'update_task', { taskId: t.id, ...c.field }, [c.column], `Mjuzi: ${c.history}`, `Done. ${label(cmd.row, t)} ${c.done}.`, opts);
};

const setDate: Handler<'start' | 'end'> = async (cmd, plan, ctx, executor) => {
  const at = taskAt(plan, cmd.row);
  if ('refusal' in at) return nothing(at.refusal);
  const t = at.task;
  if (t.isSummary) return nothing(`Task ${cmd.row} is a phase: its dates follow the tasks inside it.`);
  const isStart = cmd.kind === 'start';
  const start = isStart ? cmd.date : dayOf(t.startDate);
  const end = isStart ? dayOf(t.endDate) : cmd.date;
  if (start && end && end < start) return nothing(`Not changed: that would finish task ${cmd.row} (${shortDay(end)}) before it starts (${shortDay(start)}).`);
  if (dayOf(isStart ? t.startDate : t.endDate) === cmd.date) return nothing(`Task ${cmd.row} already ${isStart ? 'starts' : 'ends'} on ${shortDay(cmd.date)}. Nothing changed.`);
  return edit(plan, ctx, executor, t, 'reschedule_task', { taskId: t.id, [isStart ? 'startDate' : 'endDate']: cmd.date }, ['start_date', 'end_date'],
    `Mjuzi: moved "${t.name}" ${isStart ? 'start' : 'end'} to ${shortDay(cmd.date)}`, `Done. ${label(cmd.row, t)} now ${isStart ? 'starts' : 'ends'} on ${shortDay(cmd.date)}.`);
};

const changeLink: Handler<'link' | 'unlink'> = async (cmd, plan, ctx, executor) => {
  const a = taskAt(plan, cmd.from);
  if ('refusal' in a) return nothing(a.refusal);
  const b = taskAt(plan, cmd.to);
  if ('refusal' in b) return nothing(b.refusal);
  const linked = b.task.dependencies.some(d => d.dependencyId === a.task.id);
  if (cmd.kind === 'link' && linked) return nothing(`Task ${cmd.from} and task ${cmd.to} are already linked. Nothing changed.`);
  if (cmd.kind === 'unlink' && !linked) return nothing(`Task ${cmd.from} and task ${cmd.to} are not linked that way. Nothing changed.`);
  return linkChange(plan, ctx, executor, cmd.kind, a.task, b.task, cmd.from, cmd.to);
};

const addTask: Handler<'add'> = async (cmd, plan, ctx, executor) => {
  const r = await executor.execute('create_task', { scheduleId: plan.scheduleId, name: cmd.name, ...(cmd.days ? { estimatedDays: cmd.days } : {}) }, { userId: ctx.userId, userRole: ctx.userRole });
  if (!r.success) return nothing(whyRefused(r), [r]);
  const createdId = String(r.data?.taskId ?? '');
  const changeId = await changeHistoryService.record({
    projectId: plan.projectId, scheduleId: plan.scheduleId, kind: 'bulk_create', summary: `Mjuzi: added "${cmd.name}"`,
    taskIds: [createdId], undo: { createdIds: [createdId] },
  });
  const newRow = (await loadPlan(plan.scheduleId, plan.projectId)).rowOf.get(createdId);
  return answer(`Added ${newRow ? `task ${newRow}, ` : ''}**${cmd.name}**${cmd.days ? `, ${cmd.days} day${cmd.days === 1 ? '' : 's'}` : ''}.`, undoOf(plan, changeId), [r]);
};

/** What `edit` needs to check or say about one change */
interface EditOptions {
  /** The task as it must read after the change: a tool can accept a value and quietly not keep it (progress from approved hours) */
  keptAs?: (t: Task) => boolean;
  notKept?: string;
}

/**
 * One tool call that edits a task, then its History entry (the task's old values). A date change can push
 * later tasks: the tool records that itself (one entry, whose Undo puts back this task's dates and theirs),
 * so that entry is the one Undo uses; only a change that moved nothing gets an entry from here.
 */
async function edit(
  plan: Plan, ctx: CommandContext, executor: AIActionExecutor, task: Task,
  tool: 'update_task' | 'reschedule_task', input: Record<string, unknown>, columns: string[], historySummary: string, doneText: string,
  opts: EditOptions = {},
): Promise<CommandReply> {
  const previous = await changeHistoryService.readPrevious([task.id], columns).catch(() => [] as PreviousValues[]);
  const r = await executor.execute(tool, input, { userId: ctx.userId, userRole: ctx.userRole });
  if (!r.success) return nothing(`Not changed. ${whyRefused(r)}`, [r]);
  if (opts.keptAs) {
    const fresh = await scheduleService.findTaskById(task.id);
    if (!fresh || !opts.keptAs(fresh)) return nothing(opts.notKept ?? 'Not changed.', [r]);
  }
  const isDate = tool === 'reschedule_task';
  const toolEntry = isDate && typeof r.data?.changeId === 'string' ? r.data.changeId : null;
  const pushed = isDate && Array.isArray(r.data?.affectedTasks) ? r.data.affectedTasks.length : 0;
  const follow = pushed ? ` ${pushed} later task${pushed === 1 ? '' : 's'} moved to follow.` : '';
  if (toolEntry) return answer(`${doneText}${follow}`, undoOf(plan, toolEntry), [r]);
  // only a date change can move other rows (a phase above rolls up): look again, so Undo puts them back
  const moved = isDate ? datesMoved(plan.tasks, (await loadPlan(plan.scheduleId, plan.projectId)).tasks, task.id) : [];
  const changeId = await changeHistoryService.record({
    projectId: plan.projectId, scheduleId: plan.scheduleId, kind: 'bulk_update', summary: historySummary,
    taskIds: [task.id, ...moved.map(m => m.taskId)], undo: { previous, moved },
  });
  return answer(`${doneText}${follow}`, undoOf(plan, changeId), [r]);
}

/** link / unlink: "a" must finish before "b" starts */
async function linkChange(plan: Plan, ctx: CommandContext, executor: AIActionExecutor, kind: 'link' | 'unlink', a: Task, b: Task, rowA: number, rowB: number): Promise<CommandReply> {
  const linksBefore: LinksBefore = [{ taskId: b.id, deps: linksOf(b) }];
  const r = await executor.execute(
    kind === 'link' ? 'set_dependency' : 'remove_dependency',
    { taskId: b.id, predecessorId: a.id },
    { userId: ctx.userId, userRole: ctx.userRole },
  );
  if (!r.success) return nothing(`Not ${kind === 'link' ? 'linked' : 'unlinked'}. ${whyRefused(r)}`, [r]);
  const after = await loadPlan(plan.scheduleId, plan.projectId);
  const moved = datesMoved(plan.tasks, after.tasks);
  const changeId = await changeHistoryService.record({
    projectId: plan.projectId, scheduleId: plan.scheduleId, kind: 'bulk_update',
    summary: kind === 'link' ? `Mjuzi: linked "${a.name}" before "${b.name}"` : `Mjuzi: unlinked "${a.name}" from "${b.name}"`,
    taskIds: [b.id, ...moved.map(m => m.taskId)], undo: { previous: [], links: linksBefore, moved },
  });
  const newB = after.tasks.find(t => t.id === b.id);
  const bMoved = newB && dayOf(newB.startDate) !== dayOf(b.startDate)
    ? ` ${b.name} moves from ${shortDay(b.startDate)} to ${shortDay(newB.startDate)}.` : '';
  const phase = new Set(after.tasks.filter(t => t.isSummary).map(t => t.id)); // a phase above only rolls up
  const others = moved.filter(m => m.taskId !== b.id && !phase.has(m.taskId)).length;
  const follow = others ? ` ${others} later task${others === 1 ? '' : 's'} moved to follow.` : '';
  const text = kind === 'link'
    ? `Linked. **${a.name}** (${rowA}) must finish before **${b.name}** (${rowB}) starts.${bMoved}${follow}`
    : `Unlinked. **${b.name}** (${rowB}) no longer waits for **${a.name}** (${rowA}).`;
  return answer(text, undoOf(plan, changeId), [r]);
}

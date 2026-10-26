/**
 * Mjuzi typed commands (A1b, mock https://claude.ai/artifact/JgYEZXrak1e6ceSaFFEwq3, approved 2026-10-25):
 * a message that is exactly one of these is done by the app straight away — no Claude call, no credit.
 * Anything else goes to Claude as before. Tasks are named by their row number in the open plan.
 *
 * "link 5 to 7" means task 5 must finish before task 7 starts (5 is the predecessor of 7).
 */

export type ChatCommand =
  | { kind: 'help' }
  | { kind: 'delete'; row: number }
  /** the Confirm button on a delete: carries the task's id, so a row that moved can't be deleted by mistake */
  | { kind: 'confirm_delete'; taskId: string }
  | { kind: 'rename'; row: number; name: string }
  | { kind: 'link'; from: number; to: number }
  | { kind: 'unlink'; from: number; to: number }
  | { kind: 'status'; row: number; status: TaskStatus }
  | { kind: 'priority'; row: number; priority: TaskPriority }
  | { kind: 'progress'; row: number; percent: number }
  | { kind: 'start' | 'end'; row: number; date: string }
  | { kind: 'add'; name: string; days?: number }
  /** the words are a command but a value in them is wrong: the app says what is allowed, still free */
  | { kind: 'invalid'; message: string };

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

const STATUS_WORDS: Record<string, TaskStatus> = {
  'not started': 'pending', pending: 'pending',
  'in progress': 'in_progress',
  completed: 'completed', complete: 'completed', done: 'completed',
  cancelled: 'cancelled', canceled: 'cancelled',
  blocked: 'blocked',
};
export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'not started', in_progress: 'in progress', completed: 'completed', cancelled: 'cancelled', blocked: 'blocked',
};
const PRIORITY_WORDS: Record<string, TaskPriority> = { low: 'low', medium: 'medium', high: 'high', urgent: 'urgent', critical: 'urgent' };

/** Most days an added task may have (a typo like 30000 should not make a 80-year task) */
const MAX_ADD_DAYS = 1000;
const MAX_NAME_LENGTH = 255;

const Q = '["“”\']'; // straight or curly quotes (a phone keyboard types curly ones)
const ROW = '(?:task )?(\\d{1,6})';

/** A value of more than one word, or with a question mark ("end date?", "update please"), is for Claude, not a mistyped value */
const looksLikeQuestion = (value: string) => value.includes('?') || value.trim().split(' ').length > 1;

const rules: Array<[RegExp, (m: RegExpMatchArray) => ChatCommand | null]> = [
  [/^(?:help|\?)$/i, () => ({ kind: 'help' })],
  [/^delete task (\d{1,6})$/i, m => ({ kind: 'delete', row: Number(m[1]) })],
  [/^confirm delete ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, m => ({ kind: 'confirm_delete', taskId: m[1].toLowerCase() })],
  [new RegExp(`^rename ${ROW} to ${Q}(.+)${Q}$`, 'i'), m => {
    const name = m[2].trim();
    if (!name) return { kind: 'invalid', message: 'The new name is empty. Type it between quotes, like: rename 5 to "Design".' };
    if (name.length > MAX_NAME_LENGTH) return { kind: 'invalid', message: `That name is too long (${name.length} characters, at most ${MAX_NAME_LENGTH}).` };
    return { kind: 'rename', row: Number(m[1]), name };
  }],
  [new RegExp(`^link ${ROW} to ${ROW}$`, 'i'), m => ({ kind: 'link', from: Number(m[1]), to: Number(m[2]) })],
  [new RegExp(`^unlink ${ROW} from ${ROW}$`, 'i'), m => ({ kind: 'unlink', from: Number(m[1]), to: Number(m[2]) })],
  [/^task (\d{1,6}) status (.+)$/i, m => {
    const status = STATUS_WORDS[m[2].trim().toLowerCase()];
    if (!status && looksLikeQuestion(m[2])) return null;
    return status
      ? { kind: 'status', row: Number(m[1]), status }
      : { kind: 'invalid', message: `"${m[2].trim().slice(0, 40)}" is not a status. Use: not started, in progress, completed, cancelled or blocked.` };
  }],
  [/^task (\d{1,6}) priority (.+)$/i, m => {
    const priority = PRIORITY_WORDS[m[2].trim().toLowerCase()];
    if (!priority && looksLikeQuestion(m[2])) return null;
    return priority
      ? { kind: 'priority', row: Number(m[1]), priority }
      : { kind: 'invalid', message: `"${m[2].trim().slice(0, 40)}" is not a priority. Use: low, medium, high or urgent.` };
  }],
  [/^task (\d{1,6}) progress (\d{1,4})\s*%?$/i, m => {
    const percent = Number(m[2]);
    return percent <= 100
      ? { kind: 'progress', row: Number(m[1]), percent }
      : { kind: 'invalid', message: 'Progress is a number from 0 to 100.' };
  }],
  [/^task (\d{1,6}) (start|end) (\S+)$/i, m => {
    const date = m[3];
    if (!isRealDate(date) && !/^\d/.test(date)) return null; // words ("tomorrow", "date?") are for Claude; only a mistyped number gets the format hint
    return isRealDate(date)
      ? { kind: m[2].toLowerCase() as 'start' | 'end', row: Number(m[1]), date }
      : { kind: 'invalid', message: `"${date.slice(0, 20)}" is not a date. Type it as year-month-day, like 2026-11-03.` };
  }],
  [new RegExp(`^add task ${Q}(.+)${Q}(?: (\\d{1,6}) days?)?$`, 'i'), m => {
    const name = m[1].trim();
    const days = m[2] === undefined ? undefined : Number(m[2]);
    if (!name) return { kind: 'invalid', message: 'The task name is empty. Type it between quotes, like: add task "Training" 3 days.' };
    if (name.length > MAX_NAME_LENGTH) return { kind: 'invalid', message: `That name is too long (${name.length} characters, at most ${MAX_NAME_LENGTH}).` };
    if (days !== undefined && (days < 1 || days > MAX_ADD_DAYS)) return { kind: 'invalid', message: `Days must be from 1 to ${MAX_ADD_DAYS}.` };
    return { kind: 'add', name, days };
  }],
];

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The command a message is, or null when it is anything else (then it goes to Claude) */
export function parseChatCommand(message: string): ChatCommand | null {
  const text = message.trim().replace(/\s+/g, ' ');
  if (text.length === 0 || text.length > 400) return null;
  for (const [re, make] of rules) {
    const m = re.exec(text);
    const command = m ? make(m) : null;
    if (command) return command;
  }
  return null;
}

export const HELP_TEXT = [
  'Commands you can type (the app does them at once, no AI credit). Numbers are the row numbers in the plan on screen:',
  '• delete task 5',
  '• rename 5 to "Design"',
  '• link 5 to 7  (5 must finish before 7 starts)',
  '• unlink 5 from 7',
  '• task 5 status in progress  (not started, in progress, completed, cancelled, blocked)',
  '• task 5 priority high  (low, medium, high, urgent)',
  '• task 5 progress 60',
  '• task 5 start 2026-11-03   or   task 5 end 2026-11-14',
  '• add task "Training" 3 days',
  'Anything else you type goes to Claude, as before.',
].join('\n');

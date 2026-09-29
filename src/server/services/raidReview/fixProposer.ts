/**
 * RAID Review fix proposer — turns findings into fixes the PM can tick and apply.
 * Pure (the working-day test and today are passed in). Fix ids are deterministic
 * (`${kind}:${itemId}`), so the same log gives the same list.
 */
import { type IsWorking, shiftWorking, utcDay, ymdOf } from '../../utils/workingDays';
import { toDateString } from '../../utils/calendarDate';
import type { RaidFinding, RaidReviewItem } from './rules';

export type RaidFixKind = 'change_type' | 'set_owner' | 'set_due_date' | 'set_response_strategy';

export interface RaidFix {
  id: string;
  kind: RaidFixKind;
  itemId: string;
  recordId: string | null;
  itemTitle: string;
  text: string;
  reason: string;
  confidence: number;
  defaultChecked: boolean;
  toType?: string;
  input?: { type: 'person' | 'date' | 'strategy'; suggested?: string };
}

export interface ProposeInput {
  findings: RaidFinding[];
  items: RaidReviewItem[];
  today: string;
  isWorking: IsWorking;
}

/** Normalise a record id so "A-39" matches "A-039" */
export function normaliseRecordId(id: string | null | undefined): string | null {
  const m = String(id || '').trim().match(/^([A-Za-z]{1,3})-0*(\d+)$/);
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}

/**
 * Another item's due date this action waits on, read from the import's
 * "From the register" block ("Due date in the register: Post Action A-39").
 */
export function referencedDueDate(item: RaidReviewItem, items: RaidReviewItem[]): string | null {
  const desc = String(item.description || '');
  const at = desc.indexOf('From the register:');
  if (at < 0) return null;
  const own = normaliseRecordId(item.recordId);
  const byRecord = new Map<string, RaidReviewItem>();
  for (const i of items) {
    const key = normaliseRecordId(i.recordId);
    if (key) byRecord.set(key, i);
  }
  const lines = desc.slice(at).split('\n').slice(1);
  for (const line of lines) {
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const label = line.slice(0, sep).trim().toLowerCase();
    if (label === 'register id') continue;
    const value = line.slice(sep + 1);
    for (const m of value.matchAll(/\b([A-Za-z]{1,3}-\d+)\b/g)) {
      const key = normaliseRecordId(m[1]);
      if (!key || key === own) continue;
      const due = toDateString(byRecord.get(key)?.dueDate);
      if (due) return due;
    }
  }
  return null;
}

/** The suggested due date for an action: 5 working days after what it waits on, else 10 from today */
export function suggestDueDate(item: RaidReviewItem, items: RaidReviewItem[], today: string, isWorking: IsWorking): string {
  const after = referencedDueDate(item, items);
  if (after) return ymdOf(shiftWorking(utcDay(after), 5, isWorking));
  return ymdOf(shiftWorking(utcDay(today), 10, isWorking));
}

const TYPE_LABEL: Record<string, string> = {
  risk: 'Risks', issue: 'Issues', action: 'Actions', decision: 'Decisions', assumption: 'Assumptions', dependency: 'Dependencies',
};

export function proposeFixes(input: ProposeInput): RaidFix[] {
  const byId = new Map(input.items.map(i => [i.id, i]));
  const itemsOf = (ruleId: string) => (input.findings.find(f => f.ruleId === ruleId)?.items || [])
    .map(fi => byId.get(fi.id))
    .filter((i): i is RaidReviewItem => !!i);
  const label = (i: RaidReviewItem) => i.recordId || 'this item';
  const fixes: RaidFix[] = [];
  const seen = new Set<string>();
  const add = (fix: RaidFix) => {
    if (seen.has(fix.id)) return;
    seen.add(fix.id);
    fixes.push(fix);
  };
  const base = (kind: RaidFixKind, i: RaidReviewItem) => ({
    id: `${kind}:${i.id}`, kind, itemId: i.id, recordId: i.recordId ?? null, itemTitle: i.title,
  });

  // RR06 — filed as the wrong type
  for (const i of itemsOf('RR06')) {
    add({
      ...base('change_type', i),
      text: `Move ${label(i)} "${i.title}" to ${TYPE_LABEL.action}`,
      reason: i.type === 'risk'
        ? 'It reads as a task someone has to do, not an uncertain event.'
        : 'It reads as an action to take, not a problem that has happened.',
      confidence: 0.8,
      defaultChecked: true,
      toType: 'action',
    });
  }

  // RR01 — high risk with no response strategy
  for (const i of itemsOf('RR01')) {
    const suggested = i.mitigationPlan && String(i.mitigationPlan).trim() ? 'mitigate' : undefined;
    add({
      ...base('set_response_strategy', i),
      text: `Choose a response strategy for ${label(i)} "${i.title}"`,
      reason: suggested
        ? 'It already has a mitigation plan, so "mitigate" is the likely choice.'
        : 'A high risk needs a chosen response: avoid, mitigate, transfer, accept or escalate.',
      confidence: suggested ? 0.7 : 0.5,
      defaultChecked: false,
      input: suggested ? { type: 'strategy', suggested } : { type: 'strategy' },
    });
  }

  // RR03 / RR05 — no owner, or a team/several people
  const groupOwned = new Set(itemsOf('RR05').map(i => i.id));
  for (const i of [...itemsOf('RR03'), ...itemsOf('RR05')]) {
    add({
      ...base('set_owner', i),
      text: `Name one owner for ${label(i)} "${i.title}"`,
      reason: groupOwned.has(i.id)
        ? `"${i.ownerName}" is a team or several people; one named person should be accountable.`
        : 'Nobody is accountable for it.',
      confidence: 0.5,
      defaultChecked: false,
      input: { type: 'person' },
    });
  }

  // RR02 / RR04 — actions with no due date, or overdue and stale
  for (const i of [...itemsOf('RR02'), ...itemsOf('RR04')]) {
    if (i.type !== 'action') continue;
    const overdue = !!toDateString(i.dueDate);
    const suggested = suggestDueDate(i, input.items, input.today, input.isWorking);
    add({
      ...base('set_due_date', i),
      text: overdue ? `Set a new due date for ${label(i)} "${i.title}"` : `Set a due date for ${label(i)} "${i.title}"`,
      reason: overdue
        ? 'It is overdue and has not been updated for over two weeks.'
        : referencedDueDate(i, input.items)
          ? 'The register says it follows another action; suggested 5 working days after that one is due.'
          : 'An action needs a due date to be chased; suggested 10 working days from today.',
      confidence: 0.5,
      defaultChecked: false,
      input: { type: 'date', suggested },
    });
  }

  return fixes;
}

/**
 * RAID Review rules — a deterministic quality check of a project's RAID log (risks,
 * issues, actions, assumptions, decisions, dependencies). Pure: no database, no AI,
 * no clock (today is passed in), so the same log always gets the same score.
 *
 * Score: start at 100; each finding that affects the score takes off
 *   weight(high 12, medium 6, low 2) × (0.4 + 0.6 × affected / applicable)
 * rounded, floored at 0. "Applicable" is how many items the rule looked at, so one
 * unowned item in a log of 200 costs less than half the log being unowned.
 */
import { daysBetween, toDateString } from '../../utils/calendarDate';

export const RULES_VERSION = '1.0';

export type RaidFindingSeverity = 'high' | 'medium' | 'low' | 'info';

export interface RaidFindingItem {
  id: string;
  recordId: string | null;
  title: string;
}

export interface RaidFinding {
  ruleId: string;
  severity: RaidFindingSeverity;
  title: string;
  standard: string;
  items: RaidFindingItem[];
  affectsScore: boolean;
}

/** The fields of a RAID item the rules read (a ProjectRisk satisfies it) */
export interface RaidReviewItem {
  id: string;
  type: string;
  title: string;
  status: string;
  recordId?: string | null;
  description?: string | null;
  severity?: string | null;
  ownerId?: string | null;
  ownerResourceId?: string | null;
  ownerName?: string | null;
  dueDate?: unknown;
  updatedAt?: unknown;
  resolvedAt?: unknown;
  responseStrategy?: string | null;
  mitigationPlan?: string | null;
  responsePlan?: string | null;
  workaround?: string | null;
  rootCause?: string | null;
  decisionDate?: unknown;
  rationale?: string | null;
  decidedBy?: string | null;
  validationPlan?: string | null;
  closureReason?: string | null;
}

export interface RaidReviewInput {
  items: RaidReviewItem[];
  /** 'YYYY-MM-DD' — the project's status date, else today in the organisation's zone */
  today: string;
  disabledRules: string[];
}

export interface RaidReviewResult {
  score: number;
  rulesVersion: string;
  itemsChecked: number;
  findings: RaidFinding[];
}

export interface RaidRuleDef {
  ruleId: string;
  severity: RaidFindingSeverity;
  title: string;
  standard: string;
  affectsScore: boolean;
}

/** Statuses that mean the item is finished with */
export const CLOSED_STATUSES = new Set([
  'closed', 'cancelled', 'completed', 'complete', 'resolved', 'decided', 'validated', 'mitigated', 'reversed',
]);

export function isOpen(item: Pick<RaidReviewItem, 'status'>): boolean {
  return !CLOSED_STATUSES.has(String(item.status || '').toLowerCase());
}

export const RULES: RaidRuleDef[] = [
  { ruleId: 'RR01', severity: 'high', affectsScore: true, title: 'Open high risks with no response strategy', standard: 'Every significant risk needs a chosen response: avoid, mitigate, transfer or accept (PMI).' },
  { ruleId: 'RR02', severity: 'high', affectsScore: true, title: 'Open actions with no due date', standard: 'An action without a due date cannot be chased or reported as late.' },
  { ruleId: 'RR03', severity: 'high', affectsScore: true, title: 'Open items with no owner', standard: 'Every open RAID item needs one named owner who is accountable for it (PMI).' },
  { ruleId: 'RR04', severity: 'medium', affectsScore: true, title: 'Overdue items not updated for over two weeks', standard: 'An overdue item should be updated, re-planned or closed — not left to go stale.' },
  { ruleId: 'RR05', severity: 'medium', affectsScore: true, title: 'Owned by a team or several people', standard: 'Ownership works when one named person is accountable, not a team, company or group.' },
  { ruleId: 'RR06', severity: 'medium', affectsScore: true, title: 'Items that look like the wrong type', standard: 'A risk is an uncertain event, an issue is a problem that has happened, and an action is a task to do.' },
  { ruleId: 'RR07', severity: 'medium', affectsScore: true, title: 'Open issues with no response', standard: 'Each open issue needs a response plan, a workaround or at least a root cause.' },
  { ruleId: 'RR08', severity: 'medium', affectsScore: true, title: 'Decisions missing date, rationale or who decided', standard: 'A decision record says when it was made, why, and who made it, so it can be relied on later.' },
  { ruleId: 'RR09', severity: 'low', affectsScore: true, title: 'Assumptions with no validation plan or date', standard: 'Each assumption needs a way and a date to confirm it before the project depends on it.' },
  { ruleId: 'RR10', severity: 'low', affectsScore: true, title: 'Closed items with no closure date or reason', standard: 'Closing an item records when and why, so the log shows how it was dealt with.' },
  { ruleId: 'RR11', severity: 'low', affectsScore: true, title: 'Possible duplicates', standard: 'Each risk, issue or action should be logged once, so it is tracked and reported once.' },
  { ruleId: 'RR12', severity: 'info', affectsScore: false, title: 'Risks not written as cause, event and effect', standard: 'A clear risk statement says what could happen, why, and what it would lead to (e.g. "Because…, … may happen, resulting in…").' },
];

export const RULE_IDS = RULES.map(r => r.ruleId);

const WEIGHT: Record<RaidFindingSeverity, number> = { high: 12, medium: 6, low: 2, info: 0 };

const blank = (v: unknown) => v == null || String(v).trim() === '';
const hasOwner = (i: RaidReviewItem) => !blank(i.ownerId) || !blank(i.ownerResourceId) || !blank(i.ownerName);

/** RR05: the owner name is a team, organisation or several people */
export function isGroupOwnerName(name: string | null | undefined): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (/[\/,;&]/.test(n) || /\sand\s/i.test(n)) return true;
  if (/^\S+$/.test(n)) return true; // one word: "DBJ", "Finance"
  if (/^[^\s(]+\s*\(.*\)\s*$/.test(n)) return true; // "DBJ (CRM)"
  return false;
}

const IMPERATIVE_VERBS = [
  'provide', 'confirm', 'send', 'prepare', 'review', 'update', 'obtain', 'share', 'schedule', 'complete',
  'follow up', 'follow-up', 'arrange', 'submit', 'create', 'set up', 'set-up', 'deliver', 'check', 'agree',
  'finalise', 'finalize', 'request', 'draft', 'assist', 'escalate', 'validate', 'test', 'implement', 'hold',
  'organise', 'organize',
];
const UNCERTAINTY_WORDS = ['risk', 'may', 'might', 'could', 'possible', 'potential', 'if', 'uncertain', 'likelihood'];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const IMPERATIVE_RE = new RegExp(`^\\s*(${IMPERATIVE_VERBS.map(escapeRe).join('|')})\\b`, 'i');
const UNCERTAINTY_RE = new RegExp(`\\b(${UNCERTAINTY_WORDS.join('|')})\\b`, 'i');

/** RR06: does this item look filed under the wrong type? */
export function looksLikeWrongType(item: Pick<RaidReviewItem, 'type' | 'title'>): boolean {
  const title = String(item.title || '');
  if (item.type === 'risk') return IMPERATIVE_RE.test(title) && !UNCERTAINTY_RE.test(title);
  if (item.type === 'issue') return /^\s*action\b/i.test(title) || /^\s*A-\d+\b/i.test(title);
  return false;
}

const CAUSE_EFFECT_PHRASES = [
  'because', 'due to', 'as a result', 'if', 'risk that', 'may', 'might', 'could', 'which would', 'resulting in', 'leading to',
];
const CAUSE_EFFECT_RE = new RegExp(`\\b(${CAUSE_EFFECT_PHRASES.map(escapeRe).join('|')})\\b`, 'i');

/** RR12: is the risk written as cause → event → effect? */
export function isCauseEventEffect(item: Pick<RaidReviewItem, 'title' | 'description'>): boolean {
  return CAUSE_EFFECT_RE.test(`${item.title || ''} ${item.description || ''}`);
}

/** RR11: the words that identify a title (lowercase, 3+ letters) */
export function titleWords(title: string): Set<string> {
  return new Set(String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && /[a-z]/.test(w)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Whole days from a date/timestamp to today, or null */
function daysSince(value: unknown, today: string): number | null {
  const d = toDateString(value);
  return d ? daysBetween(d, today) : null;
}

interface RuleCheck {
  applicable: RaidReviewItem[];
  affected: RaidReviewItem[];
}

function evaluate(ruleId: string, items: RaidReviewItem[], today: string): RuleCheck {
  const open = items.filter(isOpen);
  const ofType = (list: RaidReviewItem[], t: string) => list.filter(i => i.type === t);
  switch (ruleId) {
    case 'RR01': {
      const applicable = ofType(open, 'risk').filter(i => ['high', 'critical'].includes(String(i.severity || '').toLowerCase()));
      return { applicable, affected: applicable.filter(i => blank(i.responseStrategy)) };
    }
    case 'RR02': {
      const applicable = ofType(open, 'action');
      return { applicable, affected: applicable.filter(i => !toDateString(i.dueDate)) };
    }
    case 'RR03':
      return { applicable: open, affected: open.filter(i => !hasOwner(i)) };
    case 'RR04':
      return {
        applicable: open,
        affected: open.filter(i => {
          const due = toDateString(i.dueDate);
          if (!due || !(due < today)) return false;
          const since = daysSince(i.updatedAt, today);
          return since != null && since > 14;
        }),
      };
    case 'RR05':
      return {
        applicable: open,
        affected: open.filter(i => blank(i.ownerId) && blank(i.ownerResourceId) && isGroupOwnerName(i.ownerName)),
      };
    case 'RR06': {
      const applicable = open.filter(i => i.type === 'risk' || i.type === 'issue');
      return { applicable, affected: applicable.filter(looksLikeWrongType) };
    }
    case 'RR07': {
      const applicable = ofType(open, 'issue');
      return { applicable, affected: applicable.filter(i => blank(i.responsePlan) && blank(i.workaround) && blank(i.rootCause)) };
    }
    case 'RR08': {
      const applicable = items.filter(i => i.type === 'decision' && String(i.status).toLowerCase() === 'decided');
      return {
        applicable,
        affected: applicable.filter(i => !toDateString(i.decisionDate) || blank(i.rationale)
          || (blank(i.decidedBy) && blank(i.ownerName) && blank(i.ownerId))),
      };
    }
    case 'RR09': {
      const applicable = ofType(open, 'assumption');
      return { applicable, affected: applicable.filter(i => blank(i.validationPlan) || !toDateString(i.dueDate)) };
    }
    case 'RR10': {
      const applicable = items.filter(i => !isOpen(i));
      return { applicable, affected: applicable.filter(i => blank(i.resolvedAt) && blank(i.closureReason)) };
    }
    case 'RR11': {
      const flagged = new Set<string>();
      const words = new Map(open.map(i => [i.id, titleWords(i.title)]));
      for (let a = 0; a < open.length; a++) {
        for (let b = a + 1; b < open.length; b++) {
          const x = open[a], y = open[b];
          if (x.type !== y.type) continue;
          if (jaccard(words.get(x.id)!, words.get(y.id)!) >= 0.8) { flagged.add(x.id); flagged.add(y.id); }
        }
      }
      return { applicable: open, affected: open.filter(i => flagged.has(i.id)) };
    }
    case 'RR12': {
      const applicable = ofType(open, 'risk');
      return { applicable, affected: applicable.filter(i => !isCauseEventEffect(i)) };
    }
    default:
      return { applicable: [], affected: [] };
  }
}

const SEVERITY_ORDER: Record<RaidFindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export function reviewRaid(input: RaidReviewInput): RaidReviewResult {
  const disabled = new Set(input.disabledRules || []);
  const findings: RaidFinding[] = [];
  let penalty = 0;

  for (const rule of RULES) {
    if (disabled.has(rule.ruleId)) continue;
    const { applicable, affected } = evaluate(rule.ruleId, input.items, input.today);
    if (affected.length === 0) continue;
    findings.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      title: rule.title,
      standard: rule.standard,
      items: affected.map(i => ({ id: i.id, recordId: i.recordId ?? null, title: i.title })),
      affectsScore: rule.affectsScore,
    });
    if (rule.affectsScore) {
      const share = affected.length / Math.max(applicable.length, affected.length, 1);
      penalty += WEIGHT[rule.severity] * (0.4 + 0.6 * share);
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));

  return {
    score: Math.max(0, Math.round(100 - penalty)),
    rulesVersion: RULES_VERSION,
    itemsChecked: input.items.length,
    findings,
  };
}

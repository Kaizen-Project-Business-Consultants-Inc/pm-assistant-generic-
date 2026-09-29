/**
 * Value clean-up for the RAID register import (CSV / Excel), kept pure so it can be
 * tested on its own. Found on a real register (DBJ LMS RAID log, Sep 2026): "Pending"
 * actions failed outright (not an action status), "Approved" decisions became "pending
 * decision", "High" impact became Medium, a Target Close Date of "Post Action A-39" was
 * read as the year 2039, and columns the app had no box for were silently thrown away.
 */

export type RaidType = 'risk' | 'issue' | 'action' | 'decision' | 'assumption' | 'dependency';

/** Statuses each type accepts (mirrors RiskService VALID_STATUSES) */
export const RAID_STATUSES: Record<RaidType, string[]> = {
  risk: ['proposed', 'open', 'monitoring', 'mitigating', 'mitigated', 'closed', 'cancelled'],
  issue: ['proposed', 'open', 'in_progress', 'resolved', 'closed', 'cancelled'],
  action: ['proposed', 'open', 'in_progress', 'completed', 'closed', 'cancelled', 'deferred'],
  decision: ['proposed', 'pending_decision', 'decided', 'deferred', 'reversed'],
  assumption: ['proposed', 'open', 'validated', 'unverified', 'closed', 'cancelled'],
  dependency: ['proposed', 'open', 'pending', 'complete', 'at_risk', 'closed', 'cancelled'],
};

/** Register wording → the app's status, per type (first word that fits wins) */
const STATUS_WORDS: Record<RaidType, Record<string, string>> = {
  risk: {
    open: 'open', active: 'open', new: 'open', identified: 'open',
    monitoring: 'monitoring', monitor: 'monitoring', watch: 'monitoring', watching: 'monitoring',
    'in mitigation': 'mitigating', mitigating: 'mitigating', 'in progress': 'mitigating', treating: 'mitigating',
    mitigated: 'mitigated', reduced: 'mitigated',
    closed: 'closed', realised: 'closed', realized: 'closed', expired: 'closed', retired: 'closed', resolved: 'closed', accepted: 'monitoring',
    cancelled: 'cancelled', canceled: 'cancelled', withdrawn: 'cancelled',
  },
  issue: {
    open: 'open', active: 'open', new: 'open', raised: 'open',
    'in progress': 'in_progress', 'in-progress': 'in_progress', wip: 'in_progress', working: 'in_progress', escalated: 'in_progress',
    resolved: 'resolved', fixed: 'resolved',
    closed: 'closed', complete: 'closed', completed: 'closed', done: 'closed',
    cancelled: 'cancelled', canceled: 'cancelled',
  },
  action: {
    open: 'open', pending: 'open', 'not started': 'open', new: 'open', outstanding: 'open', overdue: 'open', 'to do': 'open', todo: 'open',
    'in progress': 'in_progress', 'in-progress': 'in_progress', wip: 'in_progress', started: 'in_progress', ongoing: 'in_progress',
    complete: 'completed', completed: 'completed', done: 'completed', finished: 'completed',
    closed: 'closed',
    cancelled: 'cancelled', canceled: 'cancelled', dropped: 'cancelled',
    deferred: 'deferred', 'on hold': 'deferred', postponed: 'deferred',
  },
  decision: {
    approved: 'decided', decided: 'decided', agreed: 'decided', accepted: 'decided', final: 'decided', confirmed: 'decided', made: 'decided',
    proposed: 'pending_decision', pending: 'pending_decision', open: 'pending_decision', 'pending decision': 'pending_decision', 'awaiting decision': 'pending_decision', draft: 'pending_decision',
    deferred: 'deferred', 'on hold': 'deferred',
    superseded: 'reversed', reversed: 'reversed', rejected: 'reversed', withdrawn: 'reversed', overturned: 'reversed',
  },
  assumption: {
    open: 'open', active: 'open', new: 'open',
    unverified: 'unverified', 'not validated': 'unverified', pending: 'unverified', 'to validate': 'unverified',
    validated: 'validated', confirmed: 'validated', verified: 'validated', true: 'validated',
    invalidated: 'closed', invalid: 'closed', false: 'closed', closed: 'closed',
    cancelled: 'cancelled', canceled: 'cancelled',
  },
  dependency: {
    open: 'open', active: 'open', new: 'open',
    pending: 'pending', waiting: 'pending', 'in progress': 'pending',
    complete: 'complete', completed: 'complete', done: 'complete', delivered: 'complete', met: 'complete',
    'at risk': 'at_risk', 'at-risk': 'at_risk', late: 'at_risk', delayed: 'at_risk',
    closed: 'closed', cancelled: 'cancelled', canceled: 'cancelled',
  },
};

/**
 * The app status for a register status, or null when it can't be matched (the caller
 * then uses the type's default and says so — the row is not lost).
 * "Closed - Mitigated" / "Open (monitoring)" style values use their first recognised word.
 */
export function normalizeRaidStatus(type: RaidType, raw: string | undefined): string | null {
  const s = (raw || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (RAID_STATUSES[type].includes(s.replace(/ /g, '_'))) return s.replace(/ /g, '_');
  const words = STATUS_WORDS[type];
  if (words[s]) return words[s];
  // First recognised phrase inside a longer value ("Closed – mitigated", "Open (monitoring)")
  const parts = s.split(/[^a-z-]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const two = parts.slice(i, i + 2).join(' ');
    if (words[two]) return words[two];
    if (words[parts[i]]) return words[parts[i]];
  }
  return null;
}

/** Likelihood / impact on the app's 1–5 scale from a number or a word ("High", "Very low") */
export function parseLevel(raw: string | undefined): number | undefined {
  const s = (raw || '').toLowerCase().trim();
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return Math.round(n);
  const words: Record<string, number> = {
    'very low': 1, 'very unlikely': 1, rare: 1, minimal: 1, negligible: 1, insignificant: 1,
    low: 2, unlikely: 2, minor: 2,
    medium: 3, med: 3, moderate: 3, possible: 3,
    high: 4, likely: 4, major: 4, significant: 4,
    'very high': 5, 'almost certain': 5, certain: 5, severe: 5, critical: 5, catastrophic: 5, extreme: 5,
  };
  return words[s];
}

/** Severity from likelihood × impact (1–25) when the register doesn't give one */
export function severityFromScore(probability?: number, impact?: number): string | undefined {
  if (!probability || !impact) return undefined;
  const score = probability * impact;
  if (score >= 20) return 'critical';
  if (score >= 12) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31 Feb etc.
  return dt.toISOString().slice(0, 10);
}

/**
 * A calendar date ('YYYY-MM-DD') from a register cell, or null when the cell is not a
 * date ("TBD", "Post Action A-39", "Q3"). Strict on purpose: `new Date("Post Action
 * A-39")` is the year 2039. Accepts ISO, 15-Aug-2026 / 15 Aug 26, Aug 15 2026, Excel
 * serial numbers, and d/m/yyyy (day first unless the first number can only be a month
 * position, e.g. 08/15/2026).
 */
export function parseRegisterDate(raw: string | undefined): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  const month = (w: string) => MONTHS[w.slice(0, 4).toLowerCase()] ?? MONTHS[w.slice(0, 3).toLowerCase()];
  m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})\.?[\s\-\/.,]+(\d{2,4})$/);
  if (m) {
    const mon = month(m[2]);
    return mon ? ymd(+m[3], mon, +m[1]) : null;
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const mon = month(m[1]);
    return mon ? ymd(+m[3], mon, +m[2]) : null;
  }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    return b > 12 ? ymd(+m[3], a, b) : ymd(+m[3], b, a); // day first unless impossible
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { // Excel serial day (1900 system)
    const n = Math.floor(Number(s));
    if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * A register's response strategy as the app's value (PMI: avoid / mitigate / transfer /
 * accept / escalate), or null when the wording isn't recognised (the caller keeps it as a
 * note). "Reduce" is mitigate and "share" is transfer; "Mitigate – reduce likelihood"
 * style values use their first recognised word.
 */
export function normalizeResponseStrategy(raw: string | undefined): 'avoid' | 'mitigate' | 'transfer' | 'accept' | 'escalate' | null {
  const words: Record<string, 'avoid' | 'mitigate' | 'transfer' | 'accept' | 'escalate'> = {
    avoid: 'avoid', avoidance: 'avoid', eliminate: 'avoid',
    mitigate: 'mitigate', mitigation: 'mitigate', reduce: 'mitigate', reduction: 'mitigate', control: 'mitigate', treat: 'mitigate',
    transfer: 'transfer', transference: 'transfer', share: 'transfer', insure: 'transfer',
    accept: 'accept', acceptance: 'accept', tolerate: 'accept', retain: 'accept',
    escalate: 'escalate', escalation: 'escalate', escalated: 'escalate',
  };
  const parts = (raw || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const p of parts) if (words[p]) return words[p];
  return null;
}

/** Register columns the app has no box for: kept as a "From the register" block in the description */
export const NOTE_FIELD_LABELS: Record<string, string> = {
  externalId: 'Register ID',
  dateRaised: 'Date raised',
  raisedBy: 'Raised by',
  dateClosed: 'Date closed',
  closureReason: 'Closure reason',
  updates: 'Updates / resolution',
  score: 'Score',
  targetScore: 'Target score',
  responseStrategy: 'Response strategy',
  linkedIds: 'Linked',
  supersededBy: 'Superseded by',
  validationEvidence: 'Validation evidence',
};

/**
 * The description to store: the register's own description, then everything else the
 * import kept, one "Label: value" per line, so nothing in the sheet is lost.
 */
export function describeWithRegisterDetails(description: string | undefined, details: Array<[string, string]>): string | undefined {
  const lines = details.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v.trim()}`);
  if (lines.length === 0) return description;
  const block = `From the register:\n${lines.join('\n')}`;
  return description?.trim() ? `${description.trim()}\n\n${block}` : block;
}

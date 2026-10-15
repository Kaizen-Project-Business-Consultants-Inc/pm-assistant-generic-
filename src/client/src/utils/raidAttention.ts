/**
 * "Needs attention" on the Risks & Issues tab (UAT U20, 2026-10-14): the RAID items a PM should
 * look at now, across every type, each with the reason in plain words. Finished items never count.
 */
export type RaidSection = 'attention' | 'risk' | 'issue' | 'action' | 'decision' | 'assumption' | 'dependency' | 'all';

/** Statuses that mean the item needs nothing more */
const FINISHED = new Set(['closed', 'mitigated', 'resolved', 'completed', 'complete', 'decided', 'validated', 'cancelled', 'reversed', 'deferred']);

interface RaidLike {
  type: string;
  status: string;
  severity?: string | null;
  mitigationPlan?: string | null;
  responseStrategy?: string | null;
  triggered?: boolean;
  dueDate?: string | null;
}

const plusDays = (ymd: string, n: number) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const isHigh = (item: RaidLike) => item.severity === 'high' || item.severity === 'critical';
const dueOf = (item: RaidLike) => (item.dueDate ? String(item.dueDate).slice(0, 10) : null);

const RULES: Record<string, (item: RaidLike, today: string) => string | null> = {
  risk: (item) => {
    if (item.triggered) return 'Triggered — it may be happening';
    return isHigh(item) && !item.mitigationPlan?.trim() && !item.responseStrategy ? 'High risk with no response plan' : null;
  },
  issue: (item) => (isHigh(item) ? `Open ${item.severity} issue` : null),
  action: (item, today) => { const due = dueOf(item); return due && due < today ? 'Overdue' : null; },
  decision: (item) => (item.status === 'pending_decision' ? 'Waiting for a decision' : null),
  assumption: (item, today) => {
    if (item.status === 'unverified') return 'Not confirmed yet';
    const due = dueOf(item);
    if (!due || due > plusDays(today, 7)) return null;
    return due < today ? 'Past its confirm-by date' : 'Confirm within a week';
  },
  dependency: (item, today) => {
    if (item.status === 'at_risk') return 'At risk';
    const due = dueOf(item);
    return due && due < today ? 'Past its needed-by date' : null;
  },
};

/** Why this item needs the PM's attention today ('YYYY-MM-DD'), or null */
export function attentionReason(item: RaidLike, today: string): string | null {
  if (FINISHED.has(item.status)) return null;
  return RULES[item.type]?.(item, today) ?? null;
}

export const RAID_SECTIONS: Array<{ id: RaidSection; label: string }> = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'risk', label: 'Risks' },
  { id: 'issue', label: 'Issues' },
  { id: 'action', label: 'Actions' },
  { id: 'decision', label: 'Decisions' },
  { id: 'assumption', label: 'Assumptions' },
  { id: 'dependency', label: 'Dependencies' },
  { id: 'all', label: 'All' },
];

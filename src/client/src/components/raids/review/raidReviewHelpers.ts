// ---------------------------------------------------------------------------
// RAID Review — types (mirror the server API) and small pure helpers
// ---------------------------------------------------------------------------

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

export interface RaidReview {
  id: string;
  projectId: string;
  score: number;
  rulesVersion: string;
  itemsChecked: number;
  createdAt: string;
  findings: RaidFinding[];
  disabledRules: string[];
}

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

export interface RaidFixesResponse {
  fixes: RaidFix[];
  people: { value: string; label: string }[];
}

export interface RaidFixApplyEntry {
  id: string;
  kind: string;
  itemId: string;
  value?: string;
  toType?: string;
}

export type ResponseStrategy = 'avoid' | 'mitigate' | 'transfer' | 'accept' | 'escalate';

export const RESPONSE_STRATEGIES: { value: ResponseStrategy; label: string }[] = [
  { value: 'avoid', label: 'Avoid' },
  { value: 'mitigate', label: 'Mitigate' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'accept', label: 'Accept' },
  { value: 'escalate', label: 'Escalate' },
];

export function responseStrategyLabel(value: string | null | undefined): string {
  if (!value) return '';
  return RESPONSE_STRATEGIES.find(s => s.value === value)?.label ?? value;
}

/** Statuses that mean the item is finished — these get a Closure reason field */
export const CLOSED_STATUSES = ['closed', 'completed', 'resolved', 'complete'];
export function isClosedStatus(status: string | null | undefined): boolean {
  return !!status && CLOSED_STATUSES.includes(status);
}

export const SEVERITY_ORDER: RaidFindingSeverity[] = ['high', 'medium', 'low', 'info'];
export const SEVERITY_LABEL: Record<RaidFindingSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Suggestion' };

/** Short labels for the per-row chips in the RAID list */
const RULE_SHORT_LABELS: Record<string, string> = {
  RR01: 'No response strategy',
  RR02: 'No due date',
  RR03: 'No owner',
  RR04: 'Overdue, not updated',
  RR05: 'Owner is a group',
  RR06: 'Looks like the wrong type',
  RR07: 'No resolution plan',
  RR08: 'Decision incomplete',
  RR09: 'No validation plan',
  RR10: 'No closure details',
  RR11: 'Possible duplicate',
};

export function ruleShortLabel(ruleId: string, fallbackTitle: string): string {
  return RULE_SHORT_LABELS[ruleId] ?? fallbackTitle;
}

/** Colour of the RAID health score: ≥80 green, 60–79 amber, below 60 red */
export type ScoreBand = 'good' | 'fair' | 'poor';
export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}
export function scoreBandClass(score: number): string {
  const band = scoreBand(score);
  if (band === 'good') return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700';
  if (band === 'fair') return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700';
  return 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700';
}
export const SCORE_BAND_LABEL: Record<ScoreBand, string> = { good: 'Good', fair: 'Needs work', poor: 'Poor' };

/**
 * itemId → short flag for the RAID list, from the latest review.
 * The first high or medium finding wins. Low findings and suggestions stay in the review only:
 * flagged on every row they drowned out the ones that matter (e.g. "No closure details" on
 * every completed action).
 */
export function itemFlags(review: RaidReview | null | undefined): Map<string, { label: string; severity: RaidFindingSeverity }> {
  const flags = new Map<string, { label: string; severity: RaidFindingSeverity }>();
  if (!review) return flags;
  for (const sev of SEVERITY_ORDER) {
    if (sev === 'info' || sev === 'low') continue;
    for (const f of review.findings) {
      if (f.severity !== sev) continue;
      for (const it of f.items) {
        if (!flags.has(it.id)) flags.set(it.id, { label: ruleShortLabel(f.ruleId, f.title), severity: f.severity });
      }
    }
  }
  return flags;
}

/** The inputs a ticked fix still needs. Returns the ids of ticked fixes whose required value is empty. */
export function fixesMissingInput(fixes: RaidFix[], selected: Set<string>, values: Record<string, string>): string[] {
  return fixes
    .filter(f => selected.has(f.id) && f.input && !(values[f.id] ?? '').trim())
    .map(f => f.id);
}

/** The body for POST …/fixes/apply */
export function buildApplyEntries(fixes: RaidFix[], selected: Set<string>, values: Record<string, string>): RaidFixApplyEntry[] {
  return fixes.filter(f => selected.has(f.id)).map(f => {
    const entry: RaidFixApplyEntry = { id: f.id, kind: f.kind, itemId: f.itemId };
    if (f.input) entry.value = (values[f.id] ?? '').trim();
    if (f.toType) entry.toType = f.toType;
    return entry;
  });
}

/** Starting values for the inline inputs: the server's suggestion, else empty */
export function initialFixValues(fixes: RaidFix[]): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of fixes) if (f.input) v[f.id] = f.input.suggested ?? '';
  return v;
}

export function itemChipText(it: RaidFindingItem): string {
  const title = it.title.length > 32 ? `${it.title.slice(0, 31)}…` : it.title;
  return it.recordId ? `${it.recordId} · ${title}` : title;
}

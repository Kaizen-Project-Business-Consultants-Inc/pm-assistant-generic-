import type { RateCardEntry } from '../services/api';

/** Roles match without regard to case or surrounding spaces (same rule as the server) */
export const roleKey = (role: string | null | undefined) => (role ?? '').trim().toLowerCase();

/** Today as YYYY-MM-DD in the viewer's own calendar */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The card rate for a role in force on `day` (the latest one starting on or before it), or null */
export function cardRateOn(role: string, day: string, card: RateCardEntry[]): RateCardEntry | null {
  const key = roleKey(role);
  let best: RateCardEntry | null = null;
  for (const e of card) {
    if (roleKey(e.role) !== key || e.effectiveFrom > day) continue;
    if (!best || e.effectiveFrom > best.effectiveFrom) best = e;
  }
  return best;
}

/** The next card rate for a role that starts after `day`, or null */
export function nextCardRate(role: string, day: string, card: RateCardEntry[]): RateCardEntry | null {
  const key = roleKey(role);
  return card
    .filter(e => roleKey(e.role) === key && e.effectiveFrom > day)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null;
}

export const money = (n: number) => `$${n.toFixed(2)}`;

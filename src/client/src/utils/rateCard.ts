import type { RateCardEntry } from '../services/api';

/**
 * Who sees pay rates — the server's rule (src/server/utils/payRates.ts PAY_RATE_READ_ROLES; the
 * company owner arrives as 'pmo'): those who set them, plus finance officers, who only read them.
 * Guests never do. Others get no rates from the server, so the rate fields are hidden from them
 * (2026-10-10).
 */
const PAY_RATE_READ_ROLES: readonly string[] = ['admin', 'pmo', 'project_manager', 'finance_officer'];
export const canSeePayRates = (user: { role?: string; isGuest?: boolean } | null | undefined) =>
  !!user && !user.isGuest && PAY_RATE_READ_ROLES.includes(user.role ?? '');

/** Roles match without regard to case or surrounding spaces (same rule as the server) */
export const roleKey = (role: string | null | undefined) => (role ?? '').trim().toLowerCase();

/** Today as YYYY-MM-DD in the viewer's own calendar */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The card rate for a role in force on `day` (the latest one starting on or before it), or null.
 * Same pick as the server's ratesOn (RateCardService) — src/server/__tests__/utils/rulesParity.test.ts
 * fails until both match.
 */
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

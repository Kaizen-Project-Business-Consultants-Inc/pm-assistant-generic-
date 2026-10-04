/**
 * Whether the PM is asked "Escalate to sponsor?" on a RAID item: an open Critical risk or
 * issue, not yet escalated and not waved off with "Not now".
 *
 * Same rule as the server's needsEscalationPrompt (src/server/utils/escalationPrompt.ts) —
 * src/server/__tests__/utils/rulesParity.test.ts feeds both the same items: change one and
 * that test fails until both match.
 */
export function needsEscalationPrompt(item: { type: string; severity?: string; status: string; escalatedAt?: string | null; escalationPromptDismissedAt?: string | null }): boolean {
  if (!['risk', 'issue'].includes(item.type)) return false;
  if (item.severity !== 'critical') return false;
  if (['closed', 'resolved', 'cancelled', 'reversed', 'mitigated'].includes(item.status)) return false;
  return !item.escalatedAt && !item.escalationPromptDismissedAt;
}

import type { ProjectRisk } from '../database/RiskRepository';

const HIGHEST = new Set(['critical']);

/**
 * Whether the PM should be asked "Escalate to sponsor?" on this item.
 *
 * The screen keeps the same rule in src/client/src/utils/escalationPrompt.ts —
 * src/server/__tests__/utils/rulesParity.test.ts feeds both the same items: change one and
 * that test fails until both match.
 */
export function needsEscalationPrompt(item: Pick<ProjectRisk, 'type' | 'severity' | 'status' | 'escalatedAt' | 'escalationPromptDismissedAt'>): boolean {
  if (!['risk', 'issue'].includes(item.type)) return false;
  if (!HIGHEST.has(String(item.severity))) return false;
  if (['closed', 'resolved', 'cancelled', 'reversed', 'mitigated'].includes(String(item.status))) return false;
  return !item.escalatedAt && !item.escalationPromptDismissedAt;
}

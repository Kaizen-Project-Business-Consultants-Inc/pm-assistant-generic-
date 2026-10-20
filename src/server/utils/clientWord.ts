import { organizationService } from '../services/OrganizationService';

/**
 * "department" on the Team (sme) and Enterprise plans, else "client" — the same rule as the app's
 * screens (client hooks/useClientWord.ts, U50, user 2026-10-20). For report titles and email subjects.
 */
function clientWordFor(tier: string | null | undefined): 'client' | 'department' {
  return tier === 'sme' || tier === 'enterprise' ? 'department' : 'client';
}

/** The word for the caller's own company */
export async function clientWordOf(userId: string): Promise<'client' | 'department'> {
  return clientWordFor((await organizationService.findByUserId(userId))?.subscriptionTier);
}

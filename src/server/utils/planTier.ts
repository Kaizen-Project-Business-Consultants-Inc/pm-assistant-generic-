/**
 * The plan that decides what a person may use. A viewer is judged by their company's plan: viewers
 * keep the default trial plan on their own record, which says nothing about the company's
 * (audit 2026-10-10 M2). Everyone else by their own (the company's plan is copied onto it).
 */
export function planTierFor(role: string, ownTier: string, companyTier?: string | null): string {
  return role === 'viewer' && companyTier ? companyTier : ownTier;
}

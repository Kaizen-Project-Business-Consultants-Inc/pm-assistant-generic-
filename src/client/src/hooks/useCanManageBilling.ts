import { useAuthStore, withoutCompany } from '../stores/authStore';
import type { User } from '../stores/authStore';

/** Said wherever the billing buttons are hidden for everyone but the owner (Account, Pricing) */
export const OWNER_MANAGES_BILLING = "Your company's owner manages the plan, payment and AI top-ups.";

/**
 * Billing (plan, payment details, AI token top-ups, seats) belongs to the company owner — the
 * server bills the owner's own payment account and refuses everyone else (billingOwnerOnly in
 * routes/integrations/stripe.ts). Someone with no company (the platform admin, or a signup whose
 * company was never made) pays for themselves, as the server allows. Everyone else is not shown
 * the buttons.
 */
export function canManageBilling(user: User | null | undefined): boolean {
  return !!user && (user.organization?.isOwner === true || withoutCompany(user));
}

export function useCanManageBilling(): boolean {
  return canManageBilling(useAuthStore((s) => s.user));
}

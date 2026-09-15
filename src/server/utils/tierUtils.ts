/**
 * Shared tier classification helpers.
 */

const CONSULTANT_TIERS = ['consultant_basic', 'consultant_pro'];

export function isConsultantTier(tier: string): boolean {
  return CONSULTANT_TIERS.includes(tier);
}

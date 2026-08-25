// Single source of truth for branding, tier config, and contact info.

// ── Contact ──────────────────────────────────────────────────────────
export const SUPPORT_EMAIL = 'support@kovarti.com';
export const SALES_EMAIL = 'sales@kovarti.com';
export const PRIVACY_EMAIL = 'privacy@kovarti.com';

// ── Tier helpers ─────────────────────────────────────────────────────
export const TIER_LABELS: Record<string, string> = {
  trial: 'Trial',
  consultant_basic: 'Consultant Basic',
  consultant_pro: 'Consultant Pro',
  sme: 'SME',
  enterprise: 'Enterprise',
};

const PAID_TIERS = new Set(['consultant_basic', 'consultant_pro', 'sme', 'enterprise']);

export function isPaidTier(tier: string | undefined | null): boolean {
  return PAID_TIERS.has(tier || '');
}

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] || tier;
}

// ── Tier badge colors (admin pages) ──────────────────────────────────
export function tierBadgeClass(tier: string): string {
  switch (tier) {
    case 'enterprise':
      return 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300';
    case 'sme':
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300';
    case 'consultant_pro':
      return 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300';
    case 'consultant_basic':
      return 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300';
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
  }
}

// ── Founder badge ───────────────────────────────────────────────────
export const FOUNDER_BADGE_CLASS = 'bg-gradient-to-r from-amber-500 to-orange-500 text-white';

// ── Logo SVG path (the lightbulb icon) ───────────────────────────────
export const LOGO_SVG_PATH = 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z';

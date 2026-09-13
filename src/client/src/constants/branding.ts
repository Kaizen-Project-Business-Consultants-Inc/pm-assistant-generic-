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

// ── Role helpers ────────────────────────────────────────────────────
export const USER_ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  executive: 'Executive',
  pmo: 'PMO',
  project_manager: 'Project Manager',
  team_lead: 'Team Lead',
  team_member: 'Team Member',
  viewer: 'Viewer',
  client_stakeholder: 'Client Stakeholder',
  external_auditor: 'External Auditor',
  resource_manager: 'Resource Manager',
  finance: 'Finance',
  qa_lead: 'QA Lead',
  scrum_master: 'Scrum Master',
  business_analyst: 'Business Analyst',
};

export function roleLabel(role: string): string {
  return USER_ROLE_LABELS[role] || role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Tier badge colors (admin pages) ──────────────────────────────────
export function tierBadgeClass(_tier: string): string {
  return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
}

// ── Founder badge ───────────────────────────────────────────────────
export const FOUNDER_BADGE_CLASS = 'bg-gradient-to-r from-amber-500 to-orange-500 text-white';

// ── Logo SVG path (the lightbulb icon) ───────────────────────────────
export const LOGO_SVG_PATH = 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z';

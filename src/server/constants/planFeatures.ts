/**
 * The plans we sell and the plan-gated features, in one place.
 *
 * Every plan needs a pricing_config row and a tier_features row for every feature below: a
 * missing row reads as "feature off", silently. That is how production's SME, Enterprise and
 * Trial plans came to have no features at all, and how "Import from a document (AI)" was
 * refused on every plan — its key was never in any list (found 2026-09-30).
 *
 * Guards: requireFeature() only accepts these keys (a new or misspelt key doesn't compile);
 * planFeatures.test.ts checks the migrations seed every plan × feature; AlertService emails
 * support if a running server's tables have a gap.
 */
export const PLAN_TIERS = ['trial', 'consultant_basic', 'consultant_pro', 'sme', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const FEATURE_KEYS = [
  'ai_assistant',
  'api_keys',
  'auto_reschedule',
  'cross_project_intelligence',
  'evm',
  'exports',
  'meeting_intelligence',
  'monte_carlo',
  'nl_query',
  'portal',
  'reports',
  'resources',
  'workflows',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

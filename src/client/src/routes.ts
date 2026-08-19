/**
 * Centralised route constants.
 * App.tsx declares <Route path> from these values.
 * All navigate() and <Link to> call sites use routeTo builders or ROUTES constants.
 */

export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  verifyEmail: '/verify-email',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  pricing: '/pricing',
  terms: '/terms',
  privacy: '/privacy',
  guide: '/guide',
  waitlistAdmin: '/waitlist-admin',
  onboarding: '/onboarding',
  myWork: '/my-work',
  dashboard: '/dashboard',
  projects: '/projects',
  reports: '/reports',
  scenarios: '/scenarios',
  portfolio: '/portfolio',
  analytics: '/analytics',
  workflows: '/workflows',
  monteCarlo: '/monte-carlo',
  meetings: '/meetings',
  lessons: '/lessons',
  timesheet: '/timesheet',
  query: '/query',
  account: '/account',
  integrations: '/integrations',
  reportBuilder: '/report-builder',
  intake: '/intake',
  help: '/help',
  settings: '/settings',
  changeRequests: '/change-requests',
  goals: '/goals',
  notifications: '/notifications',
  resources: '/resources',
  evm: '/evm',
  agent: '/agent',
  adminUsers: '/admin/users',
  adminTenants: '/admin/tenants',
  adminSystem: '/admin/system',
  adminAiUsage: '/admin/ai-usage',
  adminAudit: '/admin/audit',
  adminOperations: '/admin/operations',
  adminFeedback: '/admin/feedback',
  adminRevenue: '/admin/revenue',
  adminPricing: '/admin/pricing',
  adminSchedules: '/admin/schedules',
  admin: '/admin',
} as const;

/** Route-pattern strings for <Route path="..."> declarations (with params) */
export const ROUTE_PATTERNS = {
  project: '/project/:id',
  portal: '/portal/:token',
  kpi: '/kpi/:type',
} as const;

/** Builders for parameterised routes */
export const routeTo = {
  project: (id: string, tab?: string) =>
    `/project/${id}${tab ? `?tab=${tab}` : ''}`,
  portal: (token: string) => `/portal/${token}`,
  kpi: (type: string) => `/kpi/${type}`,
  admin: (section: string) => `/admin/${section}`,
};

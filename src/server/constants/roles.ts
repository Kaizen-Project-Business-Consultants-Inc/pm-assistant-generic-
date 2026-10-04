/**
 * Roles a company owner may give a member (invite or change). NOT 'admin': that is the Kovarti
 * platform admin only — user rule 2026-10-04, see utils/platformAdmin.ts. Guard:
 * __tests__/middleware/platformAdminGuard.test.ts
 */
export const COMPANY_ASSIGNABLE_ROLES = [
  'executive', 'project_manager', 'team_member', 'scrum_master',
  'finance_officer', 'risk_manager', 'pmo', 'ba', 'qa', 'tester', 'devops', 'claude_sme', 'viewer',
] as const;

export const ADMIN_NOT_ASSIGNABLE_MESSAGE =
  "Admin is reserved for the Kovarti platform team and can't be given to a company member. Choose another role.";

/** Organisation roles that can read every project in the organisation */
export const GLOBAL_READ_ROLES = ['admin', 'pmo', 'executive'];

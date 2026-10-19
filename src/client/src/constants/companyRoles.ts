/**
 * The roles a company owner hands out when inviting someone (server: COMPANY_ASSIGNABLE_ROLES).
 * Never 'admin' — that is the Kovarti platform admin only (user rule 2026-10-04). On the Team
 * plan everyone but a Viewer uses a paid seat (server SeatService: non-viewer active users).
 */
export const COMPANY_ROLE_OPTIONS = [
  { value: 'project_manager', label: 'Project Manager', paidSeat: true },
  { value: 'team_member', label: 'Team Member', paidSeat: true },
  { value: 'viewer', label: 'Viewer', paidSeat: false },
  { value: 'executive', label: 'Executive', paidSeat: true },
] as const;

export const usesPaidSeat = (role: string): boolean =>
  COMPANY_ROLE_OPTIONS.some(r => r.value === role && r.paidSeat);

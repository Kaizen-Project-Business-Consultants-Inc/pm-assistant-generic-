/**
 * Which top-level pages each role may open — ONE list for the sidebar menu and the router.
 *
 * The sidebar draws its menu from PM_NAV_SECTIONS. The router's RoleRouteGuard uses
 * canOpenPath(): a page whose menu entry names roles is only for those roles (and guests never
 * get GUEST_HIDDEN_PATHS); typing its address, or a deeper one under it, goes to the dashboard.
 * Pages that are not menu entries (a project, Help, Account, KPI drill-ins…) stay open to every
 * signed-in person; the admin pages have their own guard (PrivateRoute requiredRole="admin").
 *
 * This only tidies what the app shows ("hide, don't disable"). The server decides what data
 * anyone may read or change, whatever page they open.
 */
import type React from 'react';
import { matchPath } from 'react-router-dom';
import {
  FileText, Settings, Layers, Search, Clock, BarChart3, Target, Bell, Gauge, Briefcase, Building2,
  UserCog, BookOpen, GitPullRequest, TrendingUp, MessageCircleHeart, Dices, FlaskConical, Workflow,
  FileBarChart, ClipboardList, Plug, Bot, Brain,
} from 'lucide-react';
import { ROUTES, ROUTE_PATTERNS } from '../routes';
import { isPersonalPath } from '../stores/authStore';
import type { User } from '../stores/authStore';

export type Role = User['role'];

export interface NavItem {
  labelKey: string;
  icon: React.ElementType;
  path: string;
  /** Only these roles may open the page; no list = everyone */
  roles?: Role[];
}

export interface NavSection {
  titleKey: string;
  items: NavItem[];
}

// All roles except viewer and team_member (PMO was missing — and the company owner works as PMO)
const NON_VIEWER_ROLES: Role[] = ['admin', 'executive', 'project_manager', 'pmo'];

export const PM_NAV_SECTIONS: NavSection[] = [
  {
    titleKey: 'section.work',
    items: [
      { labelKey: 'nav.dashboard', icon: Gauge, path: ROUTES.dashboard },
      { labelKey: 'nav.projects', icon: Briefcase, path: ROUTES.projects },
      { labelKey: 'nav.clients', icon: Building2, path: ROUTES.clients, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.portfolio', icon: Layers, path: ROUTES.portfolio, roles: ['admin', 'executive', 'pmo'] },
    ],
  },
  {
    titleKey: 'section.manage',
    items: [
      { labelKey: 'nav.resources', icon: UserCog, path: ROUTES.resources, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.intelligence', icon: Brain, path: ROUTES.meetings, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.lessons', icon: BookOpen, path: ROUTES.lessons },
      { labelKey: 'nav.changeRequests', icon: GitPullRequest, path: ROUTES.changeRequests, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.workflows', icon: Workflow, path: ROUTES.workflows, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.intake', icon: ClipboardList, path: ROUTES.intake, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.integrations', icon: Plug, path: ROUTES.integrations, roles: ['admin', 'project_manager', 'pmo'] },
    ],
  },
  {
    titleKey: 'section.insights',
    items: [
      { labelKey: 'nav.analytics', icon: BarChart3, path: ROUTES.analytics, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.evm', icon: TrendingUp, path: ROUTES.evm, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.simulation', icon: Dices, path: ROUTES.monteCarlo, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.scenarios', icon: FlaskConical, path: ROUTES.scenarios, roles: NON_VIEWER_ROLES },
      { labelKey: 'nav.reports', icon: FileText, path: ROUTES.reports },
      { labelKey: 'nav.reportBuilder', icon: FileBarChart, path: ROUTES.reportBuilder, roles: NON_VIEWER_ROLES },
    ],
  },
  {
    titleKey: 'section.ai',
    items: [
      { labelKey: 'nav.aiQuery', icon: Search, path: ROUTES.query },
      { labelKey: 'nav.aiProposals', icon: Bot, path: ROUTES.agent, roles: ['admin', 'project_manager', 'pmo'] },
    ],
  },
  {
    titleKey: 'section.personal',
    items: [
      { labelKey: 'nav.notifications', icon: Bell, path: ROUTES.notifications },
      { labelKey: 'nav.timesheets', icon: Clock, path: ROUTES.timesheet },
      { labelKey: 'nav.goals', icon: Target, path: ROUTES.goals },
      { labelKey: 'nav.myFeedback', icon: MessageCircleHeart, path: ROUTES.myFeedback },
      { labelKey: 'nav.settings', icon: Settings, path: ROUTES.settings },
    ],
  },
];

/** Menu entries a guest (an invited outside collaborator) never sees. Their own Settings stays
 *  reachable from the top-right menu, so the router lets personal pages through. */
export const GUEST_HIDDEN_PATHS: ReadonlySet<string> = new Set([
  ROUTES.resources, ROUTES.integrations, ROUTES.admin, ROUTES.settings, ROUTES.workflows, ROUTES.intake, ROUTES.changeRequests,
]);

/** Under a restricted page but linked from Projects, which everyone opens: each client's
 *  risks & issues and client report (the server shows only the projects the person may read). */
const OPEN_SUB_PAGES: string[] = [ROUTE_PATTERNS.clientRaid, ROUTE_PATTERNS.clientReport];

const MENU_ITEMS: NavItem[] = PM_NAV_SECTIONS.flatMap(s => s.items);

/**
 * May this person open this address? `path` may carry ?query or #hash. Unknown and non-menu
 * pages are allowed — the router's own 404 and the server handle those.
 */
export function canOpenPath(user: Pick<User, 'role' | 'isGuest'> | null | undefined, path: string): boolean {
  if (!user) return true;
  const pathname = path.split(/[?#]/)[0];
  if (isPersonalPath(pathname)) return true;
  if (OPEN_SUB_PAGES.some(pattern => matchPath({ path: pattern, end: true }, pathname))) return true;
  const item = MENU_ITEMS.find(i => pathname === i.path || pathname.startsWith(`${i.path}/`));
  if (!item) return true;
  if (user.isGuest && GUEST_HIDDEN_PATHS.has(item.path)) return false;
  return !item.roles || item.roles.includes(user.role);
}

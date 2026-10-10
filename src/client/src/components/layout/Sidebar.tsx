import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Settings,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Users,
  Building,
  Cpu,
  ScrollText,
  ArrowLeftRight,
  HelpCircle,
  Star,
  MessageCircleHeart,
  Zap,
  DollarSign,
  Tag,
  Calendar,
  CalendarClock,
  Mail,
} from 'lucide-react';
import { useAuthStore, withoutCompany, isPlatformAdmin } from '../../stores/authStore';
import { useTranslation } from '../../hooks/useTranslation';
import { apiService } from '../../services/api';
import { FeedbackModal } from '../feedback/FeedbackModal';
import { roleLabel } from '../../constants/branding';
import { KovartiMark } from '../ui/KovartiMark';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { SIDEBAR_ID, MOBILE_MENU_BUTTON_ID } from './mobileMenuIds';
import { PM_NAV_SECTIONS, GUEST_HIDDEN_PATHS, canOpenPath } from '../../constants/roleRoutes';
import type { NavSection } from '../../constants/roleRoutes';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// The project-side menu and who may open each page live in constants/roleRoutes.ts (the router uses the same list)

const adminNavSections: NavSection[] = [
  {
    titleKey: 'section.adminManagement',
    items: [
      { labelKey: 'nav.adminUsers', icon: Users, path: '/admin/users' },
      { labelKey: 'nav.adminTenants', icon: Building, path: '/admin/tenants' },
      { labelKey: 'nav.adminPricing', icon: Tag, path: '/admin/pricing' },
      { labelKey: 'nav.adminFeedback', icon: MessageCircleHeart, path: '/admin/feedback' },
    ],
  },
  {
    titleKey: 'section.adminMonitoring',
    items: [
      { labelKey: 'nav.adminOperations', icon: Gauge, path: '/admin/operations' },
      { labelKey: 'nav.adminRevenue', icon: DollarSign, path: '/admin/revenue' },
      { labelKey: 'nav.adminAiUsage', icon: Cpu, path: '/admin/ai-usage' },
      { labelKey: 'nav.adminSystem', icon: Settings, path: '/admin/system' },
      { labelKey: 'nav.adminAudit', icon: ScrollText, path: '/admin/audit' },
      { labelKey: 'nav.adminSchedules', icon: CalendarClock, path: '/admin/schedules' },
      { labelKey: 'nav.adminWaitlist', icon: Mail, path: '/admin/waitlist' },
    ],
  },
  {
    titleKey: 'section.adminSystem',
    items: [
      { labelKey: 'nav.settings', icon: Settings, path: '/settings' },
    ],
  },
];

const TokenUsageIndicator: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const { data } = useQuery({
    queryKey: ['ai-budget'],
    queryFn: () => apiService.getAiBudget(),
    staleTime: 5 * 60_000,
    enabled: isAuthenticated,
  });

  if (!data || !user) return null;

  const pct = data.percentUsed;

  // Only show in sidebar when usage is notable (≥ 70%)
  if (pct < 70) return null;

  const barColor = pct >= 90 ? 'bg-red-500' : 'bg-amber-500';
  const label = pct >= 90 ? 'AI usage critical' : 'AI usage high';

  if (collapsed) {
    return (
      <div className="flex-shrink-0 border-t border-white/10 px-2 py-2 flex justify-center" title={`${label} — ${pct}% used`}>
        <div className="relative w-8 h-8">
          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/10" />
            <circle cx="16" cy="16" r="13" fill="none" strokeWidth="3" strokeDasharray={`${Math.min(pct, 100) * 0.8168} 81.68`} className={pct >= 90 ? 'text-red-400' : 'text-amber-400'} stroke="currentColor" strokeLinecap="round" />
          </svg>
          <Zap className="w-3.5 h-3.5 text-sidebar-text/70 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-white/10 px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-medium flex items-center gap-1 ${pct >= 90 ? 'text-red-400' : 'text-amber-400'}`}>
          <Zap className="w-3 h-3" /> {label}
        </span>
        <span className="text-xs text-sidebar-text/60">{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <Link to="/account" className="text-xs text-sidebar-text/50 mt-1 block hover:text-white transition-colors">
        View usage details →
      </Link>
    </div>
  );
};

const ADMIN_VIEW_KEY = 'pm-admin-view';

function getStoredAdminView(): boolean {
  try {
    const stored = localStorage.getItem(ADMIN_VIEW_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle, mobileOpen, onMobileClose }) => {
  const location = useLocation();
  const nav = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { t } = useTranslation();
  // The Kovarti platform admin (admin role, no company) — company members are never admin
  const isAdmin = isPlatformAdmin(user);

  // No company (the platform admin): there is no project side to switch to
  const noCompany = withoutCompany(user);
  const [storedAdminView, setAdminView] = React.useState(() => isAdmin && getStoredAdminView());
  const adminView = storedAdminView || (isAdmin && noCompany);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);

  const toggleView = () => {
    const next = !adminView;
    setAdminView(next);
    try { localStorage.setItem(ADMIN_VIEW_KEY, String(next)); } catch {}
  };

  // Phone width: the drawer is off-screen when closed, so it must also be out of the Tab order
  // and hidden from screen readers (inert). When it opens, focus moves into it; Escape closes it
  // and puts focus back on the menu button.
  const isMobile = useBreakpoint() === 'mobile';
  const drawerHidden = isMobile && !mobileOpen;
  const asideRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    asideRef.current?.querySelector<HTMLElement>('nav a[href], nav button')?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onMobileClose?.();
      document.getElementById(MOBILE_MENU_BUTTON_ID)?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMobile, mobileOpen, onMobileClose]);

  // Close mobile sidebar on route change
  React.useEffect(() => {
    if (mobileOpen && onMobileClose) {
      onMobileClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to route change, not sidebar state
  }, [location.pathname]);

  const { data: favData } = useQuery({
    queryKey: ['favourite-projects'],
    queryFn: () => apiService.getFavouriteProjects(),
    staleTime: 60_000,
    enabled: !noCompany,
  });
  const pinnedProjects: { id: string; name: string }[] = (favData?.projects || []).slice(0, 5);

  const baseNav = isAdmin && adminView ? adminNavSections : PM_NAV_SECTIONS;

  const isActive = (path: string): boolean => {
    if (path === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    if (path === '/admin/users') {
      return location.pathname === '/admin/users' || location.pathname === '/admin';
    }
    return location.pathname.startsWith(path);
  };

  // The menu shows only what this person can open (one rule with the router: canOpenPath) —
  // items their role can't use are left out, not greyed; a section with nothing left is dropped.
  // Until the user has loaded, role-restricted items stay hidden.
  const navSections = baseNav
    // Guests also lose GUEST_HIDDEN_PATHS from the menu (e.g. Settings, reached from the top-right menu instead).
    // eslint-disable-next-line no-restricted-syntax -- small: ~6 sections of at most ~10 menu items
    .map(s => ({ ...s, items: s.items.filter(i => (user ? canOpenPath(user, i.path) && !(user.isGuest && GUEST_HIDDEN_PATHS.has(i.path)) : !i.roles)) }))
    .filter(s => s.items.length > 0);

  const userInitials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  return (
    <>
      {/* Mobile backdrop overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-screen flex flex-col
          bg-sidebar-bg text-sidebar-text
          transition-all duration-300 ease-in-out
          ${collapsed ? 'md:w-sidebar-collapsed' : 'md:w-sidebar'}
          w-sidebar
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
        aria-label="Main navigation"
        id={SIDEBAR_ID}
        ref={asideRef}
        data-modal-background=""
        // React 18 has no typed `inert` prop; an empty string sets the attribute
        {...(drawerHidden ? { inert: '' } : {})}
      >
      {/* Logo / Branding */}
      <div className="flex items-center h-16 px-4 flex-shrink-0 border-b border-white/10">
        <div className="flex items-center min-w-0">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
            <KovartiMark className="w-5 h-5 text-white" />
          </div>
          <div
            className={`
              ml-3 overflow-hidden transition-all duration-300
              ${collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}
            `}
          >
            <h1 className="text-lg font-bold text-white whitespace-nowrap tracking-tight">
              Kovarti PM
            </h1>
            <p className="text-xs text-sidebar-text/60 whitespace-nowrap leading-none mt-0.5">
              {isAdmin && adminView ? 'Administration' : 'Project Management'}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation — grouped with section labels */}
      <nav className="flex-1 overflow-y-auto py-2 px-2" aria-label="Primary">
        {navSections.map((section) => {
          return (
            <div key={t(section.titleKey)} className="mb-1">
              {/* Section label (hidden when collapsed) */}
              {!collapsed && (
                <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-text/40">
                  {t(section.titleKey)}
                </p>
              )}
              {collapsed && <div className="h-2" />}

              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    title={collapsed ? t(item.labelKey) : undefined}
                    className={`
                      group relative flex items-center rounded-lg
                      transition-all duration-200 ease-in-out
                      ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'}
                      ${
                        active
                          ? 'bg-sidebar-active text-sidebar-text-active shadow-lg shadow-primary-500/20'
                          : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
                      }
                    `}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon
                      className={`
                        flex-shrink-0 transition-colors duration-200
                        ${collapsed ? 'w-5 h-5' : 'w-[18px] h-[18px]'}
                        ${active ? 'text-white' : 'text-sidebar-text group-hover:text-white'}
                      `}
                    />
                    <span
                      className={`
                        ml-3 text-sm font-medium whitespace-nowrap
                        transition-all duration-300
                        ${collapsed ? 'sr-only' : 'block'}
                      `}
                    >
                      {t(item.labelKey)}
                    </span>

                    {/* Active indicator bar */}
                    {active && (
                      <span className="absolute left-0 w-1 h-6 bg-white rounded-r-full" />
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}

        {/* Pinned / Favourite Projects */}
        {pinnedProjects.length > 0 && !adminView && (
          <div className="mb-1">
            {!collapsed && (
              <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-text/40">
                Pinned
              </p>
            )}
            {collapsed && <div className="h-2" />}
            {pinnedProjects.map((proj) => {
              const active = location.pathname === `/project/${proj.id}`;
              // The "Open schedule" button sits beside the link, not inside it (a button in a link is invalid)
              return (
                <div key={proj.id} className="group relative">
                <Link
                  to={`/project/${proj.id}`}
                  title={collapsed ? proj.name : undefined}
                  className={`
                    group flex items-center rounded-lg
                    transition-all duration-200 ease-in-out
                    ${collapsed ? 'justify-center px-2 py-2.5' : 'pl-3 pr-8 py-2'}
                    ${
                      active
                        ? 'bg-sidebar-active text-sidebar-text-active shadow-lg shadow-primary-500/20'
                        : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
                    }
                  `}
                >
                  <Star
                    className={`
                      flex-shrink-0 transition-colors duration-200
                      ${collapsed ? 'w-5 h-5' : 'w-[18px] h-[18px]'}
                      ${active ? 'fill-amber-400 text-amber-400' : 'fill-amber-400/60 text-amber-400/60 group-hover:fill-amber-400 group-hover:text-amber-400'}
                    `}
                  />
                  <span
                    className={`
                      ml-3 text-sm font-medium whitespace-nowrap truncate
                      transition-all duration-300
                      ${collapsed ? 'sr-only' : 'block flex-1'}
                    `}
                  >
                    {proj.name}
                  </span>
                </Link>
                {!collapsed && (
                  <button
                    type="button"
                    title="Open schedule"
                    aria-label={`Open schedule: ${proj.name}`}
                    onClick={() => nav(`/project/${proj.id}?tab=schedule`)}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10 ${active ? 'text-sidebar-text-active' : 'text-sidebar-text hover:text-white'}`}
                  >
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* AI Token Usage Indicator */}
      <TokenUsageIndicator collapsed={collapsed} />

      {/* View Toggle + User Section */}
      <div className="flex-shrink-0 border-t border-white/10">
        {/* Admin/PM view toggle — only for admin users */}
        {isAdmin && !noCompany && (
          <button
            onClick={toggleView}
            title={adminView ? t('nav.switchToPm') : t('nav.switchToAdmin')}
            className={`
              w-full flex items-center gap-2 px-3 py-2.5
              text-sidebar-text/70 hover:text-white hover:bg-sidebar-hover
              transition-colors duration-200 border-b border-white/5
              ${collapsed ? 'justify-center' : ''}
            `}
          >
            <ArrowLeftRight className="w-4 h-4 flex-shrink-0" />
            <span
              className={`
                text-xs font-medium whitespace-nowrap
                transition-all duration-300
                ${collapsed ? 'sr-only' : 'block'}
              `}
            >
              {adminView ? t('nav.switchToPm') : t('nav.switchToAdmin')}
            </span>
          </button>
        )}

        {/* Help & Support */}
        <Link
          to="/help"
          className={`
            flex items-center gap-2 px-3 py-2.5
            text-sidebar-text/70 hover:text-white hover:bg-sidebar-hover
            transition-colors duration-200 border-b border-white/5
            ${collapsed ? 'justify-center' : ''}
          `}
          title="Help & Support"
        >
          <HelpCircle className="w-4 h-4 flex-shrink-0" />
          <span
            className={`
              text-xs font-medium whitespace-nowrap
              transition-all duration-300
              ${collapsed ? 'sr-only' : 'block'}
            `}
          >
            Help & Support
          </span>
        </Link>

        {/* Feedback */}
        <button
          onClick={() => setFeedbackOpen(true)}
          className={`
            w-full flex items-center gap-2 px-3 py-2.5
            text-sidebar-text/70 hover:text-white hover:bg-sidebar-hover
            transition-colors duration-200 border-b border-white/5
            ${collapsed ? 'justify-center' : ''}
          `}
          title="Share Feedback"
        >
          <MessageCircleHeart className="w-4 h-4 flex-shrink-0" />
          <span
            className={`
              text-xs font-medium whitespace-nowrap
              transition-all duration-300
              ${collapsed ? 'sr-only' : 'block'}
            `}
          >
            Feedback
          </span>
        </button>

        <div
          className={`
            flex items-center px-3 py-3
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          {/* Avatar */}
          <div
            className="flex-shrink-0 w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center ring-2 ring-primary-400/30"
            title={user?.fullName || 'User'}
          >
            <span className="text-xs font-semibold text-white">{userInitials}</span>
          </div>

          {/* User info (visible when expanded) */}
          <div
            className={`
              ml-3 min-w-0 overflow-hidden transition-all duration-300
              ${collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}
            `}
          >
            <p className="text-sm font-medium text-white truncate">
              {user?.fullName || 'Unknown User'}
            </p>
            <p className="text-xs text-sidebar-text/60 truncate capitalize">
              {user?.role ? roleLabel(user.accountRole ?? user.role) : 'No role'}
            </p>
          </div>
        </div>

        {/* Collapse Toggle (hidden on mobile) */}
        <button
          onClick={onToggle}
          className={`
            hidden md:flex w-full items-center justify-center
            py-3 text-sidebar-text/70 hover:text-white hover:bg-sidebar-hover
            transition-colors duration-200
            border-t border-white/5
          `}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <div className="flex items-center gap-2">
              <ChevronLeft className="w-5 h-5" />
              <span className="text-xs font-medium">Collapse</span>
            </div>
          )}
        </button>
      </div>
      </aside>
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </>
  );
};

export default Sidebar;

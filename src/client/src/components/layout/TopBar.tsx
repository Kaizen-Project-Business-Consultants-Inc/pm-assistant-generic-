import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, ChevronRight, LogOut, User, Moon, Sun, Menu, HelpCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { apiService } from '../../services/api';
import { NotificationBell } from '../notifications/NotificationBell';
import { ConnectionStatus } from './ConnectionStatus';
import CommandPalette from './CommandPalette';

interface Breadcrumb {
  label: string;
  path: string;
}

const ACRONYMS = new Set(['evm', 'kpi', 'ai']);

const segmentLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  portfolio: 'Portfolio',
  resources: 'Resources',
  meetings: 'Meetings',
  lessons: 'Lessons Learned',
  'change-requests': 'Change Requests',
  analytics: 'Analytics',
  evm: 'EVM',
  reports: 'Reports',
  'report-builder': 'Report Builder',
  query: 'Ask AI',
  notifications: 'Notifications',
  timesheet: 'Timesheet',
  goals: 'Goals',
  settings: 'Settings',
  schedule: 'Schedule',
  'monte-carlo': 'Monte Carlo',
  scenarios: 'Scenarios',
  workflows: 'Workflows',
  intake: 'Intake Forms',
  integrations: 'Integrations',
  agent: 'Agent Proposals',
  account: 'Account',
  help: 'Help',
  admin: 'Admin',
  users: 'Users',
  tenants: 'Tenants',
  project: 'Projects',
  pricing: 'Pricing',
  feedback: 'Feedback',
  operations: 'Operations',
  revenue: 'Revenue',
  'ai-usage': 'AI Usage',
  system: 'System',
  audit: 'Audit',
  login: 'Login',
  register: 'Register',
  terms: 'Terms',
  privacy: 'Privacy',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Segments whose natural path (/segment) differs from the actual route
const segmentPathOverrides: Record<string, string> = {
  project: '/projects',
};

function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Breadcrumb[] = [{ label: 'Home', path: '/dashboard' }];

  // Skip adding "Dashboard" segment since Home already points to /dashboard
  if (segments.length === 1 && segments[0] === 'dashboard') {
    return crumbs;
  }

  let currentPath = '';
  for (const segment of segments) {
    currentPath += `/${segment}`;
    // Keep UUIDs as-is (dashes intact) so they can be detected and replaced with names
    const isUuid = UUID_RE.test(segment);
    const label =
      segmentLabels[segment] ||
      (isUuid
        ? segment
        : ACRONYMS.has(segment.toLowerCase())
          ? segment.toUpperCase()
          : segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' '));
    const path = segmentPathOverrides[segment] || currentPath;
    crumbs.push({ label, path });
  }

  return crumbs;
}

interface TopBarProps {
  onMobileMenuToggle?: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ onMobileMenuToggle }) => {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const { isDark, toggle: toggleTheme } = useThemeStore();

  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Extract project ID from URL like /project/:id
  const segments = location.pathname.split('/').filter(Boolean);
  const projectIdx = segments.indexOf('project');
  const projectId = projectIdx >= 0 && segments[projectIdx + 1] && UUID_RE.test(segments[projectIdx + 1])
    ? segments[projectIdx + 1] : null;

  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiService.getProject(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
  const projectName = projectData?.project?.name || projectData?.name;

  const breadcrumbs = useMemo(() => {
    const crumbs = buildBreadcrumbs(location.pathname);
    // Replace or hide UUID breadcrumb with project name
    for (const crumb of crumbs) {
      if (UUID_RE.test(crumb.label)) {
        crumb.label = projectName || 'Project';
      }
    }
    return crumbs;
  }, [location.pathname, projectName]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);

  // Close dropdown on route change
  useEffect(() => {
    setDropdownOpen(false);
  }, [location.pathname]);

  // Global Cmd+K / Ctrl+K to open command palette
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLogout = async () => {
    setDropdownOpen(false);
    try { await apiService.logout(); } catch { /* ignore */ }
    logout();
  };

  const userInitials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  return (
    <header className="sticky top-0 z-30 flex items-center h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 sm:px-4 lg:px-6">
      {/* Mobile hamburger menu button */}
      {onMobileMenuToggle && (
        <button
          onClick={onMobileMenuToggle}
          className="md:hidden mr-2 p-2 -ml-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Left: Breadcrumbs */}
      <nav className="hidden sm:flex items-center min-w-0 flex-shrink" aria-label="Breadcrumb">
        <ol className="flex items-center space-x-1 text-sm">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;

            return (
              <li key={crumb.path} className="flex items-center min-w-0">
                {index > 0 && (
                  <ChevronRight className="w-4 h-4 text-gray-400 mx-1 flex-shrink-0" />
                )}
                {isLast ? (
                  <span className="font-medium text-gray-900 dark:text-gray-100 truncate" aria-current="page">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.path}
                    className="text-gray-500 dark:text-gray-400 hover:text-primary-600 transition-colors duration-150 truncate"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Mobile: Current page name only */}
      <div className="sm:hidden flex items-center min-w-0">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          {breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].label : 'Dashboard'}
        </span>
      </div>

      {/* Center: Search Trigger */}
      <div className="flex-1 flex justify-center px-2 sm:px-4 lg:px-8 max-w-xl mx-auto">
        <button
          onClick={() => setShowCommandPalette(true)}
          className="
            w-full h-9 pl-3 pr-3 text-sm flex items-center gap-2
            bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg
            text-gray-400 hover:border-gray-300 dark:hover:border-gray-500
            hover:bg-gray-100 dark:hover:bg-gray-600
            transition-colors duration-200 cursor-pointer
          "
          aria-label="Open search"
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-xs font-medium text-gray-400 bg-white dark:bg-gray-600 rounded border border-gray-200 dark:border-gray-500">
            {navigator.platform?.includes('Mac') ? '\u2318K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>

      {/* Command Palette */}
      <CommandPalette isOpen={showCommandPalette} onClose={() => setShowCommandPalette(false)} />

      {/* Right: Notifications + User */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="hidden sm:block p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Connection Status */}
        <ConnectionStatus />

        {/* Notification Bell */}
        <NotificationBell />

        {/* Divider */}
        <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-gray-600" />

        {/* User Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="
              flex items-center gap-2 p-1.5 rounded-lg
              hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150
            "
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
            aria-label="User menu"
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-white">{userInitials}</span>
            </div>

            {/* Name + Role (hidden on small screens) */}
            <div className="hidden md:block text-left min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-tight">
                {user?.fullName || 'User'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-tight capitalize">
                {user?.role || 'Member'}
              </p>
            </div>
          </button>

          {/* Dropdown Menu */}
          {dropdownOpen && (
            <div
              className="
                absolute right-0 mt-2 w-56 sm:w-64 max-w-[90vw] rounded-xl
                bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg
                py-1 z-50 animate-fade-in
              "
              role="menu"
              aria-orientation="vertical"
              aria-label="User menu"
            >
              {/* User info header */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {user?.fullName || 'User'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {user?.email || 'No email'}
                </p>
              </div>

              {/* Menu Items */}
              <div className="py-1">
                <Link
                  to="/settings"
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150"
                  role="menuitem"
                  onClick={() => setDropdownOpen(false)}
                >
                  <User className="w-4 h-4 text-gray-400" />
                  <span>Profile & Settings</span>
                </Link>
              </div>

              <div className="py-1">
                <a
                  href="mailto:support@kpbc.ca"
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150"
                  role="menuitem"
                  onClick={() => setDropdownOpen(false)}
                >
                  <HelpCircle className="w-4 h-4 text-gray-400" />
                  <span>Help & Support</span>
                </a>
              </div>

              {/* Logout */}
              <div className="border-t border-gray-100 dark:border-gray-700 py-1">
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors duration-150"
                  role="menuitem"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;

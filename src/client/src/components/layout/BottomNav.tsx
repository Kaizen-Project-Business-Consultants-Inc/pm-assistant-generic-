import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, Clock, Bell, Menu } from 'lucide-react';

interface BottomNavProps {
  onMoreClick: () => void;
}

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Projects', icon: FolderKanban, path: '/projects' },
  { label: 'Timesheet', icon: Clock, path: '/timesheet' },
  { label: 'Notifications', icon: Bell, path: '/notifications' },
  { label: 'More', icon: Menu, path: '' },
];

const BottomNav: React.FC<BottomNavProps> = ({ onMoreClick }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (!path) return false;
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 pb-safe">
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          const handleClick = () => {
            if (item.path) {
              navigate(item.path);
            } else {
              onMoreClick();
            }
          };

          return (
            <button
              key={item.label}
              onClick={handleClick}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={`flex flex-col items-center justify-center flex-1 h-full min-w-0 transition-colors ${
                active
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs mt-0.5 leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;

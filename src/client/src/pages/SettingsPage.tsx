import React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  User,
  Bell,
  Palette,
  AlertTriangle,
  Key,
  Webhook,
  Accessibility,
  Users,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { ProfileTab } from './settings/ProfileTab';
import { TeamTab } from './settings/TeamTab';
import { NotificationsTab } from './settings/NotificationsTab';
import { DisplayTab } from './settings/DisplayTab';
import { AccessibilityTab } from './settings/AccessibilityTab';
import { ApiKeysTab } from './settings/ApiKeysTab';
import { WebhooksTab } from './settings/WebhooksTab';
import { DangerZoneTab } from './settings/DangerZoneTab';

type Tab = 'profile' | 'team' | 'notifications' | 'display' | 'accessibility' | 'api-keys' | 'webhooks' | 'danger';

const ALL_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
  { id: 'team', label: 'Team', icon: <Users className="w-4 h-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
  { id: 'display', label: 'Display', icon: <Palette className="w-4 h-4" /> },
  { id: 'accessibility', label: 'Accessibility', icon: <Accessibility className="w-4 h-4" /> },
  { id: 'api-keys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
  { id: 'webhooks', label: 'Webhooks', icon: <Webhook className="w-4 h-4" /> },
  { id: 'danger', label: 'Danger Zone', icon: <AlertTriangle className="w-4 h-4" /> },
];

const VALID_TABS = new Set<string>(ALL_TABS.map(t => t.id));

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: Tab = rawTab && VALID_TABS.has(rawTab) ? (rawTab as Tab) : 'profile';

  const { user } = useAuthStore();
  const canManageTeam = user && ['admin', 'project_manager', 'pmo'].includes(user.role);
  const tabs = ALL_TABS.filter(t => t.id !== 'team' || canManageTeam);

  const setActiveTab = (tab: Tab) => {
    setSearchParams(tab === 'profile' ? {} : { tab }, { replace: true });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

      <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-700 mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && <ProfileTab />}
      {activeTab === 'team' && canManageTeam && <TeamTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'display' && <DisplayTab />}
      {activeTab === 'accessibility' && <AccessibilityTab />}
      {activeTab === 'api-keys' && <ApiKeysTab />}
      {activeTab === 'webhooks' && <WebhooksTab />}
      {activeTab === 'danger' && <DangerZoneTab />}
    </div>
  );
};

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
  Brain,
  CalendarDays,
  DollarSign,
  Eye,
  FlaskConical,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { canChangeData } from '../hooks/useCanChangeData';
import { ProfileTab } from './settings/ProfileTab';
import { TeamTab } from './settings/TeamTab';
import { NotificationsTab } from './settings/NotificationsTab';
import { DisplayTab } from './settings/DisplayTab';
import { AccessibilityTab } from './settings/AccessibilityTab';
import { ApiKeysTab } from './settings/ApiKeysTab';
import { WebhooksTab } from './settings/WebhooksTab';
import { DangerZoneTab } from './settings/DangerZoneTab';
import { AIContextTab } from './settings/AIContextTab';
import { HolidaysTab } from './settings/HolidaysTab';
import { RateCardTab } from './settings/RateCardTab';
import { canSeePayRates } from '../utils/rateCard';
import { SupportVisitsTab } from './settings/SupportVisitsTab';
import { SampleProjectTab } from './settings/SampleProjectTab';
import { usesClientPools } from '../utils/clientPools';
import { groupByKey } from '../utils/lookup';

type Tab = 'profile' | 'team' | 'holidays' | 'sample-project' | 'rate-card' | 'support-visits' | 'notifications' | 'display' | 'accessibility' | 'ai-context' | 'api-keys' | 'webhooks' | 'danger';

type Group = 'You' | 'Company' | 'Advanced' | 'Danger';

// A list down the left in groups (UAT U9, Batch F): 13 tabs in one row hid AI assistant, API keys,
// Webhooks and Danger zone off the right edge. Plain names: "AI Context" → "AI assistant",
// "API Keys" → "Connections & API keys".
const ALL_TABS: { id: Tab; label: string; icon: React.ReactNode; group: Group }[] = [
  { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" />, group: 'You' },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" />, group: 'You' },
  { id: 'display', label: 'Display', icon: <Palette className="w-4 h-4" />, group: 'You' },
  { id: 'accessibility', label: 'Accessibility', icon: <Accessibility className="w-4 h-4" />, group: 'You' },
  { id: 'ai-context', label: 'AI assistant', icon: <Brain className="w-4 h-4" />, group: 'You' },
  { id: 'team', label: 'Team', icon: <Users className="w-4 h-4" />, group: 'Company' },
  { id: 'holidays', label: 'Company holidays', icon: <CalendarDays className="w-4 h-4" />, group: 'Company' },
  { id: 'rate-card', label: 'Rate card', icon: <DollarSign className="w-4 h-4" />, group: 'Company' },
  { id: 'sample-project', label: 'Sample project', icon: <FlaskConical className="w-4 h-4" />, group: 'Company' },
  { id: 'support-visits', label: 'Support visits', icon: <Eye className="w-4 h-4" />, group: 'Company' },
  { id: 'api-keys', label: 'Connections & API keys', icon: <Key className="w-4 h-4" />, group: 'Advanced' },
  { id: 'webhooks', label: 'Webhooks', icon: <Webhook className="w-4 h-4" />, group: 'Advanced' },
  { id: 'danger', label: 'Danger zone', icon: <AlertTriangle className="w-4 h-4" />, group: 'Danger' },
];
const GROUPS: Group[] = ['You', 'Company', 'Advanced', 'Danger'];

const VALID_TABS = new Set<string>(ALL_TABS.map(t => t.id));

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: Tab = rawTab && VALID_TABS.has(rawTab) ? (rawTab as Tab) : 'profile';

  const { user } = useAuthStore();
  const canManageTeam = user && ['admin', 'project_manager', 'pmo'].includes(user.role);
  // Rates are pay information: the same people who manage the team manage the rate card;
  // finance officers see it without the change controls
  const seesRateCard = canSeePayRates(user);
  // Changing it also needs a role that may change data (not a guest, not Kovarti's Support view)
  const changesRateCard = !!canManageTeam && !user?.isGuest && canChangeData(user);
  // Support visits: the company owner (or PMO) sees every time Kovarti support looked in
  const canSeeSupportVisits = !!user && (user.organization?.isOwner === true || user.role === 'pmo');
  // Sample project: the company owner or a PMO loads and removes it (same rule as the server)
  const canManageSample = !!user && !user.isGuest && (user.organization?.isOwner === true || ['admin', 'pmo'].includes(user.role));
  // Webhooks: making, changing and removing one needs a role that may change data (server: 'write')
  const canUseWebhooks = canChangeData(user);
  // Consultant plans manage rates and holidays per client in Resources (U8); logins stay in Team here
  const pools = usesClientPools(user);
  const tabs = ALL_TABS.filter(t =>
    pools && (t.id === 'holidays' || t.id === 'rate-card') ? false
      : t.id === 'support-visits' ? canSeeSupportVisits
      : t.id === 'webhooks' ? canUseWebhooks
      : t.id === 'sample-project' ? canManageSample
      : t.id === 'rate-card' ? seesRateCard
      : t.id !== 'team' || canManageTeam);

  const setActiveTab = (tab: Tab) => {
    setSearchParams(tab === 'profile' ? {} : { tab }, { replace: true });
  };

  const current = tabs.find(t => t.id === activeTab);
  const byGroup = groupByKey(tabs, t => t.group);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

      <div className="grid gap-6 md:grid-cols-[230px_minmax(0,1fr)] items-start">
      <nav aria-label="Settings sections" className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-2">
        {GROUPS.map(group => {
          const items = byGroup.get(group) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={group} className={group === 'Danger' ? 'mt-2 pt-2 border-t border-gray-200 dark:border-gray-700' : ''}>
              {group !== 'Danger' && <h2 className="px-2.5 pt-2 pb-1 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">{group}</h2>}
              <ul>
                {items.map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <li key={tab.id}>
                      <button
                        type="button"
                        id={`settings-tab-${tab.id}`}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${
                          isActive
                            ? 'bg-accent-teal-soft text-accent-teal-text dark:bg-accent-teal/20 dark:text-teal-200 font-bold'
                            : tab.group === 'Danger'
                              ? 'text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium'
                              : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium'
                        }`}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <section id={`settings-panel-${activeTab}`} aria-label={current?.label} className="min-w-0">
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'team' && canManageTeam && <TeamTab />}
        {activeTab === 'holidays' && !pools && <HolidaysTab />}
        {activeTab === 'sample-project' && canManageSample && <SampleProjectTab />}
        {activeTab === 'rate-card' && seesRateCard && !pools && <RateCardTab canChange={changesRateCard} />}
        {activeTab === 'support-visits' && canSeeSupportVisits && <SupportVisitsTab />}
        {activeTab === 'notifications' && <NotificationsTab />}
        {activeTab === 'display' && <DisplayTab />}
        {activeTab === 'accessibility' && <AccessibilityTab />}
        {activeTab === 'ai-context' && <AIContextTab />}
        {activeTab === 'api-keys' && <ApiKeysTab />}
        {activeTab === 'webhooks' && canUseWebhooks && <WebhooksTab />}
        {activeTab === 'danger' && <DangerZoneTab />}
      </section>
      </div>
    </div>
  );
};

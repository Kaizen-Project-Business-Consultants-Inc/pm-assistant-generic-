import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { apiService } from '../../services/api';

interface CategoryPref {
  inApp: boolean;
  email: boolean;
  slack?: boolean;
}

type TypePreferences = Record<string, CategoryPref>;

const NOTIFICATION_CATEGORIES: { key: string; label: string; description: string }[] = [
  { key: 'agent_proposals', label: 'Agent & Proposals', description: 'Agent proposals, execution results, rollbacks, and low-confidence alerts' },
  { key: 'risks_issues', label: 'Risks & Issues', description: 'RAID items and reschedule proposals' },
  { key: 'budget_finance', label: 'Budget & Finance', description: 'Budget alerts, AI budget warnings, and Monte Carlo alerts' },
  { key: 'meetings', label: 'Meetings & Followups', description: 'Meeting follow-up actions and reminders' },
  { key: 'system_alerts', label: 'System Alerts', description: 'System alerts and workflow actions (always on for admins)' },
  { key: 'deadlines', label: 'Deadlines & Overdue', description: 'Deadline reminders and overdue task notifications' },
];

const DEFAULT_TYPE_PREFS: TypePreferences = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((c) => [c.key, { inApp: true, email: true }]),
);

const DIGEST_SECTIONS = [
  { key: 'overdue', label: 'Overdue Tasks' },
  { key: 'deadlines', label: 'Upcoming Deadlines' },
  { key: 'action_items', label: 'Meeting Action Items' },
  { key: 'meetings', label: 'Upcoming Meetings' },
  { key: 'sprint', label: 'Sprint Status' },
  { key: 'changes', label: 'Recent Changes' },
  { key: 'notifications', label: 'Unread Notifications' },
] as const;

const ALL_DIGEST_SECTION_KEYS = DIGEST_SECTIONS.map(s => s.key);

function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

const MiniToggle: React.FC<{ checked: boolean; onChange: () => void; label: string }> = ({ checked, onChange, label }) => (
  <button
    type="button"
    onClick={onChange}
    className="flex items-center gap-1.5"
    title={label}
  >
    <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
    <span className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${checked ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </span>
  </button>
);

export const NotificationsTab: React.FC = () => {
  const { user } = useAuthStore();
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [digestFrequency, setDigestFrequency] = useState<'none' | 'daily' | 'weekly'>('none');
  const [digestPreferredHour, setDigestPreferredHour] = useState(7);
  const [digestSections, setDigestSections] = useState<Set<string>>(new Set(ALL_DIGEST_SECTION_KEYS));
  const [typePrefs, setTypePrefs] = useState<TypePreferences>({ ...DEFAULT_TYPE_PREFS });
  const [saved, setSaved] = useState(false);
  const [serverSaving, setServerSaving] = useState(false);

  const { data: serverPrefs } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiService.getNotificationPreferences(),
  });

  useEffect(() => {
    if (serverPrefs?.user) {
      setEmailEnabled(serverPrefs.user.emailNotificationsEnabled ?? true);
      setDigestFrequency(serverPrefs.user.digestFrequency || 'none');
      setDigestPreferredHour(serverPrefs.user.digestPreferredHour ?? 7);
      if (serverPrefs.user.digestSections) {
        setDigestSections(new Set(serverPrefs.user.digestSections));
      }
      if (serverPrefs.user.notificationTypePreferences) {
        setTypePrefs((prev) => ({ ...prev, ...serverPrefs.user.notificationTypePreferences }));
      }
    }
  }, [serverPrefs]);

  const toggleCategoryChannel = (categoryKey: string, channel: 'inApp' | 'email' | 'slack') => {
    setTypePrefs((prev) => ({
      ...prev,
      [categoryKey]: {
        ...(prev[categoryKey] ?? { inApp: true, email: true, slack: true }),
        [channel]: !(prev[categoryKey]?.[channel] ?? true),
      },
    }));
  };

  const toggleDigestSection = (key: string) => {
    setDigestSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setServerSaving(true);
    try {
      await apiService.updateNotificationPreferences({
        emailNotificationsEnabled: emailEnabled,
        digestFrequency,
        digestPreferredHour,
        digestSections: [...digestSections],
        typePreferences: typePrefs,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save notification prefs:', err);
    }
    setServerSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Email Notifications</h2>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Email Notifications</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Master toggle for all email notifications</p>
          </div>
          <button
            type="button"
            onClick={() => setEmailEnabled(!emailEnabled)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${emailEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${emailEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Email Digest</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Receive a summary of project activity, tasks, meetings, and sprint status.</p>

        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Frequency</label>
            <select
              value={digestFrequency}
              onChange={(e) => setDigestFrequency(e.target.value as 'none' | 'daily' | 'weekly')}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="none">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Monday)</option>
            </select>
          </div>
          {digestFrequency !== 'none' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Send Time (UTC)</label>
              <select
                value={digestPreferredHour}
                onChange={(e) => setDigestPreferredHour(Number(e.target.value))}
                className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{formatHour(i)}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {digestFrequency !== 'none' && (
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Digest Sections</p>
            <div className="grid grid-cols-2 gap-2">
              {DIGEST_SECTIONS.map(s => (
                <label key={s.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={digestSections.has(s.key)}
                    onChange={() => toggleDigestSection(s.key)}
                    className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">{s.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Notification Categories</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Control which types of notifications you receive in-app and via email.</p>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {NOTIFICATION_CATEGORIES.map((cat) => {
            const pref = typePrefs[cat.key] ?? { inApp: true, email: true };
            const isSystemForAdmin = cat.key === 'system_alerts' && user?.role === 'admin';
            return (
              <div key={cat.key} className="flex items-center justify-between py-3 gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{cat.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cat.description}</p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <MiniToggle
                    checked={isSystemForAdmin ? true : pref.inApp}
                    onChange={() => { if (!isSystemForAdmin) toggleCategoryChannel(cat.key, 'inApp'); }}
                    label="In-App"
                  />
                  <MiniToggle
                    checked={isSystemForAdmin ? true : pref.email}
                    onChange={() => { if (!isSystemForAdmin) toggleCategoryChannel(cat.key, 'email'); }}
                    label="Email"
                  />
                  <MiniToggle
                    checked={isSystemForAdmin ? true : (pref.slack ?? true)}
                    onChange={() => { if (!isSystemForAdmin) toggleCategoryChannel(cat.key, 'slack'); }}
                    label="Slack"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={serverSaving} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />
          {serverSaving ? 'Saving...' : 'Save Preferences'}
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>}
      </div>
    </div>
  );
};

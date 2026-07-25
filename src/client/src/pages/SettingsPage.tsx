import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Bell,
  Palette,
  AlertTriangle,
  Download,
  Trash2,
  Moon,
  Sun,
  Save,
  Key,
  Webhook,
  Plus,
  Copy,
  Check,
  Send,
  Accessibility,
  Users,
  UserPlus,
  Shield,
  X,
  Lock,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getTimezones } from '../utils/dateFormat';
import { useLocaleStore } from '../stores/localeStore';
import { useAccessibility } from '../contexts/AccessibilityContext';
import { ViewerInvitePanel } from '../components/settings/ViewerInvitePanel';
import { getApiErrorMessage } from '../utils/getApiErrorMessage';

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

interface CategoryPref {
  inApp: boolean;
  email: boolean;
}

type TypePreferences = Record<string, CategoryPref>;

interface DisplayPreferences {
  theme: 'light' | 'dark';
  defaultView: 'gantt' | 'kanban' | 'table' | 'calendar';
  sidebarExpanded: boolean;
  timezone: string;
  language: string;
}

const DISPLAY_STORAGE_KEY = 'pm-settings-display';

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

function loadDisplayPrefs(): DisplayPreferences {
  try {
    const stored = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {
    theme: 'light',
    defaultView: 'gantt',
    sidebarExpanded: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    language: localStorage.getItem('pm-locale') || 'en',
  };
}

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const { user } = useAuthStore();

  // Show Team tab only to admin/project_manager/pmo roles (org managers)
  const canManageTeam = user && ['admin', 'project_manager', 'pmo'].includes(user.role);
  const tabs = ALL_TABS.filter(t => t.id !== 'team' || canManageTeam);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

      {/* Tab Navigation */}
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

      {/* Tab Content */}
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

/* ─── Profile Tab ──────────────────────────────────────────────── */

const ProfileTab: React.FC = () => {
  const { user, setUser } = useAuthStore();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwError, setPwError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await apiService.updateProfile({ fullName, email });
      if (user) setUser({ ...user, fullName: result.fullName ?? fullName, email: result.email ?? email });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save profile'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Profile Information</h2>
      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
          <input type="text" value={user?.username ?? ''} readOnly className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
          <input type="text" value={user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : ''} readOnly className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Created</label>
          <input type="text" value="—" readOnly className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>}
        </div>
      </div>
    </div>

    {/* Change Password */}
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 mt-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Change Password</h2>
      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Password</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum 8 characters</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm New Password</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
        </div>
        {pwError && <p className="text-sm text-red-600 dark:text-red-400">{pwError}</p>}
        {pwSuccess && <p className="text-sm text-green-600 dark:text-green-400">{pwSuccess}</p>}
        <div className="pt-2">
          <button
            onClick={async () => {
              setPwError('');
              setPwSuccess('');
              if (newPassword.length < 8) { setPwError('New password must be at least 8 characters'); return; }
              if (newPassword !== confirmPassword) { setPwError('Passwords do not match'); return; }
              setPwSaving(true);
              try {
                await apiService.changePassword(currentPassword, newPassword);
                setPwSuccess('Password changed successfully');
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
              } catch (err: unknown) {
                setPwError(getApiErrorMessage(err, 'Failed to change password'));
              } finally {
                setPwSaving(false);
              }
            }}
            disabled={pwSaving || !currentPassword || !newPassword || !confirmPassword}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {pwSaving ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

/* ─── Team Tab ─────────────────────────────────────────────────── */

const ROLE_OPTIONS = [
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'team_member', label: 'Team Member' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'scrum_master', label: 'Scrum Master' },
  { value: 'executive', label: 'Executive' },
  { value: 'finance_officer', label: 'Finance Officer' },
  { value: 'risk_manager', label: 'Risk Manager' },
  { value: 'pmo', label: 'PMO' },
  { value: 'ba', label: 'Business Analyst' },
  { value: 'qa', label: 'QA' },
  { value: 'tester', label: 'Tester' },
  { value: 'devops', label: 'DevOps' },
  { value: 'claude_sme', label: 'Claude SME' },
];

interface OrgMember {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

const TeamTab: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<OrgMember | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['org-members'],
    queryFn: async () => {
      return await apiService.getOrgMembers() as { organization: { id: string; name: string }; members: OrgMember[]; maxUsers: number };
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      return await apiService.inviteOrgMember(email, role);
    },
    onSuccess: (data: any) => {
      setInviteMsg({ type: 'success', text: data.message });
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    },
    onError: (err: unknown) => {
      setInviteMsg({ type: 'error', text: getApiErrorMessage(err, 'Failed to invite user') });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      return await apiService.updateOrgMemberRole(memberId, role);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      return await apiService.removeOrgMember(memberId);
    },
    onSuccess: () => {
      setConfirmRemove(null);
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    },
  });

  if (isLoading) return <div className="text-gray-500 dark:text-gray-400">Loading team…</div>;
  if (error) return <div className="text-red-500">Failed to load team members. You may not be part of an organization.</div>;

  const members = data?.members ?? [];
  const maxUsers = data?.maxUsers ?? 0;
  const orgName = data?.organization?.name ?? 'Organization';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{orgName} Team</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{members.length} / {maxUsers} members</p>
        </div>
      </div>

      {/* Invite Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Invite Member
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button
            onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
            disabled={!inviteEmail || inviteMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {inviteMutation.isPending ? 'Sending…' : 'Invite'}
          </button>
        </div>
        {inviteMsg && (
          <p className={`mt-2 text-sm ${inviteMsg.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {inviteMsg.text}
          </p>
        )}
      </div>

      {/* Members Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {members.map((m) => {
              const isMe = m.id === user?.id;
              return (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                    {m.fullName || m.username}
                    {isMe && <span className="ml-2 text-xs text-primary-600 dark:text-primary-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{m.email}</td>
                  <td className="px-4 py-3 text-sm">
                    {isMe ? (
                      <span className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300">
                        <Shield className="w-3 h-3" />
                        {ROLE_OPTIONS.find(r => r.value === m.role)?.label || m.role}
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => updateRoleMutation.mutate({ memberId: m.id, role: e.target.value })}
                        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                      >
                        {ROLE_OPTIONS.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      m.isActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      {m.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {!isMe && (
                      <button
                        onClick={() => setConfirmRemove(m)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        title="Remove member"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmRemove && (
        <ConfirmModal
          title="Remove Member"
          message={`Remove ${confirmRemove.fullName || confirmRemove.email} from the organization? They will lose access to all projects.`}
          confirmLabel="Remove"
          variant="danger"
          onConfirm={() => removeMutation.mutate(confirmRemove.id)}
          onCancel={() => setConfirmRemove(null)}
          isPending={removeMutation.isPending}
        />
      )}

      {/* Viewer Invites — invite clients as free viewers */}
      <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
        <ViewerInvitePanel />
      </div>
    </div>
  );
};

/* ─── Notifications Tab ────────────────────────────────────────── */

const NotificationsTab: React.FC = () => {
  const { user } = useAuthStore();
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [digestFrequency, setDigestFrequency] = useState<'none' | 'daily' | 'weekly'>('none');
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
      if (serverPrefs.user.notificationTypePreferences) {
        setTypePrefs((prev) => ({ ...prev, ...serverPrefs.user.notificationTypePreferences }));
      }
    }
  }, [serverPrefs]);

  const toggleCategoryChannel = (categoryKey: string, channel: 'inApp' | 'email') => {
    setTypePrefs((prev) => ({
      ...prev,
      [categoryKey]: {
        ...(prev[categoryKey] ?? { inApp: true, email: true }),
        [channel]: !(prev[categoryKey]?.[channel] ?? true),
      },
    }));
  };

  const handleSave = async () => {
    setServerSaving(true);
    try {
      await apiService.updateNotificationPreferences({
        emailNotificationsEnabled: emailEnabled,
        digestFrequency,
        typePreferences: typePrefs,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save notification prefs:', err);
    }
    setServerSaving(false);
  };

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
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Receive a summary of overdue tasks, upcoming deadlines, and unread notifications.</p>
        <select
          value={digestFrequency}
          onChange={(e) => setDigestFrequency(e.target.value as 'none' | 'daily' | 'weekly')}
          className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="none">None</option>
          <option value="daily">Daily (7:00 AM)</option>
          <option value="weekly">Weekly (Monday 7:00 AM)</option>
        </select>
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
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={serverSaving} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />
          {serverSaving ? 'Saving…' : 'Save Preferences'}
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>}
      </div>
    </div>
  );
};

/* ─── Display Tab ──────────────────────────────────────────────── */

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Fran\u00e7ais' },
  { value: 'es', label: 'Espa\u00f1ol' },
];

const DisplayTab: React.FC = () => {
  const [prefs, setPrefs] = useState<DisplayPreferences>(loadDisplayPrefs);
  const [saved, setSaved] = useState(false);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const timezones = getTimezones();

  const handleSave = async () => {
    localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(prefs));
    setLocale(prefs.language);
    try {
      await apiService.updateUserPreferences({ timezone: prefs.timezone, locale: prefs.language });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save preferences to server:', err);
    }
  };

  const viewOptions: { value: DisplayPreferences['defaultView']; label: string }[] = [
    { value: 'gantt', label: 'Gantt' },
    { value: 'kanban', label: 'Kanban' },
    { value: 'table', label: 'Table' },
    { value: 'calendar', label: 'Calendar' },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Theme</h2>
        <div className="flex gap-3">
          <button onClick={() => setPrefs((p) => ({ ...p, theme: 'light' }))} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${prefs.theme === 'light' ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
            <Sun className="w-4 h-4" /> Light
          </button>
          <button onClick={() => setPrefs((p) => ({ ...p, theme: 'dark' }))} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${prefs.theme === 'dark' ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
            <Moon className="w-4 h-4" /> Dark
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Default View</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Choose the default view when opening a project schedule.</p>
        <div className="flex flex-wrap gap-3">
          {viewOptions.map((opt) => (
            <button key={opt.value} onClick={() => setPrefs((p) => ({ ...p, defaultView: opt.value }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${prefs.defaultView === opt.value ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Sidebar</h2>
        <div className="flex gap-3">
          <button onClick={() => setPrefs((p) => ({ ...p, sidebarExpanded: true }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${prefs.sidebarExpanded ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>Expanded</button>
          <button onClick={() => setPrefs((p) => ({ ...p, sidebarExpanded: false }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${!prefs.sidebarExpanded ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>Collapsed</button>
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Time Zone</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">All dates and times will be displayed in this time zone.</p>
        <select
          value={prefs.timezone}
          onChange={(e) => setPrefs((p) => ({ ...p, timezone: e.target.value }))}
          className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 dark:text-gray-100 max-w-md w-full"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Language</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Choose your preferred language for the interface.</p>
        <div className="flex flex-wrap gap-3">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setPrefs((p) => ({ ...p, language: opt.value }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${prefs.language === opt.value ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors">
          <Save className="w-4 h-4" /> Save Preferences
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>}
      </div>
    </div>
  );
};

/* ─── API Keys Tab ─────────────────────────────────────────────── */

const ApiKeysTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['read', 'write']);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiService.listApiKeys(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; scopes: string[] }) => apiService.createApiKey(data),
    onSuccess: (result: any) => {
      setCreatedKey(result.apiKey?.key || result.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiService.revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    createMutation.mutate({ name: newKeyName.trim(), scopes: newKeyScopes });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const keys = data?.apiKeys || [];
  const isApiKeysSample: boolean = data?.sample || false;

  return (
    <div className="space-y-6">
      {isApiKeysSample && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample API Keys</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                These are sample API keys. Upgrade to a paid plan to create real API keys for external integrations, CI/CD pipelines, and AI agents.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">API Keys</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Create API keys to allow external AI agents and integrations to access your data.</p>
          </div>
          {!isApiKeysSample && (
            <button
              onClick={() => { setShowCreate(true); setCreatedKey(null); }}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create Key
            </button>
          )}
        </div>

        {/* Create Key Form */}
        {showCreate && (
          <div className="mb-6 p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20">
            {createdKey ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-medium">API key created! Copy it now — it won't be shown again.</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-700 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-mono break-all dark:text-gray-100">{createdKey}</code>
                  <button onClick={() => handleCopy(createdKey)} className="flex items-center gap-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-600 dark:text-gray-200">
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button onClick={() => { setShowCreate(false); setCreatedKey(null); }} className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700">Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Key Name</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., My AI Agent"
                    className="w-full max-w-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Scopes</label>
                  <div className="flex gap-2">
                    {['read', 'write', 'admin'].map((scope) => (
                      <button
                        key={scope}
                        onClick={() => toggleScope(scope)}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                          newKeyScopes.includes(scope) ? 'border-primary-600 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={!newKeyName.trim() || createMutation.isPending} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
                    {createMutation.isPending ? 'Creating…' : 'Create'}
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Keys List */}
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading API keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No API keys yet. Create one to get started.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {keys.map((key: any) => (
              <div key={key.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{key.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <code className="text-xs text-gray-500 dark:text-gray-400 font-mono">{key.keyPrefix}...</code>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      Scopes: {(key.scopes || []).join(', ')}
                    </span>
                    {key.lastUsedAt && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setConfirmRevokeId(key.id)}
                  className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                    key.isActive ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800' : 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }`}
                  disabled={!key.isActive}
                >
                  {key.isActive ? 'Revoke' : 'Revoked'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage Info */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Using API Keys</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Include your API key in the <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Authorization</code> header:</p>
        <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm font-mono">
          <span className="text-green-400">curl</span> -H <span className="text-yellow-300">"Authorization: Bearer kpm_your_key_here"</span> \<br />
          &nbsp;&nbsp;{window.location.origin}/api/v1/projects
        </div>
        <p className="text-xs text-gray-400 mt-3">Rate limit: 100 requests/minute per key. Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset</p>
      </div>

      {confirmRevokeId && (
        <ConfirmModal
          title="Revoke API Key"
          message="Revoke this API key? Any agents using it will lose access."
          confirmLabel="Revoke"
          isPending={revokeMutation.isPending}
          onConfirm={() => { revokeMutation.mutate(confirmRevokeId); setConfirmRevokeId(null); }}
          onCancel={() => setConfirmRevokeId(null)}
        />
      )}
    </div>
  );
};

/* ─── Webhooks Tab ─────────────────────────────────────────────── */

const WEBHOOK_EVENTS = [
  'task.created', 'task.updated', 'task.deleted',
  'project.created', 'project.updated',
  'proposal.created', 'proposal.accepted',
  'agent.scan_completed',
];

const WebhooksTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [confirmDeleteWhId, setConfirmDeleteWhId] = useState<string | null>(null);
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiService.listWebhooks(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { url: string; events: string[] }) => apiService.createWebhook(data),
    onSuccess: (result: any) => {
      setCreatedSecret(result.webhook?.secret || null);
      setNewUrl('');
      setNewEvents([]);
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteWebhook(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiService.testWebhook(id),
  });

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreate = () => {
    if (!newUrl.trim() || newEvents.length === 0) return;
    createMutation.mutate({ url: newUrl.trim(), events: newEvents });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const webhooks = data?.webhooks || [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Webhooks</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Receive HTTP POST notifications when events occur in your projects.</p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setCreatedSecret(null); }}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Webhook
          </button>
        </div>

        {/* Create Webhook Form */}
        {showCreate && (
          <div className="mb-6 p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20">
            {createdSecret ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-medium">Webhook created! Save the signing secret — it won't be shown again.</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-700 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-mono break-all dark:text-gray-100">{createdSecret}</code>
                  <button onClick={() => handleCopy(createdSecret)} className="flex items-center gap-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-600">
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => { setShowCreate(false); setCreatedSecret(null); }} className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700">Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payload URL</label>
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://your-server.com/webhook"
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Events</label>
                  <div className="flex flex-wrap gap-2">
                    {WEBHOOK_EVENTS.map((event) => (
                      <button
                        key={event}
                        onClick={() => toggleEvent(event)}
                        className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                          newEvents.includes(event) ? 'border-primary-600 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {event}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={!newUrl.trim() || newEvents.length === 0 || createMutation.isPending} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
                    {createMutation.isPending ? 'Creating…' : 'Create'}
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Webhooks List */}
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading webhooks…</p>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No webhooks configured.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {webhooks.map((wh: any) => (
              <div key={wh.id} className="py-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{wh.url}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(wh.events || []).map((e: string) => (
                        <span key={e} className="inline-block px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{e}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                      <span className={wh.isActive ? 'text-green-600' : 'text-red-500'}>{wh.isActive ? 'Active' : 'Inactive'}</span>
                      {wh.failureCount > 0 && <span className="text-amber-600">{wh.failureCount} failures</span>}
                      {wh.lastTriggeredAt && <span>Last triggered: {new Date(wh.lastTriggeredAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button onClick={() => testMutation.mutate(wh.id)} disabled={testMutation.isPending} className="text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" title="Send test ping" aria-label="Send test ping">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteWhId(wh.id)}
                      className="text-sm px-3 py-1.5 rounded-md border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhook Verification Info */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Verifying Webhooks</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Each webhook delivery includes an <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">X-Webhook-Signature</code> header (HMAC-SHA256 of the request body using your secret).</p>
        <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm font-mono">
          <span className="text-gray-500">// Verify signature (Node.js example)</span><br />
          <span className="text-blue-400">const</span> expected = crypto.createHmac(<span className="text-yellow-300">'sha256'</span>, secret)<br />
          &nbsp;&nbsp;.update(requestBody).digest(<span className="text-yellow-300">'hex'</span>);<br />
          <span className="text-blue-400">const</span> valid = signature === expected;
        </div>
      </div>

      {confirmDeleteWhId && (
        <ConfirmModal
          title="Delete Webhook"
          message="Delete this webhook? It will stop receiving events immediately."
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => { deleteMutation.mutate(confirmDeleteWhId); setConfirmDeleteWhId(null); }}
          onCancel={() => setConfirmDeleteWhId(null)}
        />
      )}
    </div>
  );
};

/* ─── Accessibility Tab ────────────────────────────────────────── */

const AccessibilityTab: React.FC = () => {
  const { prefs, updatePrefs } = useAccessibility();
  const [saved, setSaved] = useState(false);

  const handleToggle = (key: 'highContrast' | 'reducedMotion' | 'narrationEnabled') => {
    updatePrefs({ [key]: !prefs[key] });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleFontSize = (value: number) => {
    updatePrefs({ fontSize: value });
  };

  const handleSimplification = (level: 'off' | 'mild' | 'strong') => {
    updatePrefs({ simplificationLevel: level });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Visual Preferences</h2>
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">High Contrast</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Increases contrast for better readability</p>
            </div>
            <button
              type="button"
              onClick={() => handleToggle('highContrast')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                prefs.highContrast ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
              }`}
              role="switch"
              aria-checked={prefs.highContrast}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${prefs.highContrast ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Reduced Motion</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Minimizes animations and transitions</p>
            </div>
            <button
              type="button"
              onClick={() => handleToggle('reducedMotion')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                prefs.reducedMotion ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
              }`}
              role="switch"
              aria-checked={prefs.reducedMotion}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${prefs.reducedMotion ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Font Size</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Adjust the base font size across the application ({prefs.fontSize}px)</p>
        <input
          type="range"
          min={12}
          max={24}
          step={1}
          value={prefs.fontSize}
          onChange={(e) => handleFontSize(Number(e.target.value))}
          className="w-full max-w-sm accent-primary-600"
        />
        <div className="flex justify-between text-xs text-gray-400 max-w-sm mt-1">
          <span>12px</span>
          <span>18px</span>
          <span>24px</span>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Text Simplification</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">AI-generated narratives and reports can be simplified for easier reading.</p>
        <div className="flex flex-wrap gap-3">
          {(['off', 'mild', 'strong'] as const).map((level) => (
            <button
              key={level}
              onClick={() => handleSimplification(level)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                prefs.simplificationLevel === level
                  ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'
              }`}
            >
              {level === 'off' ? 'Off' : level === 'mild' ? 'Mild' : 'Strong'}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">AI Narration</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable Dashboard Narratives</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Show AI-generated plain-language summaries on dashboards</p>
          </div>
          <button
            type="button"
            onClick={() => handleToggle('narrationEnabled')}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              prefs.narrationEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
            }`}
            role="switch"
            aria-checked={prefs.narrationEnabled}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${prefs.narrationEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {saved && (
        <p className="text-sm text-green-600 dark:text-green-400">Preferences saved</p>
      )}
    </div>
  );
};

/* ─── Danger Zone Tab ──────────────────────────────────────────── */

const DangerZoneTab: React.FC = () => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteInput, setDeleteInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    try {
      const projectList = await apiService.getProjects();
      const projectExports = await Promise.all(
        projectList.map(async (project: { id: number }) => {
          try {
            return await apiService.request('get', `/exports/projects/${project.id}/export?format=json`);
          } catch {
            return { projectId: project.id, error: 'Failed to export' };
          }
        })
      );
      const data = {
        exportedAt: new Date().toISOString(),
        projects: projectExports,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pm-assistant-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (deleteInput !== 'DELETE') return;
    try {
      await apiService.deleteAccount();
      window.location.href = '/';
    } catch (err: unknown) {
      setDeleteError(getApiErrorMessage(err, 'Failed to delete account. Please try again.'));
      setShowDeleteConfirm(false);
      setDeleteInput('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Export Data</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Download a copy of all your data including projects, tasks, and settings.</p>
        <button onClick={handleExport} disabled={exporting} className="flex items-center gap-2 bg-gray-800 dark:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-900 dark:hover:bg-gray-500 transition-colors disabled:opacity-50">
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting…' : 'Export All Data'}
        </button>
        {exportError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{exportError}</p>}
      </div>
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 p-6">
        <h2 className="text-lg font-semibold text-red-900 dark:text-red-300 mb-2">Delete Account</h2>
        <p className="text-sm text-red-700 dark:text-red-400 mb-4">Permanently delete your account and all associated data. This action cannot be undone.</p>
        {deleteError && <p className="mb-3 text-sm text-red-600 dark:text-red-400 font-medium">{deleteError}</p>}
        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition-colors">
            <Trash2 className="w-4 h-4" /> Delete Account
          </button>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-300">Are you absolutely sure?</p>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-1">This will permanently delete your account, all projects, tasks, and data. This action is irreversible.</p>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-2">Type <span className="font-mono font-bold">DELETE</span> to confirm:</p>
                  <input type="text" value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} placeholder="Type DELETE to confirm" className="mt-2 w-full max-w-xs rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleDelete} disabled={deleteInput !== 'DELETE'} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <Trash2 className="w-4 h-4" /> Permanently Delete
              </button>
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

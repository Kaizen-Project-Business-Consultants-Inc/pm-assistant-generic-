import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';
import {
  Users,
  Activity,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  KeyRound,
  Check,
  TrendingUp,
  FolderKanban,
  Cpu,
  DollarSign,
  Building,
  Database,
  CheckCircle,
  XCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AdminUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  is_active: number | boolean;
  created_at: string;
  last_login_at: string | null;
  subscription_tier: string;
  project_count: number;
}

interface AdminStats {
  total_users: number;
  active_users: number;
  total_projects: number;
  total_ai_calls: number;
  total_ai_cost: number;
  total_tokens: number;
}

interface AiUsageRow {
  username: string;
  email: string;
  full_name: string;
  call_count: number;
  total_tokens: number;
  total_cost: number;
  last_used: string | null;
}

interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  db_name: string;
  owner_name: string | null;
  owner_email: string | null;
  user_count: number;
  max_users: number;
  subscription_tier: string;
  subscription_status: string;
  is_active: number | boolean;
  is_provisioned: number | boolean;
  created_at: string;
}

type Tab = 'users' | 'system' | 'ai-usage' | 'tenants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(date: string | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtCost(cost: number) {
  return `$${Number(cost).toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5 flex items-start gap-4">
      <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------
function UsersTab() {
  const queryClient = useQueryClient();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiService.getAdminUsers(),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiService.setAdminUserStatus(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => apiService.adminResetUserPassword(id),
    onSuccess: (res) => {
      const token = res.resetToken;
      setCopiedToken(token);
      navigator.clipboard.writeText(token).catch(() => { /* Clipboard API may be unavailable */ });
      setTimeout(() => setCopiedToken(null), 4000);
    },
  });

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading users…</div>;
  if (error) return <div className="text-center py-12 text-red-500">Failed to load users.</div>;

  const allUsers: AdminUser[] = data?.users ?? [];
  const users = searchQuery
    ? allUsers.filter(u => {
        const q = searchQuery.toLowerCase();
        return u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
      })
    : allUsers;

  return (
    <div className="overflow-x-auto">
      {/* Search bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search users by name, email, or role..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 dark:placeholder-gray-500"
        />
        {searchQuery && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{users.length} of {allUsers.length} users</p>
        )}
      </div>
      {copiedToken && (
        <div className="mb-4 flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800 dark:text-green-300">
          <Check className="w-4 h-4 flex-shrink-0" />
          <span>Reset token copied: <code className="font-mono text-xs break-all">{copiedToken}</code></span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <th className="pb-3 pr-4">User</th>
            <th className="pb-3 pr-4">Role</th>
            <th className="pb-3 pr-4">Signed up</th>
            <th className="pb-3 pr-4">Last login</th>
            <th className="pb-3 pr-4 text-right">Projects</th>
            <th className="pb-3 text-center">Status</th>
            <th className="pb-3 pl-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {users.map((u: AdminUser) => {
            const active = Boolean(u.is_active);
            return (
              <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900 dark:text-white">{u.full_name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{u.email}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">@{u.username}</div>
                </td>
                <td className="py-3 pr-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    u.role === 'admin'
                      ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{fmt(u.created_at)}</td>
                <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{fmt(u.last_login_at)}</td>
                <td className="py-3 pr-4 text-right font-medium text-gray-700 dark:text-gray-200">{u.project_count}</td>
                <td className="py-3 text-center">
                  <button
                    onClick={() => toggleStatus.mutate({ id: u.id, active: !active })}
                    disabled={toggleStatus.isPending}
                    title={active ? 'Deactivate user' : 'Activate user'}
                    className="inline-flex items-center gap-1 text-xs"
                  >
                    {active ? (
                      <ToggleRight className="w-6 h-6 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                    )}
                    <span className={active ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </button>
                </td>
                <td className="py-3 pl-4">
                  <button
                    onClick={() => resetPassword.mutate(u.id)}
                    disabled={resetPassword.isPending}
                    title="Generate password reset token"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 border border-amber-200 dark:border-amber-800 transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Reset PW
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System tab
// ---------------------------------------------------------------------------
function SystemTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiService.getAdminStats(),
  });

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading stats…</div>;
  if (error) return <div className="text-center py-12 text-red-500">Failed to load stats.</div>;

  const s: AdminStats | undefined = data?.stats;
  if (!s) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <StatCard icon={Users} label="Total Users" value={s.total_users} color="bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400" />
      <StatCard icon={Activity} label="Active Users" value={s.active_users} color="bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400" />
      <StatCard icon={FolderKanban} label="Total Projects" value={s.total_projects} color="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" />
      <StatCard icon={Cpu} label="AI API Calls" value={Number(s.total_ai_calls).toLocaleString()} color="bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400" />
      <StatCard icon={TrendingUp} label="Total Tokens" value={Number(s.total_tokens).toLocaleString()} color="bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400" />
      <StatCard icon={DollarSign} label="Total AI Cost" value={fmtCost(s.total_ai_cost)} color="bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Usage tab
// ---------------------------------------------------------------------------
type AiSortField = 'call_count' | 'total_tokens' | 'total_cost';

function AiUsageTab() {
  const [sortField, setSortField] = useState<AiSortField>('total_cost');
  const [sortAsc, setSortAsc] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-ai-usage'],
    queryFn: () => apiService.getAdminAiUsage(),
  });

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading AI usage…</div>;
  if (error) return <div className="text-center py-12 text-red-500">Failed to load AI usage.</div>;

  const rawRows: AiUsageRow[] = data?.usage ?? [];
  const rows = [...rawRows].sort((a, b) => {
    const diff = Number(a[sortField]) - Number(b[sortField]);
    return sortAsc ? diff : -diff;
  });

  const toggleSort = (field: AiSortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const sortArrow = (field: AiSortField) => sortField === field ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <th className="pb-3 pr-4">User</th>
            <th className="pb-3 pr-4 text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none" onClick={() => toggleSort('call_count')}>Calls{sortArrow('call_count')}</th>
            <th className="pb-3 pr-4 text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none" onClick={() => toggleSort('total_tokens')}>Tokens{sortArrow('total_tokens')}</th>
            <th className="pb-3 pr-4 text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none" onClick={() => toggleSort('total_cost')}>Cost{sortArrow('total_cost')}</th>
            <th className="pb-3">Last Used</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r: AiUsageRow) => (
            <tr key={r.username} className="hover:bg-gray-50 dark:hover:bg-gray-700">
              <td className="py-3 pr-4">
                <div className="font-medium text-gray-900 dark:text-white">{r.full_name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{r.email}</div>
              </td>
              <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-200">{Number(r.call_count).toLocaleString()}</td>
              <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-200">{Number(r.total_tokens).toLocaleString()}</td>
              <td className="py-3 pr-4 text-right font-medium text-gray-900 dark:text-white">{fmtCost(r.total_cost)}</td>
              <td className="py-3 text-gray-500 dark:text-gray-400">{fmt(r.last_used)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tenants tab
// ---------------------------------------------------------------------------
function TenantsTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: () => apiService.getAdminTenants(),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiService.updateAdminTenant(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-tenants'] }),
  });

  const provision = useMutation({
    mutationFn: (id: string) => apiService.provisionTenant(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-tenants'] }),
  });

  const runMigrations = useMutation({
    mutationFn: (id: string) => apiService.runTenantMigrations(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    },
  });

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading tenants…</div>;
  if (error) return <div className="text-center py-12 text-red-500">Failed to load tenants.</div>;

  const tenants: AdminTenant[] = data?.tenants ?? [];

  if (tenants.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <Building className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No organizations found. Multi-tenant mode may not be enabled.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <th className="pb-3 pr-4">Organization</th>
            <th className="pb-3 pr-4">Owner</th>
            <th className="pb-3 pr-4 text-right">Users</th>
            <th className="pb-3 pr-4">Tier</th>
            <th className="pb-3 text-center">Status</th>
            <th className="pb-3 text-center">Provisioned</th>
            <th className="pb-3 pr-4">Created</th>
            <th className="pb-3 pl-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {tenants.map((t: AdminTenant) => {
            const active = Boolean(t.is_active);
            const provisioned = Boolean(t.is_provisioned);
            return (
              <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900 dark:text-white">{t.name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">{t.slug}</div>
                </td>
                <td className="py-3 pr-4">
                  {t.owner_name ? (
                    <>
                      <div className="text-gray-900 dark:text-white">{t.owner_name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t.owner_email}</div>
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right font-medium text-gray-700 dark:text-gray-200">
                  {Number(t.user_count)} / {t.max_users}
                </td>
                <td className="py-3 pr-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    t.subscription_tier === 'enterprise'
                      ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300'
                      : t.subscription_tier === 'sme'
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                      : t.subscription_tier === 'consultant'
                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'
                  }`}>
                    {t.subscription_tier}
                  </span>
                </td>
                <td className="py-3 text-center">
                  <button
                    onClick={() => toggleActive.mutate({ id: t.id, isActive: !active })}
                    disabled={toggleActive.isPending}
                    title={active ? 'Deactivate tenant' : 'Activate tenant'}
                    className="inline-flex items-center gap-1 text-xs"
                  >
                    {active ? (
                      <ToggleRight className="w-6 h-6 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                    )}
                    <span className={active ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </button>
                </td>
                <td className="py-3 text-center">
                  {provisioned ? (
                    <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />
                  ) : (
                    <button
                      onClick={() => provision.mutate(t.id)}
                      disabled={provision.isPending}
                      title="Retry provisioning"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-800 transition-colors mx-auto"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Retry
                    </button>
                  )}
                </td>
                <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{fmt(t.created_at)}</td>
                <td className="py-3 pl-4">
                  {provisioned && (
                    <button
                      onClick={() => runMigrations.mutate(t.id)}
                      disabled={runMigrations.isPending}
                      title="Run pending tenant migrations"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 border border-blue-200 dark:border-blue-800 transition-colors"
                    >
                      <Database className="w-3.5 h-3.5" />
                      Migrate
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function AdminPage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('users');

  if (user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'system', label: 'System', icon: Activity },
    { id: 'ai-usage', label: 'AI Usage', icon: Cpu },
    { id: 'tenants', label: 'Tenants', icon: Building },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Panel</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Platform management and monitoring</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'system' && <SystemTab />}
        {activeTab === 'ai-usage' && <AiUsageTab />}
        {activeTab === 'tenants' && <TenantsTab />}
      </div>
    </div>
  );
}

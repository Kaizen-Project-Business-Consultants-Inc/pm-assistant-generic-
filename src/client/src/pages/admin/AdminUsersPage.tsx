import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { tierBadgeClass } from '../../constants/branding';
import { AdminPageWrapper } from './AdminPageWrapper';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import {
  ToggleLeft,
  ToggleRight,
  KeyRound,
  Check,
  Unlock,
  Search,
  Users,
  UserCheck,
  UserX,
  Pencil,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  History,
  AlertTriangle,
} from 'lucide-react';

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
  subscription_status: string | null;
  subscription_period_end: string | null;
  project_count: number;
  email_verified: number | boolean;
  has_pending_login: number | boolean;
  login_verification_expires: string | null;
  ai_monthly_token_budget: number | null;
  ai_tokens_used: number;
  ai_tier_budget: number;
  organization_id: string | null;
  organization_name: string | null;
}

interface SubscriptionEvent {
  id: string;
  event_type: string;
  previous_tier: string | null;
  new_tier: string | null;
  amount_cents: number | null;
  created_at: string;
}

type SortKey = 'full_name' | 'role' | 'subscription_tier' | 'subscription_status' | 'created_at' | 'login_status' | 'last_login_at' | 'project_count' | 'ai_usage' | 'organization_name' | 'is_active';
type SortDir = 'asc' | 'desc';

function fmt(date: string | null) {
  if (!date) return '\u2014';
  return new Date(date).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function getLoginStatusOrder(u: AdminUser): number {
  const hasPending = Boolean(u.has_pending_login);
  const expired = hasPending && u.login_verification_expires && new Date(u.login_verification_expires) < new Date();
  if (expired) return 0; // most urgent
  if (hasPending) return 1;
  if (!Boolean(u.email_verified)) return 2;
  return 3; // verified = least urgent
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
  project_manager: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  executive: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300',
  pmo: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-300',
};

const SUB_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  trialing: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  past_due: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  canceled: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};

const EVENT_LABELS: Record<string, string> = {
  subscription_created: 'Created',
  tier_changed: 'Tier Change',
  subscription_renewed: 'Renewed',
  subscription_canceled: 'Canceled',
  payment_failed: 'Payment Failed',
  payment_succeeded: 'Payment OK',
  trial_started: 'Trial Start',
  trial_expired: 'Trial Expired',
  topup_purchased: 'Top-up',
};

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [subStatusFilter, setSubStatusFilter] = useState('');
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [toggleConfirm, setToggleConfirm] = useState<{ user: any; active: boolean; message: string } | null>(null);
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const [historyUserName, setHistoryUserName] = useState('');
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['admin-user-sub-events', historyUserId],
    queryFn: () => apiService.getAdminUserSubscriptionEvents(historyUserId!),
    enabled: !!historyUserId,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiService.getAdminUsers(),
  });

  const allUsers: AdminUser[] = data?.users ?? [];

  // Derive unique values for filter dropdowns
  const roles = useMemo(() => {
    const set = new Set(allUsers.map(u => u.role));
    return Array.from(set).sort();
  }, [allUsers]);

  const tiers = useMemo(() => {
    const set = new Set(allUsers.map(u => u.subscription_tier || 'trial'));
    return Array.from(set).sort();
  }, [allUsers]);

  // Filter
  const filtered = useMemo(() => {
    let result = allUsers;
    if (roleFilter) result = result.filter(u => u.role === roleFilter);
    if (tierFilter) result = result.filter(u => (u.subscription_tier || 'trial') === tierFilter);
    if (statusFilter === 'active') result = result.filter(u => Boolean(u.is_active));
    if (statusFilter === 'inactive') result = result.filter(u => !Boolean(u.is_active));
    if (subStatusFilter) result = result.filter(u => (u.subscription_status || '') === subStatusFilter);
    if (searchText) {
      const q = searchText.toLowerCase();
      result = result.filter(u =>
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.organization_name || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [allUsers, roleFilter, tierFilter, statusFilter, subStatusFilter, searchText]);

  // Sort
  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortKey) {
        case 'full_name': return dir * a.full_name.localeCompare(b.full_name);
        case 'role': return dir * a.role.localeCompare(b.role);
        case 'subscription_tier': return dir * (a.subscription_tier || 'trial').localeCompare(b.subscription_tier || 'trial');
        case 'subscription_status': return dir * (a.subscription_status || '').localeCompare(b.subscription_status || '');
        case 'created_at': return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        case 'last_login_at': {
          const aT = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
          const bT = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
          return dir * (aT - bT);
        }
        case 'login_status': return dir * (getLoginStatusOrder(a) - getLoginStatusOrder(b));
        case 'project_count': return dir * (a.project_count - b.project_count);
        case 'ai_usage': {
          const aPct = a.ai_tier_budget > 0 ? a.ai_tokens_used / a.ai_tier_budget : 0;
          const bPct = b.ai_tier_budget > 0 ? b.ai_tokens_used / b.ai_tier_budget : 0;
          return dir * (aPct - bPct);
        }
        case 'organization_name': return dir * (a.organization_name || '').localeCompare(b.organization_name || '');
        case 'is_active': return dir * (Number(Boolean(a.is_active)) - Number(Boolean(b.is_active)));
        default: return 0;
      }
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' || key === 'last_login_at' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  }

  // Summary stats
  const totalUsers = allUsers.length;
  const activeUsers = allUsers.filter(u => Boolean(u.is_active)).length;
  const inactiveUsers = totalUsers - activeUsers;

  const toggleStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiService.setAdminUserStatus(id, active),
    onSuccess: () => {
      setDeactivateError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Failed to update user status';
      setDeactivateError(msg);
      setTimeout(() => setDeactivateError(null), 8000);
    },
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => apiService.adminResetUserPassword(id),
    onSuccess: (res) => {
      const token = res.resetToken;
      setCopiedToken(token);
      navigator.clipboard.writeText(token).catch(() => {});
      setTimeout(() => setCopiedToken(null), 4000);
    },
  });

  const clearLoginToken = useMutation({
    mutationFn: (id: string) => apiService.adminClearLoginToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const updateBudget = useMutation({
    mutationFn: ({ id, budget }: { id: string; budget: number | null }) =>
      apiService.updateAdminUserBudget(id, budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setEditingBudgetId(null);
    },
  });

  function handleBudgetSave(userId: string) {
    const trimmed = budgetInput.trim();
    if (trimmed === '') {
      updateBudget.mutate({ id: userId, budget: null });
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 0) {
        updateBudget.mutate({ id: userId, budget: num });
      }
    }
  }

  return (
    <AdminPageWrapper title="Users" subtitle="Manage platform users">
      {isLoading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading users…</div>}
      {error && <div className="text-center py-12 text-red-500">Failed to load users.</div>}
      {!isLoading && !error && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total Users</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{totalUsers}</p>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center">
                <UserCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Active</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{activeUsers}</p>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-400 flex items-center justify-center">
                <UserX className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Inactive</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{inactiveUsers}</p>
              </div>
            </div>
          </div>

          {/* Search & filter bar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="Search name, email, username, org..."
                className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400"
              />
            </div>

            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              <option value="">All roles</option>
              {roles.map(r => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>

            <select
              value={tierFilter}
              onChange={e => setTierFilter(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              <option value="">All tiers</option>
              {tiers.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <select
              value={subStatusFilter}
              onChange={e => setSubStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              <option value="">All subscriptions</option>
              <option value="active">Sub: Active</option>
              <option value="trialing">Sub: Trialing</option>
              <option value="past_due">Sub: Past Due</option>
              <option value="canceled">Sub: Canceled</option>
            </select>

            <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
              Showing {sorted.length} of {totalUsers}
            </span>
          </div>

          {deactivateError && (
            <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{deactivateError}</span>
              <button onClick={() => setDeactivateError(null)} className="ml-auto text-red-400 hover:text-red-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {copiedToken && (
            <div className="mb-4 flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800 dark:text-green-300">
              <Check className="w-4 h-4 flex-shrink-0" />
              <span>Reset token copied: <code className="font-mono text-xs break-all">{copiedToken}</code></span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('full_name')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      User <SortIcon col="full_name" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('role')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Role <SortIcon col="role" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('subscription_tier')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Tier <SortIcon col="subscription_tier" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('subscription_status')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Sub Status <SortIcon col="subscription_status" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">Period End</th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('organization_name')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Organization <SortIcon col="organization_name" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('created_at')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Signed up <SortIcon col="created_at" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('login_status')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Login status <SortIcon col="login_status" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('last_login_at')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Last login <SortIcon col="last_login_at" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3 text-right">
                    <button onClick={() => handleSort('project_count')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 ml-auto">
                      Projects <SortIcon col="project_count" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">
                    <button onClick={() => handleSort('ai_usage')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      AI Usage <SortIcon col="ai_usage" />
                    </button>
                  </th>
                  <th className="pb-3 pr-3">AI Budget</th>
                  <th className="pb-3 pr-3 text-center">
                    <button onClick={() => handleSort('is_active')} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                      Status <SortIcon col="is_active" />
                    </button>
                  </th>
                  <th className="pb-3 pl-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {sorted.map((u: AdminUser) => {
                  const active = Boolean(u.is_active);
                  const hasPendingLogin = Boolean(u.has_pending_login);
                  const loginExpired = hasPendingLogin && u.login_verification_expires && new Date(u.login_verification_expires) < new Date();
                  const emailVerified = Boolean(u.email_verified);
                  const roleColor = ROLE_COLORS[u.role] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
                  const tierColor = tierBadgeClass(u.subscription_tier || 'trial');
                  const effectiveBudget = u.ai_monthly_token_budget ?? u.ai_tier_budget;
                  const usagePct = effectiveBudget > 0 ? Math.round((Number(u.ai_tokens_used) / effectiveBudget) * 100) : 0;
                  const usageBarColor = usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

                  return (
                    <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-3 pr-3">
                        <div className="font-medium text-gray-900 dark:text-white">{u.full_name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{u.email}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">@{u.username}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleColor}`}>
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${tierColor}`}>
                          {u.subscription_tier || 'trial'}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        {u.subscription_status ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SUB_STATUS_COLORS[u.subscription_status] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                            {u.subscription_status.replace('_', ' ')}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 text-xs italic">none</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-gray-600 dark:text-gray-300 whitespace-nowrap text-xs">
                        {fmt(u.subscription_period_end)}
                      </td>
                      <td className="py-3 pr-3 text-gray-600 dark:text-gray-300 text-xs">
                        {u.organization_name || <span className="text-gray-400 dark:text-gray-500 italic">none</span>}
                      </td>
                      <td className="py-3 pr-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmt(u.created_at)}</td>
                      <td className="py-3 pr-3">
                        {loginExpired ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300">Expired token</span>
                        ) : hasPendingLogin ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">Pending login</span>
                        ) : !emailVerified ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">Unverified</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">Verified</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmt(u.last_login_at)}</td>
                      <td className="py-3 pr-3 text-right font-medium text-gray-700 dark:text-gray-200">{u.project_count}</td>
                      <td className="py-3 pr-3">
                        <div className="w-28">
                          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                            <span>{formatTokens(Number(u.ai_tokens_used))}</span>
                            <span>{usagePct}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${usageBarColor}`} style={{ width: `${Math.min(usagePct, 100)}%` }} />
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            of {formatTokens(effectiveBudget)}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        {editingBudgetId === u.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={budgetInput}
                              onChange={e => setBudgetInput(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleBudgetSave(u.id); if (e.key === 'Escape') setEditingBudgetId(null); }}
                              placeholder="tier default"
                              className="w-24 px-1.5 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                              autoFocus
                            />
                            <button onClick={() => handleBudgetSave(u.id)} className="text-emerald-600 hover:text-emerald-700" title="Save" aria-label="Save">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setEditingBudgetId(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Cancel" aria-label="Cancel">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingBudgetId(u.id); setBudgetInput(u.ai_monthly_token_budget != null ? String(u.ai_monthly_token_budget) : ''); }}
                            className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
                            title="Click to edit AI budget"
                          >
                            {u.ai_monthly_token_budget != null ? (
                              <span className="font-mono">{u.ai_monthly_token_budget.toLocaleString()}</span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-500 italic">tier default</span>
                            )}
                            <Pencil className="w-3 h-3 opacity-50" />
                          </button>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-center">
                        <button
                          onClick={() => {
                            if (active) {
                              const hasSub = u.subscription_status && ['active', 'trialing', 'past_due'].includes(u.subscription_status);
                              const msg = hasSub
                                ? `${u.full_name || u.email} has an active subscription (${u.subscription_status}). Cancel their Stripe subscription first before deactivating. Proceed anyway?`
                                : `Deactivate ${u.full_name || u.email}? They will be unable to log in.`;
                              setToggleConfirm({ user: u, active: !active, message: msg });
                            } else {
                              toggleStatus.mutate({ id: u.id, active: !active });
                            }
                          }}
                          disabled={toggleStatus.isPending}
                          title={active ? 'Deactivate user' : 'Activate user'}
                          className="inline-flex items-center gap-1 text-xs"
                        >
                          {active ? (
                            <ToggleRight className="w-6 h-6 text-green-500" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                          )}
                          <span className={active ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}>
                            {active ? 'Active' : 'Inactive'}
                          </span>
                        </button>
                      </td>
                      <td className="py-3 pl-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => resetPassword.mutate(u.id)}
                            disabled={resetPassword.isPending}
                            title="Generate password reset token"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800 transition-colors"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Reset PW
                          </button>
                          <button
                            onClick={() => { setHistoryUserId(u.id); setHistoryUserName(u.full_name); }}
                            title="View subscription history"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 transition-colors"
                          >
                            <History className="w-3.5 h-3.5" />
                            History
                          </button>
                          {hasPendingLogin && (
                            <button
                              onClick={() => clearLoginToken.mutate(u.id)}
                              disabled={clearLoginToken.isPending}
                              title="Clear login verification token so user can retry login"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 border border-blue-200 dark:border-blue-800 transition-colors"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              Unlock
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-gray-500 dark:text-gray-400">No users match your filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Subscription History Modal */}
      {historyUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHistoryUserId(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Subscription History &mdash; {historyUserName}</h3>
              <button onClick={() => setHistoryUserId(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {historyLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading subscription history…</p>}
              {historyData?.events?.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500">No subscription events found.</p>}
              {historyData?.events?.map((ev: SubscriptionEvent) => (
                <div key={ev.id} className="flex items-start gap-3 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                  <div className="flex-shrink-0 mt-0.5 w-2 h-2 rounded-full bg-primary-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">
                      {EVENT_LABELS[ev.event_type] || ev.event_type}
                    </p>
                    {ev.previous_tier && ev.new_tier && ev.previous_tier !== ev.new_tier && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">{ev.previous_tier} → {ev.new_tier}</p>
                    )}
                    {ev.amount_cents != null && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">${(ev.amount_cents / 100).toFixed(2)}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmt(ev.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {toggleConfirm && (
        <ConfirmModal
          title="Deactivate User"
          message={toggleConfirm.message}
          confirmLabel="Deactivate"
          variant="warning"
          isPending={toggleStatus.isPending}
          onConfirm={() => { toggleStatus.mutate({ id: toggleConfirm.user.id, active: toggleConfirm.active }); setToggleConfirm(null); }}
          onCancel={() => setToggleConfirm(null)}
        />
      )}
    </AdminPageWrapper>
  );
}

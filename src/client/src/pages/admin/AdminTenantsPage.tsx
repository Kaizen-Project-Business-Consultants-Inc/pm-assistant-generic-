import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';
import {
  Building,
  Database,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
  XCircle,
} from 'lucide-react';

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

function fmt(date: string | null) {
  if (!date) return '\u2014';
  return new Date(date).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function AdminTenantsPage() {
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

  return (
    <AdminPageWrapper title="Tenants" subtitle="Multi-tenant organization management">
      {isLoading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading tenants…</div>}
      {error && <div className="text-center py-12 text-red-500">Failed to load tenants.</div>}
      {!isLoading && !error && (() => {
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
                          <span className="text-gray-400">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium text-gray-700 dark:text-gray-200">
                        {Number(t.user_count)} / {t.max_users}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          t.subscription_tier === 'enterprise'
                            ? 'bg-purple-100 text-purple-800'
                            : t.subscription_tier === 'sme'
                            ? 'bg-blue-100 text-blue-800'
                            : t.subscription_tier === 'consultant_pro'
                            ? 'bg-amber-100 text-amber-800'
                            : t.subscription_tier === 'consultant_basic'
                            ? 'bg-yellow-100 text-yellow-800'
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
      })()}
    </AdminPageWrapper>
  );
}

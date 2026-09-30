import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SupportVisitDialog } from '../../components/admin/SupportVisitDialog';
import { apiService } from '../../services/api';
import { tierBadgeClass } from '../../constants/branding';
import { AdminPageWrapper } from './AdminPageWrapper';
import {
  Building,
  Database,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
  XCircle,
  Eye,
} from 'lucide-react';
import { formatCalendarDate } from '../../utils/dateUtils';

/** As GET /api/v1/admin/tenants sends it (camelCase). The page used to read snake_case names
 *  that never existed, so every company showed as Inactive / not provisioned (found 2026-09-30). */
export interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  dbName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  userCount: number;
  maxUsers: number;
  subscriptionTier: string;
  subscriptionStatus: string;
  isActive: number | boolean;
  isProvisioned: number | boolean;
  createdAt: string;
}

function fmt(date: string | null) {
  if (!date) return '\u2014';
  return formatCalendarDate(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }, 'en-CA');
}

export function AdminTenantsPage() {
  const queryClient = useQueryClient();
  const [supportFor, setSupportFor] = useState<{ id: string; name: string } | null>(null);

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
                  const active = Boolean(t.isActive);
                  const provisioned = Boolean(t.isProvisioned);
                  return (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="py-3 pr-4">
                        <div className="font-medium text-gray-900 dark:text-white">{t.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{t.slug}</div>
                      </td>
                      <td className="py-3 pr-4">
                        {t.ownerName ? (
                          <>
                            <div className="text-gray-900 dark:text-white">{t.ownerName}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{t.ownerEmail}</div>
                          </>
                        ) : (
                          <span className="text-gray-500">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium text-gray-700 dark:text-gray-200">
                        {Number(t.userCount)} / {t.maxUsers}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tierBadgeClass(t.subscriptionTier)}`}>
                          {t.subscriptionTier}
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
                            <ToggleLeft className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                          )}
                          <span className={active ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'}>
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
                      <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{fmt(t.createdAt)}</td>
                      <td className="py-3 pl-4 whitespace-nowrap space-x-2">
                        {provisioned && active && (
                          <button
                            onClick={() => setSupportFor({ id: t.id, name: t.name })}
                            title="Look at this company's workspace, read-only (recorded in their audit trail)"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-amber-400 text-amber-950 hover:bg-amber-300 border border-amber-600"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View as support
                          </button>
                        )}
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
      {supportFor && <SupportVisitDialog company={supportFor} onClose={() => setSupportFor(null)} />}
    </AdminPageWrapper>
  );
}

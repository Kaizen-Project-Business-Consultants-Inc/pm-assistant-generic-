import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';
import { DollarSign, Users, TrendingUp, TrendingDown } from 'lucide-react';

interface TierCount {
  tier: string;
  count: number;
}

interface TrendPoint {
  month: string;
  mrr: number;
  topups: number;
}

interface RecentEvent {
  id: string;
  user_id: string;
  event_type: string;
  previous_tier: string | null;
  new_tier: string | null;
  amount_cents: number | null;
  created_at: string;
  full_name?: string;
  email?: string;
}

interface RevenueData {
  mrr: number;
  arr: number;
  totalActiveSubscribers: number;
  subscribersByTier: TierCount[];
  newThisMonth: number;
  churnedThisMonth: number;
  topUpRevenueThisMonth: number;
  trialConversionRate: number;
  churnRate: number;
  revenueTrend: TrendPoint[];
  recentEvents: RecentEvent[];
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  subscription_created: { label: 'New Sub', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
  tier_changed: { label: 'Tier Change', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  subscription_renewed: { label: 'Renewed', color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  subscription_canceled: { label: 'Canceled', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
  payment_failed: { label: 'Payment Failed', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
  payment_succeeded: { label: 'Payment OK', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
  trial_started: { label: 'Trial Start', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
  trial_expired: { label: 'Trial Expired', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  topup_purchased: { label: 'Top-up', color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300' },
};

export function AdminRevenuePage() {
  const { data, isLoading, error } = useQuery<RevenueData>({
    queryKey: ['admin-revenue'],
    queryFn: () => apiService.getAdminRevenue(),
  });

  return (
    <AdminPageWrapper title="Revenue" subtitle="Subscription metrics and financial health">
      {isLoading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading revenue data…</div>}
      {error && <div className="text-center py-12 text-red-500">Failed to load revenue data.</div>}
      {data && (
        <>
          {/* Top stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard icon={DollarSign} iconBg="bg-green-500" label="MRR" value={`$${data.mrr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <StatCard icon={Users} iconBg="bg-blue-500" label="Active Subscribers" value={String(data.totalActiveSubscribers)} />
            <StatCard icon={TrendingUp} iconBg="bg-purple-500" label="New This Month" value={String(data.newThisMonth)} />
            <StatCard icon={TrendingDown} iconBg="bg-red-500" label="Churned This Month" value={String(data.churnedThisMonth)} />
          </div>

          {/* Second row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Subscribers by tier */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Subscribers by Tier</h3>
              {data.subscribersByTier.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No active subscribers yet.</p>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                      <th className="text-left pb-2">Tier</th>
                      <th className="text-right pb-2">Count</th>
                      <th className="text-right pb-2">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.subscribersByTier.map(t => (
                      <tr key={t.tier} className="border-b border-gray-50 dark:border-gray-700/50">
                        <td className="py-2 capitalize font-medium text-gray-700 dark:text-gray-200">{t.tier || 'free'}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-300">{t.count}</td>
                        <td className="py-2 text-right text-gray-500 dark:text-gray-400">
                          {data.totalActiveSubscribers > 0 ? Math.round((Number(t.count) / data.totalActiveSubscribers) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>

            {/* Key metrics */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Key Metrics</h3>
              <div className="space-y-3">
                <MetricRow label="ARR" value={`$${data.arr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                <MetricRow label="Trial Conversion (90d)" value={`${(data.trialConversionRate * 100).toFixed(1)}%`} />
                <MetricRow label="Churn Rate (this month)" value={`${(data.churnRate * 100).toFixed(1)}%`} />
                <MetricRow label="Top-up Revenue (this month)" value={`$${data.topUpRevenueThisMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
              </div>
            </div>
          </div>

          {/* Revenue trend */}
          {data.revenueTrend.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Revenue Trend (12 months)</h3>
              <div className="flex items-end gap-1 h-32">
                {data.revenueTrend.map(pt => {
                  const maxVal = Math.max(...data.revenueTrend.map(r => r.mrr + r.topups), 1);
                  const totalH = ((pt.mrr + pt.topups) / maxVal) * 100;
                  const mrrH = (pt.mrr / maxVal) * 100;
                  return (
                    <div key={pt.month} className="flex-1 flex flex-col items-center gap-0.5" title={`${pt.month}: MRR $${pt.mrr.toFixed(2)}, Top-ups $${pt.topups.toFixed(2)}`}>
                      <div className="w-full relative" style={{ height: `${totalH}%`, minHeight: totalH > 0 ? '2px' : '0' }}>
                        <div className="absolute bottom-0 w-full bg-cyan-400 dark:bg-cyan-600 rounded-t" style={{ height: `${totalH > 0 ? ((pt.topups / (pt.mrr + pt.topups)) * 100) : 0}%` }} />
                        <div className="absolute bottom-0 w-full bg-green-500 dark:bg-green-600 rounded-t" style={{ height: `${mrrH > 0 ? (mrrH / totalH * 100) : 0}%` }} />
                      </div>
                      <span className="text-[9px] text-gray-400 dark:text-gray-500 truncate w-full text-center">{pt.month.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full" /> MRR</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cyan-400 rounded-full" /> Top-ups</span>
              </div>
            </div>
          )}

          {/* Recent events */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Recent Events</h3>
            {data.recentEvents.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No subscription events yet.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {data.recentEvents.map(ev => {
                  const evInfo = EVENT_LABELS[ev.event_type] || { label: ev.event_type, color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' };
                  return (
                    <div key={ev.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${evInfo.color}`}>
                        {evInfo.label}
                      </span>
                      <span className="text-gray-700 dark:text-gray-200 truncate flex-1">
                        {ev.full_name || ev.email || ev.user_id}
                        {ev.previous_tier && ev.new_tier && ev.previous_tier !== ev.new_tier && (
                          <span className="text-gray-400 dark:text-gray-500"> ({ev.previous_tier} → {ev.new_tier})</span>
                        )}
                        {ev.amount_cents != null && (
                          <span className="text-gray-400 dark:text-gray-500"> ${(ev.amount_cents / 100).toFixed(2)}</span>
                        )}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmt(ev.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </AdminPageWrapper>
  );
}

function StatCard({ icon: Icon, iconBg, label, value }: { icon: React.ElementType; iconBg: string; label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
      <span className="text-sm font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

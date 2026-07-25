import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';
import { Brain, Zap, DollarSign, BarChart3, Activity, MessageSquare, GitBranch, ArrowRight } from 'lucide-react';

interface AiUsageRow {
  username: string;
  email: string;
  full_name: string;
  call_count: number;
  total_tokens: number;
  total_cost: number;
  last_used: string | null;
}

interface DailyPoint {
  day: string;
  calls: number;
  cost: number;
}

interface AiUsageData {
  usage: AiUsageRow[];
  summary: { total_calls: number; total_tokens: number; total_cost: number };
  dailyTrend: DailyPoint[];
}

interface AgentUsageRow {
  agent_id: string;
  runs: number;
  unique_projects: number;
  first_run: string;
  last_run: string;
}

interface AgentPattern {
  first_agent: string;
  second_agent: string;
  frequency: number;
}

interface FeatureUsageRow {
  action: string;
  call_count: number;
  unique_users: number;
}

interface UsageAnalyticsData {
  agentUsage: AgentUsageRow[];
  agentPatterns: AgentPattern[];
  featureUsage: FeatureUsageRow[];
  chatStats: { conversations: number; messages: number; active_chatters: number };
  dailyAgentRuns: { day: string; runs: number }[];
  period: { days: number; since: string };
}

const PERIODS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'All time', value: 0 },
] as const;

function fmt(date: string | null) {
  if (!date) return '\u2014';
  return new Date(date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtCost(cost: number) {
  return `$${Number(cost).toFixed(4)}`;
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function MiniBarChart({ data, valueKey = 'cost', label = 'Cost' }: { data: any[]; valueKey?: string; label?: string }) {
  if (data.length === 0) return <p className="text-sm text-gray-400 py-8 text-center">No data</p>;
  const maxVal = Math.max(...data.map(d => Number(d[valueKey])), 0.0001);

  return (
    <div className="flex items-end gap-px h-32">
      {data.map(d => {
        const h = Math.max((Number(d[valueKey]) / maxVal) * 100, 2);
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center group relative">
            <div
              className="w-full bg-indigo-500 dark:bg-indigo-400 rounded-t transition-all hover:bg-indigo-600 dark:hover:bg-indigo-300 min-w-[4px]"
              style={{ height: `${h}%` }}
            />
            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
              {new Date(d.day).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}: {label === 'Cost' ? fmtCost(Number(d[valueKey])) : Number(d[valueKey]).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function agentLabel(id: string) {
  return id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function AiCostTab() {
  const [period, setPeriod] = useState(30);
  const since = period > 0 ? new Date(Date.now() - period * 86400000).toISOString().slice(0, 10) : undefined;

  const { data, isLoading, error } = useQuery<AiUsageData>({
    queryKey: ['admin-ai-usage', since],
    queryFn: () => apiService.getAdminAiUsage(since),
  });

  const summary = data?.summary;
  const usageRows = (data?.usage ?? []).filter((r: AiUsageRow) => Number(r.call_count) > 0);

  return (
    <>
      <div className="flex items-center gap-2 mb-5">
        {PERIODS.map(p => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
              period === p.value
                ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'
            }`}
          >{p.label}</button>
        ))}
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading AI usage...</div>}
      {error && <div className="text-center py-12 text-red-500">Failed to load AI usage.</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard icon={Zap} label="Total Calls" value={Number(summary?.total_calls || 0).toLocaleString()} color="bg-blue-500" />
            <StatCard icon={Brain} label="Total Tokens" value={Number(summary?.total_tokens || 0).toLocaleString()} color="bg-purple-500" />
            <StatCard icon={DollarSign} label="Total Cost" value={fmtCost(Number(summary?.total_cost || 0))} color="bg-emerald-500" />
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Daily Cost (Last 30 days)</h3>
            </div>
            <MiniBarChart data={data.dailyTrend ?? []} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="pb-3 pr-4">User</th>
                  <th className="pb-3 pr-4 text-right">Calls</th>
                  <th className="pb-3 pr-4 text-right">Tokens</th>
                  <th className="pb-3 pr-4 text-right">Cost</th>
                  <th className="pb-3">Last Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {usageRows.map((r: AiUsageRow) => (
                  <tr key={r.username} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
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
                {usageRows.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-gray-500 dark:text-gray-400">No AI usage in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function UsageAnalyticsTab() {
  const [days, setDays] = useState(30);

  const { data, isLoading, error } = useQuery<UsageAnalyticsData>({
    queryKey: ['admin-usage-analytics', days],
    queryFn: () => apiService.getAdminUsageAnalytics(days),
  });

  return (
    <>
      <div className="flex items-center gap-2 mb-5">
        {PERIODS.filter(p => p.value > 0).map(p => (
          <button key={p.value} onClick={() => setDays(p.value)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
              days === p.value
                ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'
            }`}
          >{p.label}</button>
        ))}
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading analytics...</div>}
      {error && <div className="text-center py-12 text-red-500">Failed to load usage analytics.</div>}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard icon={Activity} label="Agent Runs" value={data.agentUsage.reduce((s, a) => s + Number(a.runs), 0).toLocaleString()} color="bg-blue-500" />
            <StatCard icon={MessageSquare} label="Chat Messages" value={Number(data.chatStats.messages).toLocaleString()} color="bg-purple-500" />
            <StatCard icon={GitBranch} label="Workflow Patterns" value={data.agentPatterns.length.toLocaleString()} color="bg-amber-500" />
          </div>

          {/* Daily agent runs chart */}
          {data.dailyAgentRuns.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Daily Agent Runs</h3>
              </div>
              <MiniBarChart data={data.dailyAgentRuns} valueKey="runs" label="Runs" />
            </div>
          )}

          {/* Agent usage table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Agent Usage</h3>
            {data.agentUsage.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No agent activity in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      <th className="pb-2 pr-4">Agent</th>
                      <th className="pb-2 pr-4 text-right">Runs</th>
                      <th className="pb-2 pr-4 text-right">Projects</th>
                      <th className="pb-2">Last Run</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.agentUsage.map(a => (
                      <tr key={a.agent_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-white">{agentLabel(a.agent_id)}</td>
                        <td className="py-2.5 pr-4 text-right text-gray-700 dark:text-gray-200">{Number(a.runs).toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right text-gray-700 dark:text-gray-200">{Number(a.unique_projects).toLocaleString()}</td>
                        <td className="py-2.5 text-gray-500 dark:text-gray-400">{fmt(a.last_run)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sequential patterns */}
          {data.agentPatterns.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Sequential Agent Patterns</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Agents triggered within 30 minutes of each other on the same project</p>
              <div className="space-y-2">
                {data.agentPatterns.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{agentLabel(p.first_agent)}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="font-medium text-gray-900 dark:text-white">{agentLabel(p.second_agent)}</span>
                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{Number(p.frequency)}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature usage */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Top Features by Usage</h3>
            {data.featureUsage.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No feature usage in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      <th className="pb-2 pr-4">Action</th>
                      <th className="pb-2 pr-4 text-right">Count</th>
                      <th className="pb-2 text-right">Users</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.featureUsage.map(f => (
                      <tr key={f.action} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">{f.action}</td>
                        <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-200">{Number(f.call_count).toLocaleString()}</td>
                        <td className="py-2 text-right text-gray-700 dark:text-gray-200">{Number(f.unique_users).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Chat stats */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Mjuzi Chat</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{Number(data.chatStats.active_chatters)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Active Users</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{Number(data.chatStats.conversations)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Conversations</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{Number(data.chatStats.messages)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Messages</p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function AdminAiUsagePage() {
  const [tab, setTab] = useState<'cost' | 'analytics'>('cost');

  return (
    <AdminPageWrapper title="AI Usage" subtitle="AI cost tracking and feature usage analytics">
      <div className="flex items-center gap-1 mb-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-1 w-fit">
        <button onClick={() => setTab('cost')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition ${
            tab === 'cost' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
          }`}>AI Costs</button>
        <button onClick={() => setTab('analytics')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition ${
            tab === 'analytics' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
          }`}>Usage Analytics</button>
      </div>

      {tab === 'cost' ? <AiCostTab /> : <UsageAnalyticsTab />}
    </AdminPageWrapper>
  );
}

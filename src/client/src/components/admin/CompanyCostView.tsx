import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Brain, DollarSign, Zap } from 'lucide-react';
import { apiService } from '../../services/api';
import { formatUsdCost } from '../../utils/formatCurrency';
import { formatCalendarDate } from '../../utils/dateUtils';

/** 'combined' = a company billed per person: each person has their own limit, so there is no company-wide verdict */
type Status = 'ok' | 'near' | 'blocked' | 'combined';

interface CompanyCostRow {
  id: string;
  name: string;
  plan: string;
  billingModel: 'flat' | 'per_seat';
  seats: number;
  tokens: number;
  cost: number;
  calls: number;
  allowance: number;
  allowanceSource: 'company' | 'plan' | 'per-person';
  planDefault: number;
  percentUsed: number;
  status: Status;
  lastCall: string | null;
}
interface OtherRow { bucket: string; label: string; tokens: number; cost: number; calls: number; lastCall: string | null }
interface FeatureRow { feature: string; cost: number; calls: number; today: number; normal: number; unusual: boolean }
interface CompanyCostReport {
  month: string;
  summary: { cost: number; tokens: number; calls: number; capUsd: number };
  companies: CompanyCostRow[];
  other: OtherRow[];
  features: FeatureRow[];
}

const n = (v: number) => Number(v).toLocaleString();
const day = (d: string | null) => (d ? formatCalendarDate(d, { month: 'short', day: 'numeric' }, 'en-CA') : '—');
const SOURCE_TEXT: Record<CompanyCostRow['allowanceSource'], string> = { company: "Your setting", plan: 'Plan default', 'per-person': "Each person's own, added up (top-ups not included)" };

const STATUS: Record<Status, { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
  near: { label: 'Near the limit', cls: 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 border-amber-300 dark:border-amber-700' },
  blocked: { label: 'AI paused', cls: 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-300 dark:border-red-800' },
  combined: { label: 'Per person', cls: 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600' },
};

function Bar({ percent, status, label }: { percent: number; status: Status; label: string }) {
  const color = status === 'blocked' ? 'bg-red-500' : status === 'near' ? 'bg-amber-500' : status === 'combined' ? 'bg-gray-400' : 'bg-emerald-500';
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100}
      className="h-2 w-28 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}><Icon className="w-5 h-5 text-white" aria-hidden="true" /></div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
          {sub && <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

/** Admin → AI usage → By company (C2): this month per company, what belongs to none, and the features that cost most */
export function CompanyCostView() {
  const { data, isLoading, error } = useQuery<CompanyCostReport>({
    queryKey: ['admin-ai-usage-companies'],
    queryFn: () => apiService.getAdminAiUsageByCompany(),
  });

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading company costs…</div>;
  if (error || !data) return <div className="text-center py-12 text-red-500">Failed to load company costs.</div>;

  const { summary } = data;
  const capPercent = summary.capUsd > 0 ? Math.round((summary.cost / summary.capUsd) * 100) : 0;
  const capStatus: Status = capPercent >= 100 ? 'blocked' : capPercent >= 80 ? 'near' : 'ok';
  // companies with no AI use are left out, unless they are paused or have their own setting
  const companies = data.companies.filter(c => c.calls > 0 || c.status === 'blocked' || c.allowanceSource === 'company');
  const spikes = data.features.filter(f => f.unusual);

  return (
    <>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        This calendar month ({data.month}), all estimates from the app&apos;s own usage log. Anthropic&apos;s console is the real bill.
      </p>

      {spikes.length > 0 && (
        <div role="alert" className="mb-5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-200 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Far above a normal day: {spikes.map(s => `${s.feature} (${formatUsdCost(s.today)} today, normal ${formatUsdCost(s.normal)})`).join('; ')}.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Tile icon={DollarSign} label="Estimated cost this month" value={formatUsdCost(summary.cost)}
          sub={summary.capUsd > 0 ? `${capPercent}% of the $${n(summary.capUsd)} account limit` : 'No account limit set'} color={capStatus === 'ok' ? 'bg-emerald-500' : capStatus === 'near' ? 'bg-amber-500' : 'bg-red-500'} />
        <Tile icon={Brain} label="Tokens this month" value={n(summary.tokens)} color="bg-purple-500" />
        <Tile icon={Zap} label="AI calls this month" value={n(summary.calls)} color="bg-blue-500" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Where it goes: top features this month</h3>
        {data.features.length === 0 ? <p className="text-sm text-gray-500">No AI calls yet this month.</p> : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.features.map(f => (
              <li key={f.feature} className={`rounded-lg border p-3 text-sm ${f.unusual ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 dark:text-white break-all">{f.feature}</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{formatUsdCost(f.cost)}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {n(f.calls)} calls · today {formatUsdCost(f.today)} · a normal day {formatUsdCost(f.normal)}
                </div>
                {f.unusual && <div className="mt-1 text-xs font-semibold text-red-700 dark:text-red-300">Far above a normal day</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">AI use this month by company</caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th scope="col" className="pb-3 pr-4">Company</th>
              <th scope="col" className="pb-3 pr-4 text-right">Tokens used</th>
              <th scope="col" className="pb-3 pr-4 text-right">Est. cost</th>
              <th scope="col" className="pb-3 pr-4 text-right">Allowance</th>
              <th scope="col" className="pb-3 pr-4">Used</th>
              <th scope="col" className="pb-3 pr-4">Status</th>
              <th scope="col" className="pb-3">Last call</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {companies.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900 dark:text-white">{c.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{c.plan}{c.billingModel === 'per_seat' ? ` · ${c.seats} seat${c.seats === 1 ? '' : 's'}` : ''}</div>
                </td>
                <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-200">{n(c.tokens)}</td>
                <td className="py-3 pr-4 text-right font-medium text-gray-900 dark:text-white">{formatUsdCost(c.cost)}</td>
                <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-200">
                  {n(c.allowance)}
                  <div className="text-xs text-gray-500 dark:text-gray-400">{SOURCE_TEXT[c.allowanceSource]}</div>
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2"><Bar percent={c.percentUsed} status={c.status} label={c.status === 'combined' ? `${c.name}: everyone together has used ${c.percentUsed}% of their allowances added up` : `${c.name} has used ${c.percentUsed}% of its allowance`} /><span className="text-xs text-gray-600 dark:text-gray-300">{c.percentUsed}%</span></div>
                </td>
                <td className="py-3 pr-4"><span className={`inline-flex px-2 py-0.5 rounded border text-xs font-medium ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span></td>
                <td className="py-3 text-gray-500 dark:text-gray-400">{day(c.lastCall)}</td>
              </tr>
            ))}
            {data.other.map(o => (
              <tr key={o.bucket} className="text-gray-500 dark:text-gray-400">
                <td className="py-3 pr-4 italic">{o.label}</td>
                <td className="py-3 pr-4 text-right">{n(o.tokens)}</td>
                <td className="py-3 pr-4 text-right">{formatUsdCost(o.cost)}</td>
                <td className="py-3 pr-4 text-right" colSpan={3}>no allowance: not a company</td>
                <td className="py-3">{day(o.lastCall)}</td>
              </tr>
            ))}
            {companies.length === 0 && data.other.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-500 dark:text-gray-400">No AI usage this month.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

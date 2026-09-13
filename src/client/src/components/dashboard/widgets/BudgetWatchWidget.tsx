import { useNavigate } from 'react-router-dom';
import { DollarSign, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import type { ProjectRow } from '../ProjectTable';

interface Props {
  projects: ProjectRow[];
}

function formatDollar(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function BurnIndicator({ spentPct, progressPct }: { spentPct: number; progressPct: number }) {
  // Compare spend rate vs progress — if spending faster than delivering, flag it
  if (progressPct <= 0) {
    return spentPct > 10 ? <span title="Spending with no progress"><AlertTriangle className="w-3 h-3 text-red-500" /></span> : null;
  }
  const ratio = spentPct / progressPct;
  if (ratio > 1.3) return <span title="Burn rate exceeds progress"><TrendingUp className="w-3 h-3 text-red-500" /></span>;
  if (ratio < 0.8) return <span title="Under budget"><TrendingDown className="w-3 h-3 text-green-500" /></span>;
  return <span title="On track"><Minus className="w-3 h-3 text-gray-500" /></span>;
}

export function BudgetWatchWidget({ projects }: Props) {
  const navigate = useNavigate();

  const withBudget = projects
    .filter(p => (p.budgetAllocated ?? 0) > 0)
    .map(p => ({
      ...p,
      spentPct: Math.round(((p.budgetSpent ?? 0) / p.budgetAllocated!) * 100),
      progressPct: p.progressPercentage ?? 0,
    }))
    .sort((a, b) => b.spentPct - a.spentPct)
    .slice(0, 5);

  // Portfolio summary
  const totalAllocated = projects.reduce((s, p) => s + (p.budgetAllocated ?? 0), 0);
  const totalSpent = projects.reduce((s, p) => s + (p.budgetSpent ?? 0), 0);
  const portfolioUtilPct = totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0;
  const overBudgetCount = withBudget.filter(p => p.spentPct > 100).length;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Budget Watch</h3>
      </div>

      {/* Portfolio summary row */}
      {totalAllocated > 0 && (
        <div className="flex items-center gap-3 p-2 mb-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600/50">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Portfolio Total</span>
              <div className="flex items-center gap-2">
                {overBudgetCount > 0 && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    {overBudgetCount} over
                  </span>
                )}
                <span className={`text-xs font-bold ${portfolioUtilPct > 100 ? 'text-red-600 dark:text-red-400' : portfolioUtilPct > 80 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                  {portfolioUtilPct}%
                </span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-600">
              <div
                className={`h-full rounded-full ${portfolioUtilPct > 100 ? 'bg-red-500' : portfolioUtilPct > 80 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(portfolioUtilPct, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatDollar(totalSpent)} of {formatDollar(totalAllocated)} allocated
            </p>
          </div>
        </div>
      )}

      {withBudget.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No projects with budgets</p>
      ) : (
        <ul className="space-y-3">
          {withBudget.map((p) => {
            const barColor = p.spentPct > 100 ? 'bg-red-500' : p.spentPct > 80 ? 'bg-amber-500' : 'bg-green-500';
            return (
              <li
                key={p.id}
                onClick={() => navigate(`/project/${p.id}`)}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg px-2 py-1.5 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <BurnIndicator spentPct={p.spentPct} progressPct={p.progressPct} />
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${p.spentPct > 100 ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' : p.spentPct > 80 ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'}`}>
                      {p.spentPct}%
                    </span>
                  </div>
                </div>
                {/* Stacked bar: spend vs progress */}
                <div className="relative h-1.5 rounded-full bg-gray-100 dark:bg-gray-600">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(p.spentPct, 100)}%` }} />
                  {p.progressPct > 0 && (
                    <div
                      className="absolute top-0 h-full w-0.5 bg-blue-600 dark:bg-blue-400"
                      style={{ left: `${Math.min(p.progressPct, 100)}%` }}
                      title={`Progress: ${p.progressPct}%`}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-xs text-gray-500">
                    {formatDollar(p.budgetSpent ?? 0)} / {formatDollar(p.budgetAllocated!)}
                  </p>
                  {p.progressPct > 0 && (
                    <p className="text-xs text-blue-500 dark:text-blue-400">
                      {p.progressPct}% done
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

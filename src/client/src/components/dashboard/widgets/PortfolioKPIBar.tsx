import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  HeartPulse,
  Clock,
  ShieldAlert,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
} from 'lucide-react';
import { apiService } from '../../../services/api';

type TrendDirection = 'improving' | 'declining' | 'stable';

interface KPITile {
  label: string;
  value: string;
  icon: React.ElementType;
  color: 'green' | 'yellow' | 'red' | 'gray';
  href: string;
  trend?: TrendDirection;
}

const colorMap = {
  green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  yellow: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  red: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  gray: 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-500',
};

const dotColor = {
  green: 'bg-green-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
  gray: 'bg-gray-400',
};

interface PortfolioKPIBarProps {
  scope?: 'portfolio';
}

export function PortfolioKPIBar({ scope }: PortfolioKPIBarProps = {}) {
  const navigate = useNavigate();
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics-summary', scope],
    queryFn: () => apiService.getAnalyticsSummary(scope),
    staleTime: 120_000,
  });

  const { data: predictions, isLoading: predictionsLoading } = useQuery({
    queryKey: ['dashboard-predictions'],
    queryFn: () => apiService.getDashboardPredictions(),
    staleTime: 120_000,
  });

  if (analyticsLoading || predictionsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    );
  }

  const summary = analytics?.summary || analytics?.data || analytics;
  const tiles: KPITile[] = buildTiles(summary, predictions);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          onClick={() => navigate(tile.href)}
          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 cursor-pointer hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colorMap[tile.color]}`}>
              <tile.icon className="h-4 w-4" />
            </div>
            <span className={`h-2 w-2 rounded-full ${dotColor[tile.color]}`} />
          </div>
          <div className="flex items-center gap-1.5">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{tile.value}</p>
            {tile.trend && tile.trend !== 'stable' && (
              tile.trend === 'improving'
                ? <TrendingUp className="w-4 h-4 text-green-500" />
                : <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            {tile.trend === 'stable' && <Minus className="w-4 h-4 text-gray-500" />}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

function buildTiles(analytics: any, predictions: any): KPITile[] {
  const trendIndicators = analytics?.trendIndicators;
  // Portfolio Health
  const healthScores: number[] = predictions?.projectHealthScores?.map((s: any) => s.healthScore) || [];
  const avgHealth = healthScores.length > 0
    ? Math.round(healthScores.reduce((a: number, b: number) => a + b, 0) / healthScores.length)
    : 0;
  const healthColor = avgHealth >= 75 ? 'green' : avgHealth >= 50 ? 'yellow' : healthScores.length === 0 ? 'gray' : 'red';

  // Overdue Tasks
  const overdue = analytics?.tasks?.overdue ?? 0;
  const overdueColor = overdue === 0 ? 'green' : overdue <= 5 ? 'yellow' : 'red';

  // Open Risks
  const risks = predictions?.risks;
  const openRisks = risks ? (risks.critical || 0) + (risks.high || 0) + (risks.medium || 0) : 0;
  const riskColor = openRisks === 0 ? 'green' : openRisks <= 3 ? 'yellow' : 'red';

  // At-Risk Projects
  const atRisk = analytics?.portfolio?.atRiskProjects?.length ?? 0;
  const atRiskColor = atRisk === 0 ? 'green' : atRisk <= 2 ? 'yellow' : 'red';

  // Budget Variance
  const allocated = analytics?.budget?.totalAllocated ?? 0;
  const spent = analytics?.budget?.totalSpent ?? 0;
  const variance = allocated - spent;
  const varianceColor = variance >= 0 ? 'green' : 'red';
  const varianceStr = variance >= 0
    ? `+$${formatCompact(variance)}`
    : `-$${formatCompact(Math.abs(variance))}`;

  // Budget Utilization
  const utilization = analytics?.budget?.utilizationPercent ?? 0;
  const utilColor = utilization > 95 ? 'red' : utilization >= 80 ? 'yellow' : 'green';

  return [
    { label: 'Portfolio Health', value: `${avgHealth}%`, icon: HeartPulse, color: healthColor, href: '/kpi/health', trend: trendIndicators?.healthTrend },
    { label: 'Overdue Tasks', value: String(overdue), icon: Clock, color: overdueColor, href: '/kpi/overdue', trend: trendIndicators?.overdueTasksTrend },
    { label: 'Open Risks', value: String(openRisks), icon: ShieldAlert, color: riskColor, href: '/kpi/risks' },
    { label: 'At-Risk Projects', value: String(atRisk), icon: AlertTriangle, color: atRiskColor, href: '/kpi/at-risk' },
    { label: 'Budget Variance', value: varianceStr, icon: DollarSign, color: varianceColor, href: '/kpi/budget-variance' },
    { label: 'Budget Utilization', value: `${Math.round(utilization)}%`, icon: TrendingUp, color: utilColor, href: '/kpi/budget-utilization' },
  ];
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

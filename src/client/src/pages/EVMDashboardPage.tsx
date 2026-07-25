import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, ChevronDown, Activity, Target, BarChart3, Lock } from 'lucide-react';
import { apiService } from '../services/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project { id: string; name: string; }

interface EVMMetrics {
  BAC: number;
  EV: number;
  AC: number;
  PV: number;
  CPI: number;
  SPI: number;
  EAC: number;
  ETC: number;
  VAC: number;
  TCPI: number;
}

interface WeeklyTrend { date: string; cpi: number; spi: number; }

interface EarlyWarning {
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

interface ForecastComparison {
  method: string;
  eacValue: number;
  varianceFromBAC: number;
}

interface AIPrediction {
  predictedCPI: Array<{ week: number; value: number }>;
  predictedSPI: Array<{ week: number; value: number }>;
  aiAdjustedEAC: number;
  eacConfidenceRange: { low: number; high: number };
  trendDirection: 'improving' | 'stable' | 'deteriorating';
  overrunProbability: number;
  correctiveActions: Array<{ action: string; effort: string; priority: string; estimatedImpact: string }>;
  narrativeSummary: string;
}

interface EVMResult {
  currentMetrics: EVMMetrics;
  historicalTrends: { weeklyData: WeeklyTrend[] };
  earlyWarnings: EarlyWarning[];
  traditionalForecasts: { eacCumulative: number; eacComposite: number; eacManagement: number };
  forecastComparison: ForecastComparison[];
  aiPredictions?: AIPrediction;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function indexColor(value: number): string {
  if (value >= 1.0) return '#22c55e'; // green — on or ahead
  if (value >= 0.9) return '#f59e0b'; // amber — slightly behind
  return '#ef4444'; // red — significantly behind
}

function severityColor(s: string): string {
  if (s === 'critical') return 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
  if (s === 'warning') return 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
  return 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
}

function trendIcon(direction?: string) {
  if (direction === 'improving') return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (direction === 'deteriorating') return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Activity className="w-4 h-4 text-gray-400" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EVMDashboardPage() {
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });
  const projects: Project[] = projectsData?.data || projectsData?.projects || [];

  const { data: evmData, isLoading } = useQuery({
    queryKey: ['evm', selectedProjectId],
    queryFn: () => apiService.getEVMForecast(selectedProjectId),
    enabled: !!selectedProjectId,
  });
  const result: EVMResult | null = evmData?.result || null;
  const aiPowered: boolean = evmData?.aiPowered || false;
  const isSample: boolean = evmData?.sample || false;

  const m = result?.currentMetrics;

  // SPI/CPI trend chart dimensions
  const trendData = result?.historicalTrends?.weeklyData || [];
  const CHART_W = 600;
  const CHART_H = 200;
  const PAD = { top: 10, right: 20, bottom: 30, left: 35 };
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;

  const trendLines = useMemo(() => {
    if (trendData.length < 2) return null;
    const maxY = Math.max(1.5, ...trendData.map(d => Math.max(d.cpi, d.spi)));
    const minY = Math.min(0.5, ...trendData.map(d => Math.min(d.cpi, d.spi)));
    const rangeY = maxY - minY || 1;

    const toX = (i: number) => PAD.left + (i / (trendData.length - 1)) * plotW;
    const toY = (v: number) => PAD.top + (1 - (v - minY) / rangeY) * plotH;

    const cpiPath = trendData.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.cpi)}`).join(' ');
    const spiPath = trendData.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.spi)}`).join(' ');
    const baselineY = toY(1.0);

    return { cpiPath, spiPath, baselineY, toX, toY, minY, maxY, rangeY };
  }, [trendData, plotW, plotH]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <DollarSign className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Earned Value Management</h1>
            <p className="text-sm text-gray-500">SPI/CPI performance tracking, forecasts, and early warnings</p>
          </div>
        </div>
        {aiPowered && (
          <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">AI-Powered</span>
        )}
      </div>

      {/* Project selector */}
      <div className="relative inline-block">
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-3 pr-8 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="">Select project...</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {!selectedProjectId && (
        <div className="text-center py-16 text-gray-400">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">Select a project to view EVM data</p>
        </div>
      )}

      {selectedProjectId && isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {selectedProjectId && !isLoading && !result && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">No EVM data available for this project.</div>
      )}

      {result && m && (
        <>
          {isSample && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample EVM Dashboard</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    This is a sample dashboard with demo data. Upgrade to a paid plan to see EVM metrics calculated from your actual project budgets, costs, and schedule performance.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'CPI', value: m.CPI.toFixed(2), sub: 'Cost Performance', color: indexColor(m.CPI) },
              { label: 'SPI', value: m.SPI.toFixed(2), sub: 'Schedule Performance', color: indexColor(m.SPI) },
              { label: 'EV', value: formatCurrency(m.EV), sub: 'Earned Value', color: '#3b82f6' },
              { label: 'PV', value: formatCurrency(m.PV), sub: 'Planned Value', color: '#8b5cf6' },
              { label: 'AC', value: formatCurrency(m.AC), sub: 'Actual Cost', color: '#6b7280' },
              { label: 'BAC', value: formatCurrency(m.BAC), sub: 'Budget at Completion', color: '#6b7280' },
            ].map(kpi => (
              <div key={kpi.label} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-xs text-gray-500 uppercase font-semibold">{kpi.label}</div>
                <div className="text-2xl font-bold mt-1" style={{ color: kpi.color }}>{kpi.value}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* Forecasts row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'EAC', value: formatCurrency(m.EAC), sub: 'Estimate at Completion', warn: m.EAC > m.BAC },
              { label: 'ETC', value: formatCurrency(m.ETC), sub: 'Estimate to Complete', warn: false },
              { label: 'VAC', value: formatCurrency(m.VAC), sub: 'Variance at Completion', warn: m.VAC < 0 },
              { label: 'TCPI', value: m.TCPI.toFixed(2), sub: 'To-Complete Performance Index', warn: m.TCPI > 1.1 },
            ].map(kpi => (
              <div key={kpi.label} className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border p-4 ${kpi.warn ? 'border-red-200 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 uppercase font-semibold">{kpi.label}</span>
                  {kpi.warn && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                </div>
                <div className={`text-xl font-bold mt-1 ${kpi.warn ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{kpi.value}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* SPI/CPI Trend Chart + Early Warnings side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Trend chart */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">CPI / SPI Trend</h3>
              {trendData.length < 2 ? (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Not enough historical data for trend chart.</div>
              ) : trendLines && (
                <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
                  {/* Grid lines */}
                  {[0.5, 0.75, 1.0, 1.25, 1.5].filter(v => v >= trendLines.minY && v <= trendLines.maxY).map(v => (
                    <g key={v}>
                      <line x1={PAD.left} y1={trendLines.toY(v)} x2={CHART_W - PAD.right} y2={trendLines.toY(v)} className="stroke-gray-200 dark:stroke-gray-600" strokeWidth={v === 1.0 ? 1.5 : 0.5} strokeDasharray={v === 1.0 ? undefined : '4 2'} />
                      <text x={PAD.left - 5} y={trendLines.toY(v) + 3} fontSize={9} className="fill-gray-400 dark:fill-gray-500" textAnchor="end">{v.toFixed(1)}</text>
                    </g>
                  ))}
                  {/* CPI line */}
                  <path d={trendLines.cpiPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
                  {/* SPI line */}
                  <path d={trendLines.spiPath} fill="none" stroke="#22c55e" strokeWidth={2} />
                  {/* 1.0 baseline label */}
                  <text x={CHART_W - PAD.right + 3} y={trendLines.baselineY + 3} fontSize={8} className="fill-gray-400 dark:fill-gray-500">1.0</text>
                  {/* X axis labels */}
                  {trendData.map((d, i) => {
                    if (i % Math.max(1, Math.floor(trendData.length / 6)) !== 0) return null;
                    return (
                      <text key={i} x={trendLines.toX(i)} y={CHART_H - 5} fontSize={8} className="fill-gray-400 dark:fill-gray-500" textAnchor="middle">
                        {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </text>
                    );
                  })}
                  {/* Dots on latest */}
                  {trendData.length > 0 && (() => {
                    const last = trendData[trendData.length - 1];
                    const x = trendLines.toX(trendData.length - 1);
                    return (
                      <>
                        <circle cx={x} cy={trendLines.toY(last.cpi)} r={4} fill="#3b82f6" />
                        <circle cx={x} cy={trendLines.toY(last.spi)} r={4} fill="#22c55e" />
                      </>
                    );
                  })()}
                </svg>
              )}
              {trendData.length >= 2 && (
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> CPI</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> SPI</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-gray-300 dark:bg-gray-500 inline-block" /> Baseline (1.0)</span>
                </div>
              )}
            </div>

            {/* Early warnings */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Early Warnings
              </h3>
              {result.earlyWarnings.length === 0 ? (
                <div className="text-center py-6 text-green-500 dark:text-green-400 text-sm font-medium">No warnings — project is on track</div>
              ) : (
                <div className="space-y-2">
                  {result.earlyWarnings.map((w, i) => (
                    <div key={i} className={`border rounded-lg px-3 py-2 text-xs ${severityColor(w.severity)}`}>
                      <div className="font-semibold capitalize">{w.severity}</div>
                      <div className="mt-0.5">{w.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Forecast comparison table */}
          {result.forecastComparison.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-primary-500" />
                Forecast Comparison
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700">
                      <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Method</th>
                      <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">EAC</th>
                      <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Variance from BAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.forecastComparison.map((fc, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{fc.method}</td>
                        <td className="px-4 py-2 text-right text-gray-900 dark:text-white">{formatCurrency(fc.eacValue)}</td>
                        <td className={`px-4 py-2 text-right font-medium ${fc.varianceFromBAC < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {fc.varianceFromBAC >= 0 ? '+' : ''}{formatCurrency(fc.varianceFromBAC)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AI Predictions */}
          {result.aiPredictions && (
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-5">
              <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                AI Predictions
                {trendIcon(result.aiPredictions.trendDirection)}
                <span className="text-xs font-normal text-gray-500 capitalize">{result.aiPredictions.trendDirection}</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div className="bg-white/80 dark:bg-gray-800/80 rounded-lg p-3">
                  <div className="text-xs text-gray-500">AI-Adjusted EAC</div>
                  <div className="text-lg font-bold text-purple-700">{formatCurrency(result.aiPredictions.aiAdjustedEAC)}</div>
                  <div className="text-[10px] text-gray-400">
                    Range: {formatCurrency(result.aiPredictions.eacConfidenceRange.low)} — {formatCurrency(result.aiPredictions.eacConfidenceRange.high)}
                  </div>
                </div>
                <div className="bg-white/80 dark:bg-gray-800/80 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Overrun Probability</div>
                  <div className={`text-lg font-bold ${result.aiPredictions.overrunProbability > 50 ? 'text-red-600' : 'text-green-600'}`}>
                    {result.aiPredictions.overrunProbability}%
                  </div>
                </div>
                <div className="bg-white/80 dark:bg-gray-800/80 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Trend</div>
                  <div className="flex items-center gap-2 mt-1">
                    {trendIcon(result.aiPredictions.trendDirection)}
                    <span className="text-sm font-semibold capitalize text-gray-700 dark:text-gray-300">{result.aiPredictions.trendDirection}</span>
                  </div>
                </div>
              </div>

              {result.aiPredictions.narrativeSummary && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 italic">{result.aiPredictions.narrativeSummary}</p>
              )}

              {result.aiPredictions.correctiveActions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-2">Recommended Corrective Actions</h4>
                  <div className="space-y-2">
                    {result.aiPredictions.correctiveActions.map((ca, i) => (
                      <div key={i} className="bg-white/80 dark:bg-gray-800/80 rounded-lg px-3 py-2 text-sm flex items-start gap-3">
                        <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase text-white ${ca.priority === 'critical' ? 'bg-red-500' : ca.priority === 'high' ? 'bg-amber-500' : 'bg-blue-500'}`}>{ca.priority}</span>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{ca.action}</div>
                          <div className="text-xs text-gray-500">Effort: {ca.effort} &middot; Impact: {ca.estimatedImpact}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

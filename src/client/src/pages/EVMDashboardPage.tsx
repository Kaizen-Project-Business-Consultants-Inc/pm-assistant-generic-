import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, ChevronDown, Activity, Target, BarChart3, Lock, Download } from 'lucide-react';
import { apiService } from '../services/api';
import { EVMMetricTooltip } from '../components/evm/EVMMetricTooltip';
import type { MetricValues } from '../components/evm/EVMMetricTooltip';
import { SCurveChart } from '../components/evm/SCurveChart';

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

interface SCurveDataPoint {
  date: string;
  pv: number;
  ev: number;
  ac: number;
}

interface EVMResult {
  currentMetrics: EVMMetrics;
  historicalTrends: { weeklyData: WeeklyTrend[] };
  earlyWarnings: EarlyWarning[];
  traditionalForecasts: { eacCumulative: number; eacComposite: number; eacManagement: number };
  forecastComparison: ForecastComparison[];
  aiPredictions?: AIPrediction;
  sCurveData?: SCurveDataPoint[];
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
// Gauge Component (semicircular)
// ---------------------------------------------------------------------------

function SemiGauge({ value, size = 80 }: { value: number; size?: number }) {
  const r = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const startAngle = Math.PI;
  const endAngle = 0;

  // Arc helper: angles go from PI (left) to 0 (right) for a top semicircle
  function arcPoint(angle: number) {
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  }

  // Three bands: red (0–0.9), amber (0.9–1.0), green (1.0–2.0)
  // Map value range 0–2 across PI to 0
  function valueToAngle(v: number) {
    const clamped = Math.max(0, Math.min(2, v));
    return Math.PI * (1 - clamped / 2);
  }

  const redEnd = valueToAngle(0.9);
  const amberEnd = valueToAngle(1.0);

  function arcPath(fromAngle: number, toAngle: number) {
    const start = arcPoint(fromAngle);
    const end = arcPoint(toAngle);
    const sweep = fromAngle - toAngle > Math.PI ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${sweep} 1 ${end.x} ${end.y}`;
  }

  // Needle
  const needleAngle = valueToAngle(value);
  const needleLen = r - 6;
  const tip = { x: cx + needleLen * Math.cos(needleAngle), y: cy - needleLen * Math.sin(needleAngle) };

  return (
    <svg width={size} height={size / 2 + 12} viewBox={`0 0 ${size} ${size / 2 + 12}`} className="mx-auto">
      {/* Red band (0 to 0.9) */}
      <path d={arcPath(startAngle, redEnd)} fill="none" stroke="#fca5a5" strokeWidth={6} strokeLinecap="round" />
      {/* Amber band (0.9 to 1.0) */}
      <path d={arcPath(redEnd, amberEnd)} fill="none" stroke="#fcd34d" strokeWidth={6} strokeLinecap="round" />
      {/* Green band (1.0 to 2.0) */}
      <path d={arcPath(amberEnd, endAngle)} fill="none" stroke="#86efac" strokeWidth={6} strokeLinecap="round" />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={value >= 1.0 ? '#16a34a' : value >= 0.9 ? '#d97706' : '#dc2626'} strokeWidth={2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3} fill={value >= 1.0 ? '#16a34a' : value >= 0.9 ? '#d97706' : '#dc2626'} />
      {/* Scale labels */}
      <text x={cx - r + 2} y={cy + 10} fontSize={7} fill="#9ca3af" textAnchor="middle">0</text>
      <text x={cx} y={cy - r + 2} fontSize={7} fill="#9ca3af" textAnchor="middle">1.0</text>
      <text x={cx + r - 2} y={cy + 10} fontSize={7} fill="#9ca3af" textAnchor="middle">2.0</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Forecast Bar Chart Component
// ---------------------------------------------------------------------------

function ForecastBarChart({ comparisons, bac }: { comparisons: ForecastComparison[]; bac: number }) {
  const maxVal = Math.max(bac, ...comparisons.map(c => c.eacValue)) * 1.1;
  const barH = 24;
  const gap = 8;
  const labelW = 180;
  const valueW = 70;
  const chartW = 500;
  const svgW = labelW + chartW + valueW;
  const svgH = comparisons.length * (barH + gap) + gap + 20; // extra for BAC label

  const bacX = labelW + (bac / maxVal) * chartW;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 200 }}>
      {/* BAC reference line */}
      <line x1={bacX} y1={0} x2={bacX} y2={svgH - 16} stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={bacX} y={svgH - 4} fontSize={9} fill="#6b7280" textAnchor="middle">BAC {formatCurrency(bac)}</text>

      {comparisons.map((c, i) => {
        const y = gap + i * (barH + gap);
        const w = (c.eacValue / maxVal) * chartW;
        const overBudget = c.eacValue > bac;
        const barColor = overBudget ? '#f87171' : '#4ade80';
        const shortLabel = c.method.replace(/^EAC\s*\(/, '').replace(/\)$/, '');

        return (
          <g key={i}>
            <text x={labelW - 6} y={y + barH / 2 + 4} fontSize={10} fill="#6b7280" textAnchor="end">{shortLabel}</text>
            <rect x={labelW} y={y} width={w} height={barH} rx={4} fill={barColor} opacity={0.85} />
            <text x={labelW + w + 6} y={y + barH / 2 + 4} fontSize={10} fill={overBudget ? '#ef4444' : '#22c55e'} fontWeight="600">{formatCurrency(c.eacValue)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EVMDashboardPage() {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [exporting, setExporting] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

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

  // PDF export handler
  const handleExportPDF = useCallback(async () => {
    if (!dashboardRef.current || exporting) return;
    setExporting(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const projectName = projects.find(p => p.id === selectedProjectId)?.name || 'EVM Report';
      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename: `EVM_Report_${projectName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm' as const, format: 'a3' as const, orientation: 'landscape' as const },
      };
      await html2pdf().set(opt).from(dashboardRef.current).save();
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [exporting, selectedProjectId, projects]);

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
        <div className="flex items-center gap-2">
          {aiPowered && (
            <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">AI-Powered</span>
          )}
          {result && m && (
            <button
              onClick={handleExportPDF}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
              title="Export EVM report as PDF"
            >
              {exporting ? (
                <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Export PDF
            </button>
          )}
        </div>
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
        <div ref={dashboardRef}>
          {isSample && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 mb-6">
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

          <div className="space-y-6">
          {/* Narrative Summary */}
          {(() => {
            const pctComplete = m.BAC > 0 ? (m.EV / m.BAC) * 100 : 0;
            const pctSpent = m.BAC > 0 ? (m.AC / m.BAC) * 100 : 0;

            const scheduleStatus = m.SPI >= 1.0 ? 'on schedule' : m.SPI >= 0.9 ? 'slightly behind schedule' : 'significantly behind schedule';
            const costStatus = m.CPI >= 1.0 ? 'under budget' : m.CPI >= 0.9 ? 'slightly over budget' : 'significantly over budget';

            const overBudgetAmount = m.EAC > m.BAC ? m.EAC - m.BAC : 0;
            const forecast = overBudgetAmount > 0
              ? `At the current rate, the project will cost ${formatCurrency(overBudgetAmount)} more than the ${formatCurrency(m.BAC)} budget.`
              : `At the current rate, the project is forecast to finish within its ${formatCurrency(m.BAC)} budget.`;

            const overall = m.CPI >= 1.0 && m.SPI >= 1.0 ? 'healthy' : m.CPI >= 0.9 && m.SPI >= 0.9 ? 'needs-attention' : 'at-risk';
            const badgeColor = overall === 'healthy' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : overall === 'needs-attention' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
            const badgeLabel = overall === 'healthy' ? 'On Track' : overall === 'needs-attention' ? 'Needs Attention' : 'At Risk';

            return (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                      The project is <strong>{Math.round(pctComplete)}% complete</strong> with <strong>{Math.round(pctSpent)}% of budget spent</strong>.
                      {' '}It is {scheduleStatus} and {costStatus}. {forecast}
                    </p>
                  </div>
                  <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold ${badgeColor}`}>{badgeLabel}</span>
                </div>

                {/* % Complete vs % Spent bar */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="w-20 text-gray-500 dark:text-gray-400 text-right shrink-0">Complete</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden relative">
                      <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(pctComplete, 100)}%` }} />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700 dark:text-gray-200">{Math.round(pctComplete)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="w-20 text-gray-500 dark:text-gray-400 text-right shrink-0">Spent</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden relative">
                      <div className={`h-full rounded-full transition-all ${pctSpent > pctComplete ? 'bg-red-400' : 'bg-green-400'}`} style={{ width: `${Math.min(pctSpent, 100)}%` }} />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700 dark:text-gray-200">{Math.round(pctSpent)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* KPI Cards with Gauges */}
          {(() => {
            const CV = m.EV - m.AC;
            const SV = m.EV - m.PV;
            const mv: MetricValues = { BAC: m.BAC, EV: m.EV, AC: m.AC, PV: m.PV, CPI: m.CPI, SPI: m.SPI, EAC: m.EAC, ETC: m.ETC, VAC: m.VAC, TCPI: m.TCPI, CV, SV };

            // Period-over-period deltas for CPI/SPI
            const prevWeek = trendData.length >= 2 ? trendData[trendData.length - 2] : null;
            const cpiDelta = prevWeek ? m.CPI - prevWeek.cpi : null;
            const spiDelta = prevWeek ? m.SPI - prevWeek.spi : null;

            function deltaLabel(d: number | null): string {
              if (d === null) return '';
              const sign = d >= 0 ? '+' : '';
              return `${sign}${d.toFixed(2)}`;
            }
            function deltaColor(d: number | null): string {
              if (d === null || Math.abs(d) < 0.005) return 'text-gray-400';
              return d > 0 ? 'text-green-500' : 'text-red-500';
            }

            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  {/* CPI with gauge */}
                  <EVMMetricTooltip metricKey="CPI" values={mv}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 cursor-help">
                      <div className="text-xs text-gray-500 uppercase font-semibold text-center">CPI</div>
                      <SemiGauge value={m.CPI} size={72} />
                      <div className="flex items-baseline justify-center gap-1.5">
                        <span className="text-xl font-bold" style={{ color: indexColor(m.CPI) }}>{m.CPI.toFixed(2)}</span>
                        {cpiDelta !== null && <span className={`text-xs font-semibold ${deltaColor(cpiDelta)}`}>{deltaLabel(cpiDelta)}</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5 text-center">Cost Performance</div>
                    </div>
                  </EVMMetricTooltip>
                  {/* SPI with gauge */}
                  <EVMMetricTooltip metricKey="SPI" values={mv}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 cursor-help">
                      <div className="text-xs text-gray-500 uppercase font-semibold text-center">SPI</div>
                      <SemiGauge value={m.SPI} size={72} />
                      <div className="flex items-baseline justify-center gap-1.5">
                        <span className="text-xl font-bold" style={{ color: indexColor(m.SPI) }}>{m.SPI.toFixed(2)}</span>
                        {spiDelta !== null && <span className={`text-xs font-semibold ${deltaColor(spiDelta)}`}>{deltaLabel(spiDelta)}</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5 text-center">Schedule Performance</div>
                    </div>
                  </EVMMetricTooltip>
                  {/* CV */}
                  <EVMMetricTooltip metricKey="CV" values={mv}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 cursor-help">
                      <div className="text-xs text-gray-500 uppercase font-semibold">CV</div>
                      <div className="text-2xl font-bold" style={{ color: CV >= 0 ? '#22c55e' : '#ef4444' }}>{formatCurrency(CV)}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">Cost Variance</div>
                    </div>
                  </EVMMetricTooltip>
                  {/* SV */}
                  <EVMMetricTooltip metricKey="SV" values={mv}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 cursor-help">
                      <div className="text-xs text-gray-500 uppercase font-semibold">SV</div>
                      <div className="text-2xl font-bold" style={{ color: SV >= 0 ? '#22c55e' : '#ef4444' }}>{formatCurrency(SV)}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">Schedule Variance</div>
                    </div>
                  </EVMMetricTooltip>
                  {/* EV, PV, AC, BAC */}
                  {[
                    { label: 'EV', value: formatCurrency(m.EV), sub: 'Earned Value', color: '#3b82f6' },
                    { label: 'PV', value: formatCurrency(m.PV), sub: 'Planned Value', color: '#8b5cf6' },
                    { label: 'AC', value: formatCurrency(m.AC), sub: 'Actual Cost', color: '#6b7280' },
                    { label: 'BAC', value: formatCurrency(m.BAC), sub: 'Budget at Completion', color: '#6b7280' },
                  ].map(kpi => (
                    <EVMMetricTooltip key={kpi.label} metricKey={kpi.label} values={mv}>
                      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 cursor-help">
                        <div className="text-xs text-gray-500 uppercase font-semibold">{kpi.label}</div>
                        <div className="text-2xl font-bold mt-1" style={{ color: kpi.color }}>{kpi.value}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</div>
                      </div>
                    </EVMMetricTooltip>
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
                    <EVMMetricTooltip key={kpi.label} metricKey={kpi.label} values={mv}>
                      <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border p-4 cursor-help ${kpi.warn ? 'border-red-200 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 uppercase font-semibold">{kpi.label}</span>
                          {kpi.warn && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                        </div>
                        <div className={`text-xl font-bold mt-1 ${kpi.warn ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{kpi.value}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</div>
                      </div>
                    </EVMMetricTooltip>
                  ))}
                </div>
              </>
            );
          })()}

          {/* S-Curve Chart */}
          {result.sCurveData && result.sCurveData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary-500" />
                Cumulative Value Analysis (S-Curve)
              </h3>
              <SCurveChart data={result.sCurveData} height={280} />
            </div>
          )}

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

          {/* Forecast Comparison — table + bar chart */}
          {result.forecastComparison.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-primary-500" />
                Forecast Comparison
              </h3>

              {/* Bar chart */}
              <div className="mb-4">
                <ForecastBarChart comparisons={result.forecastComparison} bac={m.BAC} />
              </div>

              {/* Table */}
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
          </div>
        </div>
      )}
    </div>
  );
}

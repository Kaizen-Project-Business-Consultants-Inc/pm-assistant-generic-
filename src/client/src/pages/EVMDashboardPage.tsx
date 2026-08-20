import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, ChevronDown, Activity, Target, BarChart3, Lock, Download, SlidersHorizontal, Clock, ListOrdered, ChevronRight, Settings2, ShieldAlert } from 'lucide-react';
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

interface TaskVariance {
  taskId: string;
  taskName: string;
  budgetAllocated: number;
  actualCost: number;
  ev: number;
  pv: number;
  cv: number;
  sv: number;
  progressPct: number;
  cumulativePct?: number;
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

function ForecastBarChart({ comparisons, bac, managementReserve = 0 }: { comparisons: ForecastComparison[]; bac: number; managementReserve?: number }) {
  const bacPlusMR = bac + managementReserve;
  const maxVal = Math.max(bacPlusMR, ...comparisons.map(c => c.eacValue)) * 1.1;
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

      {/* Management Reserve line (BAC + MR) */}
      {managementReserve > 0 && (() => {
        const mrX = labelW + (bacPlusMR / maxVal) * chartW;
        return (
          <>
            <line x1={mrX} y1={0} x2={mrX} y2={svgH - 16} stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="2 3" />
            <text x={mrX} y={svgH - 4} fontSize={8} fill="#8b5cf6" textAnchor="middle">BAC+MR {formatCurrency(bacPlusMR)}</text>
          </>
        );
      })()}

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
// Earned Schedule computation from S-curve data
// ---------------------------------------------------------------------------

function computeEarnedSchedule(sCurveData: SCurveDataPoint[], currentEV: number): { es: number; at: number; svt: number; spit: number } | null {
  if (!sCurveData || sCurveData.length < 2) return null;

  const today = new Date().toISOString().slice(0, 10);
  const startDate = new Date(sCurveData[0].date).getTime();
  const DAY_MS = 86400000;

  // AT = actual elapsed time in weeks from project start
  const at = (new Date(today).getTime() - startDate) / (DAY_MS * 7);
  if (at <= 0) return null;

  // Find the point on the PV curve where PV = current EV (interpolate)
  let esWeeks = 0;
  for (let i = 0; i < sCurveData.length - 1; i++) {
    const pvI = sCurveData[i].pv;
    const pvNext = sCurveData[i + 1].pv;
    const tI = (new Date(sCurveData[i].date).getTime() - startDate) / (DAY_MS * 7);
    const tNext = (new Date(sCurveData[i + 1].date).getTime() - startDate) / (DAY_MS * 7);

    if (currentEV <= pvNext) {
      // Interpolate
      const fraction = pvNext > pvI ? (currentEV - pvI) / (pvNext - pvI) : 0;
      esWeeks = tI + fraction * (tNext - tI);
      break;
    }
    esWeeks = tNext; // EV exceeds all PV points — ES = last point
  }

  const svt = parseFloat((esWeeks - at).toFixed(2));
  const spit = at > 0 ? parseFloat((esWeeks / at).toFixed(4)) : 1;

  return { es: parseFloat(esWeeks.toFixed(2)), at: parseFloat(at.toFixed(2)), svt, spit };
}

// ---------------------------------------------------------------------------
// Variance Pareto Chart Component
// ---------------------------------------------------------------------------

function VarianceParetoChart({ variances }: { variances: TaskVariance[] }) {
  const top10 = variances.slice(0, 10);
  if (top10.length === 0) return <div className="text-center py-6 text-gray-400 text-sm">No task-level variance data available.</div>;

  const maxAbsCV = Math.max(...top10.map(v => Math.abs(v.cv)), 1);
  const barH = 22;
  const gap = 4;
  const labelW = 160;
  const chartW = 350;
  const valueW = 80;
  const svgW = labelW + chartW + valueW;
  const svgH = top10.length * (barH + gap) + gap;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 320 }}>
      {/* Center line (zero) */}
      <line x1={labelW + chartW / 2} y1={0} x2={labelW + chartW / 2} y2={svgH} stroke="#d1d5db" strokeWidth={1} strokeDasharray="3 2" />

      {top10.map((v, i) => {
        const y = gap + i * (barH + gap);
        const pct = v.cv / maxAbsCV; // -1 to 1
        const barW = Math.abs(pct) * (chartW / 2);
        const x = v.cv >= 0 ? labelW + chartW / 2 : labelW + chartW / 2 - barW;
        const color = v.cv >= 0 ? '#4ade80' : '#f87171';
        const truncName = v.taskName.length > 22 ? v.taskName.slice(0, 20) + '...' : v.taskName;

        return (
          <g key={v.taskId}>
            <text x={labelW - 4} y={y + barH / 2 + 4} fontSize={9} fill="#6b7280" textAnchor="end">{truncName}</text>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill={color} opacity={0.8} />
            <text x={labelW + chartW + 4} y={y + barH / 2 + 4} fontSize={9} fill={v.cv >= 0 ? '#22c55e' : '#ef4444'} fontWeight="600">
              {v.cv >= 0 ? '+' : ''}{formatCurrency(v.cv)}
            </text>
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

  // Task variance data (for Pareto chart)
  const { data: varianceData } = useQuery({
    queryKey: ['evm-variances', selectedProjectId],
    queryFn: () => apiService.getEVMTaskVariances(selectedProjectId),
    enabled: !!selectedProjectId && !isSample,
  });
  const taskVariances: TaskVariance[] = varianceData?.variances || [];

  // What-If simulator state
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [whatIfCPI, setWhatIfCPI] = useState<number | null>(null);
  const [whatIfBudgetAdd, setWhatIfBudgetAdd] = useState(0);

  // Trend chart: cumulative vs period toggle
  const [trendMode, setTrendMode] = useState<'period' | 'cumulative'>('period');

  // Threshold config for trend chart reference lines
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [thresholds, setThresholds] = useState(() => {
    try {
      const saved = localStorage.getItem('evm_thresholds');
      if (saved) return JSON.parse(saved) as { cpiAmber: number; cpiRed: number; spiAmber: number; spiRed: number };
    } catch { /* ignore */ }
    return { cpiAmber: 0.95, cpiRed: 0.85, spiAmber: 0.95, spiRed: 0.85 };
  });
  const updateThreshold = (key: keyof typeof thresholds, val: number) => {
    const next = { ...thresholds, [key]: val };
    setThresholds(next);
    localStorage.setItem('evm_thresholds', JSON.stringify(next));
  };

  // Management Reserve (per project, localStorage)
  const mrKey = `evm_mr_${selectedProjectId}`;
  const [managementReserve, setManagementReserve] = useState(0);
  // Sync MR from localStorage when project changes
  const prevProjectRef = useRef(selectedProjectId);
  if (selectedProjectId !== prevProjectRef.current) {
    prevProjectRef.current = selectedProjectId;
    try {
      const saved = localStorage.getItem(`evm_mr_${selectedProjectId}`);
      setManagementReserve(saved ? parseFloat(saved) : 0);
    } catch { setManagementReserve(0); }
  }
  const updateMR = (val: number) => {
    setManagementReserve(val);
    localStorage.setItem(mrKey, String(val));
  };

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

  // Cumulative CPI/SPI computed from S-curve data
  const cumulativeTrend = useMemo(() => {
    const sc = result?.sCurveData;
    if (!sc || sc.length < 2) return null;
    const data = sc.map(p => ({
      date: p.date,
      cpi: p.ac > 0 ? p.ev / p.ac : 1,
      spi: p.pv > 0 ? p.ev / p.pv : 1,
    }));
    const maxY = Math.max(1.5, ...data.map(d => Math.max(d.cpi, d.spi)));
    const minY = Math.min(0.5, ...data.map(d => Math.min(d.cpi, d.spi)));
    const rangeY = maxY - minY || 1;

    const toX = (i: number) => PAD.left + (i / (data.length - 1)) * plotW;
    const toY = (v: number) => PAD.top + (1 - (v - minY) / rangeY) * plotH;

    const cpiPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.cpi)}`).join(' ');
    const spiPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.spi)}`).join(' ');
    const baselineY = toY(1.0);

    return { data, cpiPath, spiPath, baselineY, toX, toY, minY, maxY, rangeY };
  }, [result?.sCurveData, plotW, plotH]);

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
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">CPI / SPI Trend</h3>
                <div className="flex items-center gap-2">
                  {/* Period / Cumulative toggle */}
                  {cumulativeTrend && (
                    <div className="flex rounded-md border border-gray-200 dark:border-gray-600 text-[10px] font-medium overflow-hidden">
                      <button
                        onClick={() => setTrendMode('period')}
                        className={`px-2 py-0.5 ${trendMode === 'period' ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                      >Period</button>
                      <button
                        onClick={() => setTrendMode('cumulative')}
                        className={`px-2 py-0.5 ${trendMode === 'cumulative' ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                      >Cumulative</button>
                    </div>
                  )}
                  {/* Threshold config gear */}
                  <button
                    onClick={() => setThresholdOpen(!thresholdOpen)}
                    className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${thresholdOpen ? 'text-primary-500' : 'text-gray-400'}`}
                    title="Configure threshold lines"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Threshold config popover */}
              {thresholdOpen && (
                <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Threshold Reference Lines</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    {([
                      { key: 'cpiAmber' as const, label: 'CPI Amber', color: '#f59e0b' },
                      { key: 'cpiRed' as const, label: 'CPI Red', color: '#ef4444' },
                      { key: 'spiAmber' as const, label: 'SPI Amber', color: '#f59e0b' },
                      { key: 'spiRed' as const, label: 'SPI Red', color: '#ef4444' },
                    ]).map(t => (
                      <label key={t.key} className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                        <span className="w-16">{t.label}</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max="2"
                          value={thresholds[t.key]}
                          onChange={(e) => updateThreshold(t.key, parseFloat(e.target.value) || 0)}
                          className="w-16 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-center"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                // Use cumulative or period data based on toggle
                const useCumulative = trendMode === 'cumulative' && cumulativeTrend;
                const activeLines = useCumulative ? cumulativeTrend : trendLines;
                const activeData = useCumulative ? cumulativeTrend!.data : trendData;
                const hasData = activeData.length >= 2 && activeLines;

                if (!hasData) {
                  return <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Not enough historical data for trend chart.</div>;
                }

                // Compute annotations: crossover points where CPI or SPI crosses 1.0
                const annotations: Array<{ x: number; y: number; metric: string; direction: 'up' | 'down'; date: string }> = [];
                for (let i = 1; i < activeData.length; i++) {
                  const prev = activeData[i - 1];
                  const curr = activeData[i];
                  // CPI crossover
                  if ((prev.cpi < 1 && curr.cpi >= 1) || (prev.cpi >= 1 && curr.cpi < 1)) {
                    annotations.push({ x: activeLines.toX(i), y: activeLines.toY(curr.cpi), metric: 'CPI', direction: curr.cpi >= 1 ? 'up' : 'down', date: curr.date });
                  }
                  // SPI crossover
                  if ((prev.spi < 1 && curr.spi >= 1) || (prev.spi >= 1 && curr.spi < 1)) {
                    annotations.push({ x: activeLines.toX(i), y: activeLines.toY(curr.spi), metric: 'SPI', direction: curr.spi >= 1 ? 'up' : 'down', date: curr.date });
                  }
                }

                return (
                  <>
                    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
                      {/* Grid lines */}
                      {[0.5, 0.75, 1.0, 1.25, 1.5].filter(v => v >= activeLines.minY && v <= activeLines.maxY).map(v => (
                        <g key={v}>
                          <line x1={PAD.left} y1={activeLines.toY(v)} x2={CHART_W - PAD.right} y2={activeLines.toY(v)} className="stroke-gray-200 dark:stroke-gray-600" strokeWidth={v === 1.0 ? 1.5 : 0.5} strokeDasharray={v === 1.0 ? undefined : '4 2'} />
                          <text x={PAD.left - 5} y={activeLines.toY(v) + 3} fontSize={9} className="fill-gray-400 dark:fill-gray-500" textAnchor="end">{v.toFixed(1)}</text>
                        </g>
                      ))}

                      {/* Threshold reference lines */}
                      {[
                        { val: thresholds.cpiAmber, color: '#f59e0b', label: 'CPI ⚠' },
                        { val: thresholds.cpiRed, color: '#ef4444', label: 'CPI ✕' },
                        { val: thresholds.spiAmber, color: '#f59e0b', label: 'SPI ⚠' },
                        { val: thresholds.spiRed, color: '#ef4444', label: 'SPI ✕' },
                      ].filter(t => t.val > activeLines.minY && t.val < activeLines.maxY && t.val !== 1.0).map((t, i) => (
                        <g key={`th-${i}`}>
                          <line x1={PAD.left} y1={activeLines.toY(t.val)} x2={CHART_W - PAD.right} y2={activeLines.toY(t.val)} stroke={t.color} strokeWidth={0.8} strokeDasharray="6 3" opacity={0.5} />
                          <text x={CHART_W - PAD.right + 3} y={activeLines.toY(t.val) + 3} fontSize={7} fill={t.color} opacity={0.7}>{t.val}</text>
                        </g>
                      ))}

                      {/* CPI line */}
                      <path d={activeLines.cpiPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
                      {/* SPI line */}
                      <path d={activeLines.spiPath} fill="none" stroke="#22c55e" strokeWidth={2} />
                      {/* 1.0 baseline label */}
                      <text x={CHART_W - PAD.right + 3} y={activeLines.baselineY + 3} fontSize={8} className="fill-gray-400 dark:fill-gray-500">1.0</text>

                      {/* Trend annotations: crossover markers */}
                      {annotations.map((a, i) => (
                        <g key={`ann-${i}`}>
                          <polygon
                            points={a.direction === 'up'
                              ? `${a.x},${a.y - 8} ${a.x - 4},${a.y - 2} ${a.x + 4},${a.y - 2}`
                              : `${a.x},${a.y + 8} ${a.x - 4},${a.y + 2} ${a.x + 4},${a.y + 2}`}
                            fill={a.direction === 'up' ? '#22c55e' : '#ef4444'}
                            opacity={0.8}
                          />
                          <title>{`${a.metric} crossed ${a.direction === 'up' ? 'above' : 'below'} 1.0 on ${new Date(a.date).toLocaleDateString()}`}</title>
                        </g>
                      ))}

                      {/* X axis labels */}
                      {activeData.map((d, i) => {
                        if (i % Math.max(1, Math.floor(activeData.length / 6)) !== 0) return null;
                        return (
                          <text key={i} x={activeLines.toX(i)} y={CHART_H - 5} fontSize={8} className="fill-gray-400 dark:fill-gray-500" textAnchor="middle">
                            {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </text>
                        );
                      })}
                      {/* Dots on latest */}
                      {activeData.length > 0 && (() => {
                        const last = activeData[activeData.length - 1];
                        const x = activeLines.toX(activeData.length - 1);
                        return (
                          <>
                            <circle cx={x} cy={activeLines.toY(last.cpi)} r={4} fill="#3b82f6" />
                            <circle cx={x} cy={activeLines.toY(last.spi)} r={4} fill="#22c55e" />
                          </>
                        );
                      })()}
                    </svg>

                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> CPI</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> SPI</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-gray-300 dark:bg-gray-500 inline-block" /> Baseline (1.0)</span>
                      {annotations.length > 0 && (
                        <span className="flex items-center gap-1 ml-2">
                          <span className="text-[10px]">▲▼</span> Crossover points
                        </span>
                      )}
                    </div>
                  </>
                );
              })()}
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
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary-500" />
                  Forecast Comparison
                </h3>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>MR:</span>
                  <div className="relative">
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={managementReserve || ''}
                      placeholder="0"
                      onChange={(e) => updateMR(parseFloat(e.target.value) || 0)}
                      className="w-24 pl-4 pr-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-right"
                    />
                  </div>
                </label>
              </div>

              {/* Bar chart */}
              <div className="mb-4">
                <ForecastBarChart comparisons={result.forecastComparison} bac={m.BAC} managementReserve={managementReserve} />
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
                    {managementReserve > 0 && (
                      <tr className="border-t-2 border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10">
                        <td className="px-4 py-2 font-medium text-purple-700 dark:text-purple-300">Management Reserve</td>
                        <td className="px-4 py-2 text-right text-purple-700 dark:text-purple-300">{formatCurrency(managementReserve)}</td>
                        <td className="px-4 py-2 text-right text-xs text-gray-500">
                          {(() => {
                            const worstEAC = Math.max(...result.forecastComparison.map(f => f.eacValue));
                            const remaining = (m.BAC + managementReserve) - worstEAC;
                            return remaining >= 0
                              ? <span className="text-green-600 font-medium">{formatCurrency(remaining)} reserve remaining</span>
                              : <span className="text-red-600 font-medium">{formatCurrency(Math.abs(remaining))} beyond reserve</span>;
                          })()}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TCPI Dual Target + Earned Schedule */}
          {(() => {
            const tcpiBac = (m.BAC - m.AC) > 0 ? (m.BAC - m.EV) / (m.BAC - m.AC) : Infinity;
            const tcpiEac = (m.EAC - m.AC) > 0 ? (m.BAC - m.EV) / (m.EAC - m.AC) : Infinity;
            const es = result.sCurveData ? computeEarnedSchedule(result.sCurveData, m.EV) : null;

            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* TCPI Dual Target */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary-500" />
                    TCPI — Dual Target Analysis
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-xs text-gray-500 mb-1">To finish on <strong>original budget</strong> (BAC)</div>
                      <div className={`text-3xl font-bold ${tcpiBac > 1.2 ? 'text-red-600' : tcpiBac > 1.05 ? 'text-amber-600' : 'text-green-600'}`}>
                        {tcpiBac === Infinity ? '—' : tcpiBac.toFixed(2)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {tcpiBac > 1.2 ? 'Unrealistic — consider rebaselining' : tcpiBac > 1.05 ? 'Challenging but achievable' : 'Achievable at current pace'}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500 mb-1">To finish on <strong>current forecast</strong> (EAC)</div>
                      <div className={`text-3xl font-bold ${tcpiEac > 1.2 ? 'text-red-600' : tcpiEac > 1.05 ? 'text-amber-600' : 'text-green-600'}`}>
                        {tcpiEac === Infinity ? '—' : tcpiEac.toFixed(2)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {tcpiEac > 1.2 ? 'Even adjusted forecast at risk' : tcpiEac > 1.05 ? 'Moderate effort needed' : 'On track for adjusted forecast'}
                      </div>
                    </div>
                  </div>
                  {tcpiBac > 1.2 && tcpiEac <= 1.1 && (
                    <div className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                      The gap between TCPI(BAC) and TCPI(EAC) suggests the original budget is no longer realistic. Consider a formal rebaseline to {formatCurrency(m.EAC)}.
                    </div>
                  )}
                </div>

                {/* Earned Schedule */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary-500" />
                    Earned Schedule (Time-Based)
                  </h3>
                  {es ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-gray-500">Earned Schedule (ES)</div>
                          <div className="text-lg font-bold text-gray-900 dark:text-white">{es.es.toFixed(1)} wks</div>
                          <div className="text-[10px] text-gray-400">Planned time to earn current EV</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Actual Time (AT)</div>
                          <div className="text-lg font-bold text-gray-900 dark:text-white">{es.at.toFixed(1)} wks</div>
                          <div className="text-[10px] text-gray-400">Elapsed since project start</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-gray-500">SV(t) — Schedule Variance (time)</div>
                          <div className={`text-lg font-bold ${es.svt >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {es.svt >= 0 ? '+' : ''}{es.svt.toFixed(1)} wks
                          </div>
                          <div className="text-[10px] text-gray-400">{es.svt >= 0 ? 'Ahead of schedule' : 'Behind schedule'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">SPI(t) — Schedule Performance (time)</div>
                          <div className="text-lg font-bold" style={{ color: indexColor(es.spit) }}>{es.spit.toFixed(2)}</div>
                          <div className="text-[10px] text-gray-400">{es.spit >= 1 ? 'Earning value faster than planned' : 'Earning value slower than planned'}</div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                        Unlike SV($) which converges to zero as a project nears completion, SV(t) remains meaningful throughout the entire project lifecycle.
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400 text-sm">Not enough S-curve data to compute earned schedule.</div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* What-If Scenario Simulator */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setWhatIfOpen(!whatIfOpen)}
              className="w-full flex items-center justify-between px-5 py-4 text-left"
            >
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary-500" />
                What-If Scenario Simulator
              </h3>
              <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${whatIfOpen ? 'rotate-90' : ''}`} />
            </button>
            {whatIfOpen && (() => {
              const simCPI = whatIfCPI ?? m.CPI;
              const simBAC = m.BAC + whatIfBudgetAdd;
              const simEAC = simCPI > 0 ? simBAC / simCPI : simBAC;
              const simETC = Math.max(0, simEAC - m.AC);
              const simVAC = simBAC - simEAC;
              const simTCPI = (simBAC - m.AC) > 0 ? (simBAC - m.EV) / (simBAC - m.AC) : 1;

              return (
                <div className="px-5 pb-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                        Target CPI: <span className="font-bold text-gray-900 dark:text-white">{simCPI.toFixed(2)}</span>
                        <span className="text-gray-400 ml-1">(current: {m.CPI.toFixed(2)})</span>
                      </label>
                      <input
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.01"
                        value={simCPI}
                        onChange={(e) => setWhatIfCPI(parseFloat(e.target.value))}
                        className="w-full accent-primary-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>0.50</span><span>1.00</span><span>1.50</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                        Budget Adjustment: <span className="font-bold text-gray-900 dark:text-white">{whatIfBudgetAdd >= 0 ? '+' : ''}{formatCurrency(whatIfBudgetAdd)}</span>
                      </label>
                      <input
                        type="range"
                        min={-m.BAC * 0.3}
                        max={m.BAC * 0.5}
                        step={Math.max(100, Math.round(m.BAC * 0.01))}
                        value={whatIfBudgetAdd}
                        onChange={(e) => setWhatIfBudgetAdd(parseFloat(e.target.value))}
                        className="w-full accent-primary-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>-{formatCurrency(m.BAC * 0.3)}</span><span>0</span><span>+{formatCurrency(m.BAC * 0.5)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Simulated EAC', current: m.EAC, sim: simEAC, warn: simEAC > simBAC },
                      { label: 'Simulated ETC', current: m.ETC, sim: simETC, warn: false },
                      { label: 'Simulated VAC', current: m.VAC, sim: simVAC, warn: simVAC < 0 },
                      { label: 'Simulated TCPI', current: m.TCPI, sim: simTCPI, warn: simTCPI > 1.1, isIndex: true },
                    ].map((s) => {
                      const changed = Math.abs(s.sim - s.current) > 0.01;
                      return (
                        <div key={s.label} className={`rounded-lg border p-3 ${s.warn ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'}`}>
                          <div className="text-[10px] text-gray-500 uppercase font-semibold">{s.label}</div>
                          <div className={`text-lg font-bold ${s.warn ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                            {s.isIndex ? s.sim.toFixed(2) : formatCurrency(s.sim)}
                          </div>
                          {changed && (
                            <div className="text-[10px] text-gray-400">
                              was {s.isIndex ? s.current.toFixed(2) : formatCurrency(s.current)}
                              <span className={`ml-1 font-semibold ${(s.label.includes('VAC') ? s.sim > s.current : s.sim < s.current) ? 'text-green-500' : 'text-red-500'}`}>
                                ({s.sim > s.current ? '+' : ''}{s.isIndex ? (s.sim - s.current).toFixed(2) : formatCurrency(s.sim - s.current)})
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => { setWhatIfCPI(null); setWhatIfBudgetAdd(0); }}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Reset to actuals
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Variance Breakdown (Pareto) */}
          {taskVariances.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-primary-500" />
                Cost Variance Breakdown — Top Tasks
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Tasks ranked by absolute cost variance (CV = Earned Value − Actual Cost). Green bars show under-budget tasks; red bars show over-budget tasks.
              </p>
              <VarianceParetoChart variances={taskVariances} />

              {/* Compact table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700">
                      <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">Task</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">Budget</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">Actual</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">CV</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">SV</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskVariances.slice(0, 10).map((v) => (
                      <tr key={v.taskId} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-3 py-1.5 text-gray-900 dark:text-white max-w-[200px] truncate">{v.taskName}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">{formatCurrency(v.budgetAllocated)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">{formatCurrency(v.actualCost)}</td>
                        <td className={`px-3 py-1.5 text-right font-medium ${v.cv >= 0 ? 'text-green-600' : 'text-red-600'}`}>{v.cv >= 0 ? '+' : ''}{formatCurrency(v.cv)}</td>
                        <td className={`px-3 py-1.5 text-right font-medium ${v.sv >= 0 ? 'text-green-600' : 'text-red-600'}`}>{v.sv >= 0 ? '+' : ''}{formatCurrency(v.sv)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">{v.progressPct}%</td>
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

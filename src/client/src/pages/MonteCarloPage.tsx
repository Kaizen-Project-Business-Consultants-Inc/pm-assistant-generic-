import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Dices,
  Play,
  AlertTriangle,
  Calendar,
  Clock,
  DollarSign,
  ChevronDown,
  BarChart3,
  Activity,
  Target,
  Lock,
} from 'lucide-react';
import { apiService } from '../services/api';
import { MonteCarloHistogram } from '../components/montecarlo/MonteCarloHistogram';
import { TornadoDiagram } from '../components/montecarlo/TornadoDiagram';
import { CriticalityIndex } from '../components/montecarlo/CriticalityIndex';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
}

interface Schedule {
  id: string;
  name: string;
  projectId: string;
}

interface HistogramBin {
  min: number;
  max: number;
  count: number;
  cumulativePercent: number;
}

interface ConfidenceLevel {
  percentile: number;
  durationDays: number;
  completionDate: string;
}

interface SensitivityEntry {
  taskId: string;
  taskName: string;
  correlationCoefficient: number;
  rank: number;
}

interface CriticalityEntry {
  taskId: string;
  taskName: string;
  criticalityPercent: number;
}

interface CostForecast {
  p50: number;
  p80: number;
  p90: number;
  mean: number;
  standardDeviation: number;
}

interface SimulationResult {
  scheduleId: string;
  iterations: number;
  uncertaintyModel: string;
  confidenceLevels: ConfidenceLevel[];
  histogram: HistogramBin[];
  statistics: {
    mean: number;
    standardDeviation: number;
    min: number;
    max: number;
    p50: number;
    p80: number;
    p90: number;
  };
  sensitivityAnalysis: SensitivityEntry[];
  criticalityIndex: CriticalityEntry[];
  costForecast?: CostForecast;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  color: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({
  label,
  value,
  subValue,
  icon: Icon,
  color,
}) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
    <div className="flex items-center gap-2 mb-2">
      <Icon className={`w-4 h-4 ${color}`} />
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </span>
    </div>
    <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    {subValue && (
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subValue}</p>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function MonteCarloPage() {
  // --- Config state ---
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');
  const [iterations, setIterations] = useState<number>(10000);
  const [uncertaintyModel, setUncertaintyModel] = useState<string>('PERT');

  // --- Fetch projects ---
  const {
    data: projectsData,
    isLoading: projectsLoading,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const projects: Project[] = projectsData?.data || projectsData || [];

  // --- Fetch schedules for selected project ---
  const {
    data: schedulesData,
    isLoading: schedulesLoading,
  } = useQuery({
    queryKey: ['schedules', selectedProjectId],
    queryFn: () => apiService.getSchedules(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  const schedules: Schedule[] = schedulesData?.data || schedulesData || [];

  // --- Simulation mutation ---
  const simulation = useMutation({
    mutationFn: () =>
      apiService.runMonteCarloSimulation(selectedScheduleId, {
        iterations,
        confidenceLevels: [50, 80, 90],
        uncertaintyModel,
      }),
  });

  const rawData = simulation.data?.data || simulation.data || null;
  const result: SimulationResult | null = rawData?.result || rawData || null;
  const isSample: boolean = rawData?.sample || false;

  // --- Handlers ---
  function handleProjectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedProjectId(e.target.value);
    setSelectedScheduleId('');
    simulation.reset();
  }

  function handleScheduleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedScheduleId(e.target.value);
    simulation.reset();
  }

  function handleRun() {
    if (!selectedScheduleId) return;
    simulation.mutate();
  }

  // --- Derived data ---
  const stats = result?.statistics;
  const p50Level = result?.confidenceLevels?.find((c) => c.percentile === 50);
  const p80Level = result?.confidenceLevels?.find((c) => c.percentile === 80);
  const p90Level = result?.confidenceLevels?.find((c) => c.percentile === 90);
  const costForecast = result?.costForecast;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Dices className="w-6 h-6 text-primary-500" />
          Monte Carlo Simulation
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Probabilistic schedule and cost risk analysis using Monte Carlo methods.
        </p>
      </div>

      {/* Configuration Panel */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Settings2Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          Simulation Configuration
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Project selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              Project
            </label>
            <div className="relative">
              <select
                className="w-full appearance-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 pr-8 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                value={selectedProjectId}
                onChange={handleProjectChange}
                disabled={projectsLoading}
              >
                <option value="">Select a project...</option>
                {projects.map((p: Project) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            </div>
          </div>

          {/* Schedule selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              Schedule
            </label>
            <div className="relative">
              <select
                className="w-full appearance-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 pr-8 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors disabled:bg-gray-50 dark:bg-gray-900 disabled:text-gray-400 dark:text-gray-500"
                value={selectedScheduleId}
                onChange={handleScheduleChange}
                disabled={!selectedProjectId || schedulesLoading}
              >
                <option value="">
                  {!selectedProjectId
                    ? 'Select a project first...'
                    : schedulesLoading
                    ? 'Loading schedules…'
                    : 'Select a schedule...'}
                </option>
                {schedules.map((s: Schedule) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            </div>
          </div>

          {/* Iterations */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              Iterations
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
              value={iterations}
              onChange={(e) =>
                setIterations(Math.max(100, Math.min(100000, Number(e.target.value) || 10000)))
              }
              min={100}
              max={100000}
              step={1000}
            />
          </div>

          {/* Uncertainty model */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              Uncertainty Model
            </label>
            <div className="relative">
              <select
                className="w-full appearance-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 pr-8 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                value={uncertaintyModel}
                onChange={(e) => setUncertaintyModel(e.target.value)}
              >
                <option value="PERT">PERT Distribution</option>
                <option value="Triangular">Triangular Distribution</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Run button */}
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleRun}
            disabled={!selectedScheduleId || simulation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm dark:shadow-gray-900/30 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {simulation.isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Running Simulation…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Simulation
              </>
            )}
          </button>

          {simulation.isPending && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Running {iterations.toLocaleString()} iterations...
            </span>
          )}
        </div>

        {/* Error display */}
        {simulation.isError && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Simulation failed. Please check the schedule has tasks with duration estimates and try again.
            </p>
          </div>
        )}
      </div>

      {/* Results Section */}
      {result && (
        <div className="space-y-6">
          {isSample && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Simulation</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    This is a sample simulation with demo data. Upgrade to a paid plan to run Monte Carlo simulations on your actual project schedules with configurable iterations and uncertainty models.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Summary Cards - Duration */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary-500" />
              Duration Forecast
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                label="P50 Duration"
                value={`${Math.round(stats?.p50 || 0)} days`}
                subValue={p50Level ? `By ${formatDate(p50Level.completionDate)}` : undefined}
                icon={Calendar}
                color="text-blue-500"
              />
              <SummaryCard
                label="P80 Duration"
                value={`${Math.round(stats?.p80 || 0)} days`}
                subValue={p80Level ? `By ${formatDate(p80Level.completionDate)}` : undefined}
                icon={Calendar}
                color="text-yellow-500"
              />
              <SummaryCard
                label="P90 Duration"
                value={`${Math.round(stats?.p90 || 0)} days`}
                subValue={p90Level ? `By ${formatDate(p90Level.completionDate)}` : undefined}
                icon={Calendar}
                color="text-red-500"
              />
              <SummaryCard
                label="Mean / Std Dev"
                value={`${Math.round(stats?.mean || 0)} days`}
                subValue={`Std Dev: ${(stats?.standardDeviation || 0).toFixed(1)} days`}
                icon={BarChart3}
                color="text-gray-500 dark:text-gray-400"
              />
            </div>
          </div>

          {/* Histogram */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary-500" />
              Duration Distribution
            </h2>
            <MonteCarloHistogram
              histogram={result.histogram || []}
              p50={stats?.p50 || 0}
              p80={stats?.p80 || 0}
              p90={stats?.p90 || 0}
            />
          </div>

          {/* Sensitivity Analysis */}
          {result.sensitivityAnalysis && result.sensitivityAnalysis.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-orange-500" />
                Sensitivity Analysis
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Tasks ranked by their correlation to overall project duration. Higher values
                indicate a stronger influence on the project finish date.
              </p>
              <TornadoDiagram data={result.sensitivityAnalysis} />
            </div>
          )}

          {/* Criticality Index */}
          {result.criticalityIndex && result.criticalityIndex.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-red-500" />
                Criticality Index
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Percentage of simulation iterations where each task appeared on the critical path.
                Tasks with higher criticality deserve closer monitoring.
              </p>
              <CriticalityIndex data={result.criticalityIndex} />
            </div>
          )}

          {/* Cost Forecast */}
          {costForecast && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-500" />
                Cost Forecast
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  label="P50 Cost"
                  value={formatCurrency(costForecast.p50)}
                  subValue="50% confidence"
                  icon={DollarSign}
                  color="text-blue-500"
                />
                <SummaryCard
                  label="P80 Cost"
                  value={formatCurrency(costForecast.p80)}
                  subValue="80% confidence"
                  icon={DollarSign}
                  color="text-yellow-500"
                />
                <SummaryCard
                  label="P90 Cost"
                  value={formatCurrency(costForecast.p90)}
                  subValue="90% confidence"
                  icon={DollarSign}
                  color="text-red-500"
                />
                <SummaryCard
                  label="Mean / Std Dev"
                  value={formatCurrency(costForecast.mean)}
                  subValue={`Std Dev: ${formatCurrency(costForecast.standardDeviation)}`}
                  icon={BarChart3}
                  color="text-gray-500 dark:text-gray-400"
                />
              </div>
            </div>
          )}

          {/* Simulation metadata footer */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-5 py-3">
            <div className="flex items-center gap-6 text-xs text-gray-500 dark:text-gray-400">
              <span>
                Iterations: <strong className="text-gray-700 dark:text-gray-200">{result.iterations?.toLocaleString()}</strong>
              </span>
              <span>
                Model: <strong className="text-gray-700 dark:text-gray-200">{result.uncertaintyModel}</strong>
              </span>
              <span>
                Range: <strong className="text-gray-700 dark:text-gray-200">
                  {Math.round(stats?.min || 0)} - {Math.round(stats?.max || 0)} days
                </strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Empty state when no simulation has been run */}
      {!result && !simulation.isPending && !simulation.isError && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-center py-16">
          <Dices className="mx-auto h-12 w-12 text-gray-300 mb-3" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
            No Simulation Results
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Select a project and schedule above, configure the simulation parameters, then
            click "Run Simulation" to generate probabilistic forecasts.
          </p>
        </div>
      )}

      {/* Loading state */}
      {simulation.isPending && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Running Monte Carlo Simulation</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Processing {iterations.toLocaleString()} iterations with {uncertaintyModel} distribution...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icon component (to avoid needing additional lucide imports)
// ---------------------------------------------------------------------------

function Settings2Icon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );
}

import { scheduleService, Task } from './ScheduleService';
import { projectService } from './ProjectService';
import { criticalPathService, CriticalPathResult } from './CriticalPathService';
import { type IsWorking, weekdaysOnly, finishFor, onOrAfterWorking, taskWorkingDuration, utcDay, ymdOf } from '../utils/workingDays';
import {
  MonteCarloConfig,
  MonteCarloResult,
  HistogramBin,
  SensitivityItem,
  CriticalityIndexItem,
} from '../schemas/monteCarloSchemas';

// ---------------------------------------------------------------------------
// Task distribution parameters used during simulation
// ---------------------------------------------------------------------------
interface TaskDistribution {
  taskId: string;
  taskName: string;
  optimistic: number;
  mostLikely: number;
  pessimistic: number;
}

// ---------------------------------------------------------------------------
// Forward-pass result for a single iteration
// ---------------------------------------------------------------------------
interface ForwardPassResult {
  totalDuration: number;
  criticalTaskIds: string[];
}

// ---------------------------------------------------------------------------
// Monte Carlo Simulation Service — pure computation, no AI
// ---------------------------------------------------------------------------
export class MonteCarloService {
  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async runSimulation(
    scheduleId: string,
    config?: Partial<MonteCarloConfig>,
  ): Promise<MonteCarloResult> {
    const MAX_ITERATIONS = 50_000;
    const iterations = Math.min(config?.iterations ?? 10000, MAX_ITERATIONS);
    const confidenceLevels = config?.confidenceLevels ?? [50, 80, 90];
    const uncertaintyModel = config?.uncertaintyModel ?? 'pert';

    // 1. Fetch schedule, tasks, and critical-path info
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    if (tasks.length === 0) {
      throw new Error(`No tasks found for schedule: ${scheduleId}`);
    }

    const cpResult: CriticalPathResult =
      await criticalPathService.calculateCriticalPath(scheduleId);

    // Durations and dates count working days on the project calendar
    const isWorking = await projectCalendar(scheduleId);

    // 2. Build task distributions
    const distributions = this.buildDistributions(tasks, isWorking);

    // 3. Build predecessor map  (taskId -> predecessorId[])
    const predecessorMap = new Map<string, string[]>();
    for (const t of tasks) {
      predecessorMap.set(t.id, t.dependencies.map(d => d.dependencyId));
    }

    // 4. Run iterations
    const totalDurations: number[] = [];
    // Per-task: sampled durations per iteration (taskId -> number[])
    const sampledDurationsPerTask = new Map<string, number[]>();
    // Per-task: count of times on critical path
    const criticalityCount = new Map<string, number>();

    for (const dist of distributions) {
      sampledDurationsPerTask.set(dist.taskId, []);
      criticalityCount.set(dist.taskId, 0);
    }

    const distMap = new Map<string, TaskDistribution>();
    for (const d of distributions) {
      distMap.set(d.taskId, d);
    }

    for (let i = 0; i < iterations; i++) {
      // Sample durations for every task
      const sampledDurations = new Map<string, number>();
      for (const dist of distributions) {
        const sampled =
          uncertaintyModel === 'pert'
            ? this.samplePERT(dist.optimistic, dist.mostLikely, dist.pessimistic)
            : this.sampleTriangular(dist.optimistic, dist.mostLikely, dist.pessimistic);
        sampledDurations.set(dist.taskId, sampled);
        sampledDurationsPerTask.get(dist.taskId)!.push(sampled);
      }

      // Forward-pass simulation
      const result = this.simulateForwardPass(tasks, sampledDurations, predecessorMap);
      totalDurations.push(result.totalDuration);

      // Track criticality
      for (const cid of result.criticalTaskIds) {
        criticalityCount.set(cid, (criticalityCount.get(cid) || 0) + 1);
      }
    }

    // 5. Compute statistics
    const sorted = [...totalDurations].sort((a, b) => a - b);

    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = totalDurations.reduce((s, v) => s + v, 0) / iterations;
    const variance =
      totalDurations.reduce((s, v) => s + (v - mean) ** 2, 0) / iterations;
    const stdDev = Math.sqrt(variance);

    const p50 = this.computePercentile(sorted, 50);
    const p80 = this.computePercentile(sorted, 80);
    const p90 = this.computePercentile(sorted, 90);

    // Completion dates: the finish day of a run of `days` working days from the schedule
    // start (start day counted), on the project calendar
    const scheduleStart = onOrAfterWorking(utcDay(schedule.startDate), isWorking);
    const toDateStr = (days: number): string =>
      ymdOf(finishFor(scheduleStart, Math.round(days), isWorking));

    const completionDate = {
      p50: toDateStr(p50),
      p80: toDateStr(p80),
      p90: toDateStr(p90),
    };

    const durationStats = {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      p50: Math.round(p50 * 100) / 100,
      p80: Math.round(p80 * 100) / 100,
      p90: Math.round(p90 * 100) / 100,
    };

    // Histogram
    const histogram = { bins: this.buildHistogram(sorted, 20) };

    // Sensitivity analysis (Spearman rank correlation)
    const sensitivityAnalysis = this.computeSensitivity(
      distributions,
      sampledDurationsPerTask,
      totalDurations,
    );

    // Criticality index
    const criticalityIndex: CriticalityIndexItem[] = distributions
      .map((d) => ({
        taskId: d.taskId,
        taskName: d.taskName,
        criticalityPercent:
          Math.round(((criticalityCount.get(d.taskId) || 0) / iterations) * 10000) / 100,
      }))
      .sort((a, b) => b.criticalityPercent - a.criticalityPercent);

    // Cost forecast — proportional to duration ratios against deterministic duration
    const deterministicDuration = cpResult.projectDuration || p50;
    let budget = 0;
    try {
      const project = await projectService.findById(schedule.projectId);
      if (project?.budgetAllocated) {
        budget = project.budgetAllocated;
      }
    } catch {
      // budget stays 0 — cost forecast will be zero-valued
    }

    const costForecast = {
      p50: budget > 0 ? Math.round((p50 / deterministicDuration) * budget) : 0,
      p80: budget > 0 ? Math.round((p80 / deterministicDuration) * budget) : 0,
      p90: budget > 0 ? Math.round((p90 / deterministicDuration) * budget) : 0,
    };

    const simulationConfig = {
      iterations,
      confidenceLevels,
      uncertaintyModel,
    };

    return {
      completionDate,
      durationStats,
      histogram,
      sensitivityAnalysis,
      criticalityIndex,
      costForecast,
      simulationConfig,
      iterationsRun: iterations,
    };
  }

  // -----------------------------------------------------------------------
  // Distribution builders
  // -----------------------------------------------------------------------

  private buildDistributions(tasks: Task[], isWorking: IsWorking = weekdaysOnly): TaskDistribution[] {
    return tasks.map((t) => {
      // Working days, as the Duration column and the critical path count them
      const mostLikely = taskWorkingDuration(t, isWorking);

      const optimistic = mostLikely * 0.75;

      let pessimisticMultiplier: number;
      switch (t.priority) {
        case 'low':
          pessimisticMultiplier = 1.5;
          break;
        case 'medium':
          pessimisticMultiplier = 1.75;
          break;
        case 'high':
        case 'urgent':
          pessimisticMultiplier = 2.0;
          break;
        default:
          pessimisticMultiplier = 1.75;
      }
      const pessimistic = mostLikely * pessimisticMultiplier;

      return {
        taskId: t.id,
        taskName: t.name,
        optimistic,
        mostLikely,
        pessimistic,
      };
    });
  }

  // -----------------------------------------------------------------------
  // PERT (Beta) distribution sampling
  // -----------------------------------------------------------------------

  private samplePERT(opt: number, ml: number, pess: number): number {
    // PERT mean and standard deviation
    const mean = (opt + 4 * ml + pess) / 6;
    const sd = (pess - opt) / 6;

    if (sd <= 0) return mean;

    // Shape parameters for Beta distribution mapped to [opt, pess]
    const alpha1 = ((mean - opt) / (pess - opt)) * (
      ((mean - opt) * (pess - mean)) / (sd * sd) - 1
    );
    const alpha2 = alpha1 * (pess - mean) / (mean - opt);

    // Clamp shape parameters to sensible range
    const a = Math.max(1.001, alpha1);
    const b = Math.max(1.001, alpha2);

    // Sample from Beta(a, b) using Joehnk's method for simplicity
    const betaSample = this.sampleBeta(a, b);

    // Scale to [opt, pess]
    return opt + betaSample * (pess - opt);
  }

  // -----------------------------------------------------------------------
  // Beta distribution sampling (rejection / Joehnk-inspired)
  // -----------------------------------------------------------------------

  private sampleBeta(alpha: number, beta: number): number {
    // Use the gamma-ratio method: Beta(a,b) = G(a) / (G(a) + G(b))
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    if (x + y === 0) return 0.5;
    return x / (x + y);
  }

  // -----------------------------------------------------------------------
  // Gamma distribution sampling (Marsaglia & Tsang's method)
  // -----------------------------------------------------------------------

  private sampleGamma(shape: number): number {
    if (shape < 1) {
      // Boost: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
      return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.sampleStandardNormal();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * (x * x) * (x * x)) {
        return d * v;
      }
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Standard normal sampling (Box-Muller transform)
  // -----------------------------------------------------------------------

  private sampleStandardNormal(): number {
    let u: number;
    let v: number;
    let s: number;
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    return u * Math.sqrt((-2 * Math.log(s)) / s);
  }

  // -----------------------------------------------------------------------
  // Triangular distribution sampling
  // -----------------------------------------------------------------------

  private sampleTriangular(opt: number, ml: number, pess: number): number {
    const u = Math.random();
    const range = pess - opt;
    if (range === 0) return ml;
    const fc = (ml - opt) / range;
    if (u < fc) {
      return opt + Math.sqrt(u * range * (ml - opt));
    }
    return pess - Math.sqrt((1 - u) * range * (pess - ml));
  }

  // -----------------------------------------------------------------------
  // Forward-pass network simulation
  // -----------------------------------------------------------------------

  private simulateForwardPass(
    tasks: Task[],
    sampledDurations: Map<string, number>,
    predecessorMap: Map<string, string[]>,
  ): ForwardPassResult {
    // Build successor map for topological sort
    const taskIds = new Set(tasks.map((t) => t.id));
    const successors = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const t of tasks) {
      successors.set(t.id, []);
      inDegree.set(t.id, 0);
    }

    for (const t of tasks) {
      const preds = predecessorMap.get(t.id) || [];
      for (const pred of preds) {
        if (taskIds.has(pred)) {
          successors.get(pred)!.push(t.id);
          inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
        }
      }
    }

    // Topological order (Kahn's)
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      topoOrder.push(id);
      for (const succ of successors.get(id) || []) {
        const newDeg = (inDegree.get(succ) || 1) - 1;
        inDegree.set(succ, newDeg);
        if (newDeg === 0) queue.push(succ);
      }
    }

    // Include any remaining tasks (cycle protection)
    if (topoOrder.length < tasks.length) {
      for (const t of tasks) {
        if (!topoOrder.includes(t.id)) topoOrder.push(t.id);
      }
    }

    // Forward pass — Early Start / Early Finish
    const esMap = new Map<string, number>();
    const efMap = new Map<string, number>();

    for (const id of topoOrder) {
      const dur = sampledDurations.get(id) || 1;
      let es = 0;
      for (const pred of predecessorMap.get(id) || []) {
        if (efMap.has(pred)) {
          es = Math.max(es, efMap.get(pred)!);
        }
      }
      esMap.set(id, es);
      efMap.set(id, es + dur);
    }

    // Project duration
    let totalDuration = 0;
    for (const ef of efMap.values()) {
      totalDuration = Math.max(totalDuration, ef);
    }

    // Backward pass — Late Start / Late Finish to find critical tasks
    const lsMap = new Map<string, number>();
    const lfMap = new Map<string, number>();

    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const id = topoOrder[i];
      const dur = sampledDurations.get(id) || 1;
      const succs = successors.get(id) || [];

      let lf = totalDuration;
      for (const succ of succs) {
        if (lsMap.has(succ)) {
          lf = Math.min(lf, lsMap.get(succ)!);
        }
      }
      lfMap.set(id, lf);
      lsMap.set(id, lf - dur);
    }

    // Critical tasks: total float ~= 0 (within floating-point tolerance)
    const criticalTaskIds: string[] = [];
    for (const id of topoOrder) {
      const totalFloat = (lsMap.get(id) || 0) - (esMap.get(id) || 0);
      if (Math.abs(totalFloat) < 0.0001) {
        criticalTaskIds.push(id);
      }
    }

    return { totalDuration, criticalTaskIds };
  }

  // -----------------------------------------------------------------------
  // Spearman rank correlation
  // -----------------------------------------------------------------------

  private computeSpearmanCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n < 2) return 0;

    const rankX = this.computeRanks(x);
    const rankY = this.computeRanks(y);

    let sumDSq = 0;
    for (let i = 0; i < n; i++) {
      const d = rankX[i] - rankY[i];
      sumDSq += d * d;
    }

    return 1 - (6 * sumDSq) / (n * (n * n - 1));
  }

  private computeRanks(values: number[]): number[] {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);

    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j < indexed.length && indexed[j].v === indexed[i].v) {
        j++;
      }
      const avgRank = (i + j - 1) / 2 + 1; // 1-based average rank for ties
      for (let k = i; k < j; k++) {
        ranks[indexed[k].i] = avgRank;
      }
      i = j;
    }
    return ranks;
  }

  // -----------------------------------------------------------------------
  // Sensitivity analysis (Spearman correlation for each task vs total duration)
  // -----------------------------------------------------------------------

  private computeSensitivity(
    distributions: TaskDistribution[],
    sampledDurationsPerTask: Map<string, number[]>,
    totalDurations: number[],
  ): SensitivityItem[] {
    const items: SensitivityItem[] = [];

    for (const dist of distributions) {
      const taskDurations = sampledDurationsPerTask.get(dist.taskId);
      if (!taskDurations || taskDurations.length === 0) continue;

      const corr = this.computeSpearmanCorrelation(taskDurations, totalDurations);
      items.push({
        taskId: dist.taskId,
        taskName: dist.taskName,
        correlationCoefficient: Math.round(corr * 10000) / 10000,
        rank: 0, // will be assigned after sorting
      });
    }

    // Sort by absolute correlation descending
    items.sort(
      (a, b) =>
        Math.abs(b.correlationCoefficient) - Math.abs(a.correlationCoefficient),
    );

    // Assign ranks
    for (let i = 0; i < items.length; i++) {
      items[i].rank = i + 1;
    }

    return items;
  }

  // -----------------------------------------------------------------------
  // Histogram builder
  // -----------------------------------------------------------------------

  private buildHistogram(sortedValues: number[], binCount: number): HistogramBin[] {
    if (sortedValues.length === 0) return [];

    const min = sortedValues[0];
    const max = sortedValues[sortedValues.length - 1];
    const range = max - min;

    // Handle case where all values are the same
    if (range === 0) {
      return [
        {
          min: Math.round(min * 100) / 100,
          max: Math.round(max * 100) / 100,
          count: sortedValues.length,
          cumulativePercent: 100,
        },
      ];
    }

    const binWidth = range / binCount;
    const bins: HistogramBin[] = [];
    let cumulative = 0;

    for (let b = 0; b < binCount; b++) {
      const binMin = min + b * binWidth;
      const binMax = b === binCount - 1 ? max + 0.001 : min + (b + 1) * binWidth;

      let count = 0;
      for (const v of sortedValues) {
        if (v >= binMin && v < binMax) count++;
        // Last bin includes the max value
        if (b === binCount - 1 && v === max) count++;
      }
      // Avoid double-counting on last bin boundary
      if (b === binCount - 1) {
        // Recount properly for last bin
        count = 0;
        for (const v of sortedValues) {
          if (v >= binMin && v <= max) count++;
        }
      }

      cumulative += count;
      bins.push({
        min: Math.round(binMin * 100) / 100,
        max: Math.round((b === binCount - 1 ? max : min + (b + 1) * binWidth) * 100) / 100,
        count,
        cumulativePercent:
          Math.round((cumulative / sortedValues.length) * 10000) / 100,
      });
    }

    return bins;
  }

  // -----------------------------------------------------------------------
  // Percentile computation (linear interpolation)
  // -----------------------------------------------------------------------

  private computePercentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const fraction = index - lower;

    if (upper >= sorted.length) return sorted[sorted.length - 1];
    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  }
}

export const monteCarloService = new MonteCarloService();

/** The schedule's project calendar; Mon–Fri when it cannot be read */
async function projectCalendar(scheduleId: string): Promise<IsWorking> {
  try {
    return (await scheduleService.workingDayTest(scheduleId)) || weekdaysOnly;
  } catch {
    return weekdaysOnly;
  }
}

export type TaskRiskLevel = 'none' | 'at_risk' | 'critical' | 'late';

export interface RiskThresholds {
  atRiskGapPct: number;
  criticalGapPct: number;
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  atRiskGapPct: 20,
  criticalGapPct: 40,
};

interface TaskLike {
  id: string;
  status: string;
  startDate?: string;
  endDate?: string;
  progressPercentage?: number;
}

export function assessTaskRisk(task: TaskLike, thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS): TaskRiskLevel {
  const status = task.status?.toLowerCase();
  if (status === 'completed' || status === 'done' || status === 'cancelled') return 'none';
  if (!task.startDate || !task.endDate) return 'none';

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(task.endDate);
  end.setHours(0, 0, 0, 0);

  if (end < now) return 'late';

  const start = new Date(task.startDate);
  start.setHours(0, 0, 0, 0);
  const totalDuration = end.getTime() - start.getTime();
  if (totalDuration <= 0) return 'none';

  const elapsed = now.getTime() - start.getTime();
  if (elapsed <= 0) return 'none';

  const expectedProgress = Math.min(100, (elapsed / totalDuration) * 100);
  const actualProgress = task.progressPercentage ?? 0;
  const gap = expectedProgress - actualProgress;

  if (gap >= thresholds.criticalGapPct) return 'critical';
  if (gap >= thresholds.atRiskGapPct) return 'at_risk';
  return 'none';
}

export function buildTaskRiskMap(tasks: TaskLike[], thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS): Map<string, TaskRiskLevel> {
  const map = new Map<string, TaskRiskLevel>();
  for (const task of tasks) {
    map.set(task.id, assessTaskRisk(task, thresholds));
  }
  return map;
}

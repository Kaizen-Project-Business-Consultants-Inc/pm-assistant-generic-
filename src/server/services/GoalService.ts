import { goalRepository, Goal } from '../database/GoalRepository';

export type { Goal } from '../database/GoalRepository';

export interface CreateGoalData {
  name: string;
  description?: string;
  ownerId: string;
  parentId?: string;
  goalType: 'objective' | 'key_result';
  status?: 'on_track' | 'at_risk' | 'behind' | 'completed';
  progress?: number;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  startDate?: string;
  dueDate?: string;
  projectId?: string;
}

/**
 * A key result's progress is how far its measure has got: current / target (0–100). It used to
 * stay at 0% whatever the figures said ("3 / 10 proposals" showed 0%), and so did the objective
 * it rolls up into (found 2026-09-30). Null when there is nothing to measure.
 */
export function measuredProgress(targetValue: number | null | undefined, currentValue: number | null | undefined): number | null {
  if (targetValue == null || currentValue == null || !(Number(targetValue) > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((Number(currentValue) / Number(targetValue)) * 100)));
}

export class GoalService {
  async findById(id: string): Promise<Goal | null> {
    return goalRepository.findById(id);
  }

  async listByOwner(ownerId: string): Promise<Goal[]> {
    return goalRepository.findByOwner(ownerId);
  }

  async listByProject(projectId: string): Promise<Goal[]> {
    return goalRepository.findByProject(projectId);
  }

  async list(filters?: { ownerId?: string; projectId?: string; goalType?: string; status?: string }): Promise<Goal[]> {
    return goalRepository.findFiltered(filters);
  }

  async create(data: CreateGoalData): Promise<Goal> {
    if (data.goalType === 'key_result' && data.progress === undefined) {
      const measured = measuredProgress(data.targetValue, data.currentValue);
      if (measured !== null) data = { ...data, progress: measured };
    }
    return goalRepository.insert(data);
  }

  async update(id: string, data: Partial<Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Goal | null> {
    const existing = await goalRepository.findById(id);
    if (!existing) return null;
    // A key result's figures changed (and no explicit progress given): progress follows them
    if (existing.goalType === 'key_result' && data.progress === undefined && ('targetValue' in data || 'currentValue' in data)) {
      const measured = measuredProgress(data.targetValue ?? existing.targetValue, data.currentValue ?? existing.currentValue);
      if (measured !== null) data = { ...data, progress: measured };
    }
    return goalRepository.update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return goalRepository.deleteById(id);
  }

  async recalculateObjectiveProgress(objectiveId: string): Promise<Goal | null> {
    const objective = await goalRepository.findById(objectiveId);
    if (!objective || objective.goalType !== 'objective') return objective;

    const childProgress = await goalRepository.getChildProgress(objectiveId);
    if (childProgress.length === 0) return objective;

    const totalProgress = childProgress.reduce((sum, p) => sum + p, 0);
    const avgProgress = Math.round(totalProgress / childProgress.length);

    await goalRepository.updateProgress(objectiveId, avgProgress);
    return goalRepository.findById(objectiveId);
  }
}

export const goalService = new GoalService();

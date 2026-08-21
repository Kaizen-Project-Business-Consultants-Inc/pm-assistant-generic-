import { sprintRepository } from '../database/SprintRepository';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';

export interface Sprint {
  id: string;
  projectId: string;
  scheduleId: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  status: string;
  velocityCommitment: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SprintTask {
  id: string;
  sprintId: string;
  taskId: string;
  storyPoints: number | null;
  addedAt: string;
}

interface BoardTask {
  id: string;
  name: string;
  status: string;
  storyPoints: number | null;
  [key: string]: any;
}

export class SprintService {
  async create(
    projectId: string,
    scheduleId: string,
    data: {
      name: string;
      goal?: string;
      startDate: string;
      endDate: string;
      velocityCommitment?: number;
    },
    userId: string,
  ): Promise<Sprint> {
    const sprint = await sprintRepository.create(projectId, scheduleId, data, userId);

    auditLedgerService.append({
      actorId: userId,
      actorType: 'user',
      action: 'sprint.create',
      entityType: 'sprint',
      entityId: sprint.id,
      projectId: projectId,
      payload: { after: sprint },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return sprint;
  }

  async getByProject(projectId: string): Promise<Sprint[]> {
    return sprintRepository.findByProject(projectId);
  }

  async getByProjectPaginated(projectId: string, limit: number, offset: number): Promise<{ rows: Sprint[]; total: number }> {
    return sprintRepository.findByProjectPaginated(projectId, limit, offset);
  }

  async getTaskStatsBySprintIds(sprintIds: string[]): Promise<Record<string, { totalTasks: number; completedTasks: number; totalPoints: number; completedPoints: number }>> {
    return sprintRepository.getTaskStatsBySprintIds(sprintIds);
  }

  async getBySchedule(scheduleId: string): Promise<Sprint[]> {
    return sprintRepository.findBySchedule(scheduleId);
  }

  async getById(id: string): Promise<Sprint | null> {
    return sprintRepository.findById(id);
  }

  async update(
    id: string,
    data: {
      name?: string;
      goal?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      velocityCommitment?: number;
    },
  ): Promise<Sprint> {
    return sprintRepository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    return sprintRepository.deleteSprint(id);
  }

  async addTask(sprintId: string, taskId: string, storyPoints?: number): Promise<SprintTask> {
    const sprintTask = await sprintRepository.addTask(sprintId, taskId, storyPoints);

    const sprint = await this.getById(sprintId);
    auditLedgerService.append({
      actorId: sprint?.createdBy || 'system',
      actorType: 'user',
      action: 'task.add_to_sprint',
      entityType: 'sprint_task',
      entityId: sprintTask.id,
      projectId: sprint?.projectId ?? null,
      payload: { sprintId, taskId, storyPoints },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return sprintTask;
  }

  async updateTaskStoryPoints(sprintId: string, taskId: string, storyPoints: number): Promise<void> {
    return sprintRepository.updateTaskStoryPoints(sprintId, taskId, storyPoints);
  }

  async removeTask(sprintId: string, taskId: string): Promise<void> {
    return sprintRepository.removeTask(sprintId, taskId);
  }

  async startSprint(id: string): Promise<Sprint> {
    const before = await this.getById(id);
    const sprint = await sprintRepository.updateStatus(id, 'active');

    auditLedgerService.append({
      actorId: sprint.createdBy,
      actorType: 'user',
      action: 'sprint.start',
      entityType: 'sprint',
      entityId: id,
      projectId: sprint.projectId,
      payload: { before, after: sprint },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return sprint;
  }

  async completeSprint(id: string): Promise<Sprint> {
    const before = await this.getById(id);
    const sprint = await sprintRepository.updateStatus(id, 'completed');

    auditLedgerService.append({
      actorId: sprint.createdBy,
      actorType: 'user',
      action: 'sprint.complete',
      entityType: 'sprint',
      entityId: id,
      projectId: sprint.projectId,
      payload: { before, after: sprint },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return sprint;
  }

  async getSprintBoard(id: string): Promise<{ scheduleId: string | null; tasks: BoardTask[] }> {
    return sprintRepository.getSprintBoard(id);
  }

  async getSprintBurndown(id: string): Promise<{
    dates: string[];
    ideal: number[];
    actual: number[];
    totalPoints: number;
    burnup?: { scope: number[]; completed: number[] };
  }> {
    const sprint = await this.getById(id);
    if (!sprint) {
      return { dates: [], ideal: [], actual: [], totalPoints: 0 };
    }

    const totalPoints = await sprintRepository.getTotalPoints(id);
    const completedRows = await sprintRepository.getCompletedTasksWithDates(id);

    // Get scope changes over time (tasks added to sprint with their added_at dates)
    const scopeRows = await sprintRepository.getSprintTasksWithAddedDates(id);

    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const DAY_MS = 86_400_000;
    const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS));

    const dates: string[] = [];
    const ideal: number[] = [];
    const actual: number[] = [];
    const scope: number[] = [];
    const completed: number[] = [];

    for (let dayIndex = 0; dayIndex <= totalDays; dayIndex++) {
      const currentDate = new Date(startDate.getTime() + dayIndex * DAY_MS);
      const dateStr = currentDate.toISOString().slice(0, 10);

      dates.push(dateStr);

      const idealRemaining = totalPoints * (1 - dayIndex / totalDays);
      ideal.push(Math.max(0, Math.round(idealRemaining * 10) / 10));

      if (currentDate <= today) {
        let completedPoints = 0;
        for (const row of completedRows) {
          const completedDate = new Date(row.updated_at);
          completedDate.setHours(0, 0, 0, 0);
          if (completedDate <= currentDate) {
            completedPoints += Number(row.story_points) || 0;
          }
        }
        actual.push(totalPoints - completedPoints);
        completed.push(completedPoints);

        // Scope: cumulative points of tasks added by this date
        let scopePoints = 0;
        for (const row of scopeRows) {
          const addedDate = new Date(row.added_at);
          addedDate.setHours(0, 0, 0, 0);
          if (addedDate <= currentDate) {
            scopePoints += Number(row.story_points) || 0;
          }
        }
        scope.push(scopePoints);
      } else {
        actual.push(-1);
        scope.push(-1);
        completed.push(-1);
      }
    }

    return { dates, ideal, actual, totalPoints, burnup: { scope, completed } };
  }

  async getBacklogTasks(scheduleId: string): Promise<any[]> {
    return sprintRepository.getBacklogTasks(scheduleId);
  }

  async getVelocityHistory(projectId: string): Promise<{
    sprints: Array<{ name: string; velocity: number; commitment: number }>;
  }> {
    const sprints = await sprintRepository.getVelocityHistory(projectId);
    return { sprints };
  }

  async getCumulativeFlow(id: string): Promise<{
    dates: string[];
    series: Record<string, number[]>;
  }> {
    const sprint = await this.getById(id);
    if (!sprint) return { dates: [], series: {} };

    const rows = await sprintRepository.getCumulativeFlowData(id);
    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = today < endDate ? today : endDate;

    const DAY_MS = 86_400_000;
    const totalDays = Math.max(1, Math.round((cutoff.getTime() - startDate.getTime()) / DAY_MS));
    const dates: string[] = [];

    // Determine status groups — map new statuses to flow buckets
    const statusOrder = ['completed', 'testing', 'in_review', 'in_progress', 'blocked', 'not_started'];
    const series: Record<string, number[]> = {};
    for (const s of statusOrder) series[s] = [];

    // Map raw status to flow bucket
    const mapStatus = (status: string): string => {
      if (status === 'completed') return 'completed';
      if (status === 'testing') return 'testing';
      if (status === 'in_review') return 'in_review';
      if (status === 'in_progress') return 'in_progress';
      if (status === 'blocked') return 'blocked';
      if (status === 'cancelled') return 'not_started';
      return 'not_started'; // pending
    };

    // For each day, count tasks in each status
    // We use updated_at to infer when tasks moved to their current status
    for (let d = 0; d <= totalDays; d++) {
      const currentDate = new Date(startDate.getTime() + d * DAY_MS);
      const dateStr = currentDate.toISOString().slice(0, 10);
      dates.push(dateStr);

      const counts: Record<string, number> = {};
      for (const s of statusOrder) counts[s] = 0;

      for (const row of rows) {
        const updatedAt = new Date(row.updated_at);
        updatedAt.setHours(0, 0, 0, 0);
        const bucket = mapStatus(row.status || 'pending');

        if (bucket === 'completed' && updatedAt <= currentDate) {
          counts.completed++;
        } else if (bucket !== 'not_started' && bucket !== 'completed' && updatedAt <= currentDate) {
          counts[bucket]++;
        } else if (bucket === 'completed' && updatedAt > currentDate) {
          counts.in_progress++;
        } else {
          counts.not_started++;
        }
      }

      for (const s of statusOrder) series[s].push(counts[s]);
    }

    return { dates, series };
  }

  async getCapacityRecommendation(sprintId: string): Promise<{
    recommendedVelocity: number;
    avgVelocity: number;
    teamSize: number;
    velocityPerMember: number;
    sprintCount: number;
    confidence: 'low' | 'medium' | 'high';
  }> {
    const sprint = await this.getById(sprintId);
    if (!sprint) {
      return { recommendedVelocity: 0, avgVelocity: 0, teamSize: 0, velocityPerMember: 0, sprintCount: 0, confidence: 'low' };
    }

    const velocity = await this.getVelocityHistory(sprint.projectId);
    const velocities = velocity.sprints.map(s => s.velocity);
    const teamSize = await sprintRepository.getProjectResourceCount(sprint.projectId);

    const sprintCount = velocities.length;
    const avgVelocity = sprintCount > 0
      ? Math.round(velocities.reduce((a, b) => a + b, 0) / sprintCount)
      : 0;

    const velocityPerMember = teamSize > 0 && avgVelocity > 0
      ? Math.round((avgVelocity / teamSize) * 10) / 10
      : 0;

    // Confidence based on data points
    const confidence: 'low' | 'medium' | 'high' = sprintCount >= 5 ? 'high' : sprintCount >= 2 ? 'medium' : 'low';

    // Recommendation: use average velocity, adjusted by team size changes
    // If no history, use team_size * 8 as a rough default (8 pts/person)
    const recommendedVelocity = avgVelocity > 0
      ? avgVelocity
      : teamSize > 0 ? teamSize * 8 : 0;

    return { recommendedVelocity, avgVelocity, teamSize, velocityPerMember, sprintCount, confidence };
  }
}

export const sprintService = new SprintService();

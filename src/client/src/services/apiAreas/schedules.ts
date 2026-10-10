import { ApiBase } from './http';

/**
 * Schedules and tasks: CRUD, comments, bulk operations, baselines, critical path, S-curve, network diagram, what-if scenarios, prioritisation.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class SchedulesApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Schedule endpoints
  // -------------------------------------------------------------------------

  async getSchedules(projectId: string) {
    const response = await this.api.get(`/schedules/project/${projectId}`);
    return response.data;
  }

  async createSchedule(scheduleData: {
    projectId: string;
    name: string;
    description?: string;
    startDate: string;
    endDate: string;
  }) {
    const response = await this.api.post('/schedules', scheduleData);
    return response.data;
  }

  async updateSchedule(scheduleId: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/schedules/${scheduleId}`, data);
    return response.data;
  }

  async deleteSchedule(scheduleId: string) {
    const response = await this.api.delete(`/schedules/${scheduleId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Task endpoints
  // -------------------------------------------------------------------------

  /**
   * Every task in the schedule. The endpoint pages (max 200 per request, default 50), and
   * callers — the Gantt, Table, row numbers — need the whole plan, so fetch all pages.
   * Returns the same shape as a single page.
   */
  async getTasks(scheduleId: string) {
    const PAGE = 200;
    const first = (await this.api.get(`/schedules/${scheduleId}/tasks`, { params: { limit: PAGE, offset: 0 } })).data;
    const all = [...(first?.data ?? [])];
    const total = Number(first?.total ?? all.length);
    while (all.length < total) {
      // eslint-disable-next-line no-await-in-loop -- pages of 200: each request starts where the last one ended and stops on an empty page
      const next = (await this.api.get(`/schedules/${scheduleId}/tasks`, { params: { limit: PAGE, offset: all.length } })).data;
      const rows = next?.data ?? [];
      if (rows.length === 0) break;
      all.push(...rows);
    }
    return { ...first, data: all, total, page: 1, pageSize: all.length, totalPages: 1 };
  }

  async createTask(
    scheduleId: string,
    taskData: {
      name: string;
      description?: string;
      status?: string;
      priority?: string;
      assignedTo?: string;
      dueDate?: string;
      estimatedDays?: number;
      startDate?: string;
      endDate?: string;
      progressPercentage?: number;
      dependency?: string;
      parentTaskId?: string;
      afterTaskId?: string;
      beforeTaskId?: string;
      recurrenceRule?: string;
      isRecurrenceTemplate?: boolean;
      isMilestone?: boolean;
      dependencies?: Array<{ dependencyId: string; dependencyType: string; lagDays: number }>;
    }
  ) {
    const response = await this.api.post(`/schedules/${scheduleId}/tasks`, taskData);
    return response.data;
  }

  async updateTask(scheduleId: string, taskId: string, taskData: Record<string, unknown>) {
    const response = await this.api.put(`/schedules/${scheduleId}/tasks/${taskId}`, taskData);
    return response.data;
  }

  /** `changeId`: the Schedule History entry — undoing it puts the task back (same id) */
  async deleteTask(scheduleId: string, taskId: string): Promise<{ message: string; changeId: string | null }> {
    const response = await this.api.delete(`/schedules/${scheduleId}/tasks/${taskId}`);
    return response.data;
  }

  async expandRecurrence(scheduleId: string, taskId: string, horizonDays = 90) {
    const response = await this.api.post(`/schedules/${scheduleId}/tasks/${taskId}/expand-recurrence`, { horizonDays });
    return response.data;
  }

  async deleteRecurrenceChildren(scheduleId: string, taskId: string) {
    const response = await this.api.delete(`/schedules/${scheduleId}/tasks/${taskId}/recurrence-children`);
    return response.data;
  }

  async importStructured(scheduleId: string, tasks: Array<{ name: string; uid?: number; wbs?: string; startDate?: string; endDate?: string; duration?: number; predecessors?: string; isMilestone?: boolean; percentComplete?: number; outlineLevel?: number }>, fileName?: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/import-structured`, { tasks, fileName });
    return response.data;
  }

  async importDocument(scheduleId: string, file: File): Promise<{ tasks: Array<{ name: string; wbs: string; startDate: string | null; endDate: string | null; duration: number | null; isSummary: boolean; predecessors: string | null }>; documentName: string; textLength: number; tokensUsed: number }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await this.api.post(`/schedules/${scheduleId}/import-document`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // What-If Scenarios
  // -------------------------------------------------------------------------

  async cloneSchedule(scheduleId: string, label?: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/clone`, { label });
    return response.data;
  }

  async getScenarios(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/scenarios`);
    return response.data;
  }

  async compareSchedules(baseId: string, scenarioId: string) {
    const response = await this.api.get(`/schedules/${baseId}/compare/${scenarioId}`);
    return response.data;
  }

  async promoteScenario(baseId: string, scenarioId: string) {
    const response = await this.api.post(`/schedules/${baseId}/scenarios/${scenarioId}/promote`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Critical Path
  // -------------------------------------------------------------------------

  async getCriticalPath(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/critical-path`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Baselines
  // -------------------------------------------------------------------------

  async getBaselines(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/baselines`);
    return response.data;
  }

  async createBaseline(scheduleId: string, name: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/baselines`, { name });
    return response.data;
  }

  async compareBaseline(scheduleId: string, baselineId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/baselines/${baselineId}/compare`);
    return response.data;
  }

  async deleteBaseline(scheduleId: string, baselineId: string) {
    const response = await this.api.delete(`/schedules/${scheduleId}/baselines/${baselineId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // S-Curve
  // -------------------------------------------------------------------------

  async getSCurveData(projectId: string) {
    const response = await this.api.get(`/predictions/project/${projectId}/evm/s-curve`);
    return response.data;
  }

  /** `changeId`: the Schedule History entry — undoing it puts the tasks back (same ids) */
  async bulkDeleteTasks(scheduleId: string, taskIds: string[]): Promise<{ deleted: number; changeId: string | null }> {
    const response = await this.api.delete('/bulk/tasks', { data: { scheduleId, taskIds } });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Comments & Activity
  // -------------------------------------------------------------------------

  async getTaskComments(scheduleId: string, taskId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/tasks/${taskId}/comments`);
    return response.data;
  }

  async addTaskComment(scheduleId: string, taskId: string, text: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/tasks/${taskId}/comments`, { text });
    return response.data;
  }

  async deleteTaskComment(scheduleId: string, taskId: string, commentId: string) {
    const response = await this.api.delete(`/schedules/${scheduleId}/tasks/${taskId}/comments/${commentId}`);
    return response.data;
  }

  async getTaskActivity(scheduleId: string, taskId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/tasks/${taskId}/activity`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Task Prioritization
  // -------------------------------------------------------------------------

  async getTaskPrioritization(projectId: string, scheduleId: string) {
    const response = await this.api.get(`/task-prioritization/${projectId}/${scheduleId}/prioritize`);
    return response.data;
  }

  /** The project's PM asks the AI to refine the ranking (the panel itself never calls the AI) */
  async refineTaskPrioritizationWithAI(projectId: string, scheduleId: string) {
    const response = await this.api.post(`/task-prioritization/${projectId}/${scheduleId}/prioritize/ai`, {});
    return response.data;
  }

  async applyTaskPriority(projectId: string, scheduleId: string, taskId: string, priority: string) {
    const response = await this.api.post(`/task-prioritization/${projectId}/${scheduleId}/apply`, { taskId, priority });
    return response.data;
  }

  async applyAllTaskPriorities(projectId: string, scheduleId: string, changes: Array<{ taskId: string; priority: string }>) {
    const response = await this.api.post(`/task-prioritization/${projectId}/${scheduleId}/apply-all`, { changes });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Network Diagram
  // -------------------------------------------------------------------------

  async getNetworkDiagram(scheduleId: string) {
    const response = await this.api.get(`/network-diagram/${scheduleId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Bulk Operations
  // -------------------------------------------------------------------------

  async bulkCreateTasks(scheduleId: string, tasks: any[]) {
    const response = await this.api.post('/bulk/tasks', { scheduleId, tasks });
    return response.data;
  }

  /** Add several links at once — all-or-nothing; returns the links actually added (for undo). */
  async bulkLinkTasks(scheduleId: string, links: Array<{ taskId: string; dependencyId: string; dependencyType?: string; lagDays?: number }>) {
    const response = await this.api.post(`/schedules/${scheduleId}/dependencies/bulk`, { links });
    return response.data as {
      added: Array<{ taskId: string; dependencyId: string; dependencyType: string; lagDays: number }>;
      skipped: number;
      /** Tasks pushed later because of the new links (with their previous dates) */
      moved: RescheduledTask[];
      /** The Schedule History entry; Undo goes through it */
      changeId: string | null;
    };
  }

  /** Put the selected tasks under a new summary task; undo via Schedule History (changeId) */
  async groupTasks(scheduleId: string, taskIds: string[], name: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/tasks/group`, { taskIds, name });
    return response.data as { summaryId: string; grouped: number; changeId: string | null };
  }

  async bulkUpdateTasks(updates: Array<{ id: string; scheduleId: string; [key: string]: any }>) {
    const response = await this.api.put('/bulk/tasks', { updates });
    return response.data;
  }

  async bulkUpdateTaskStatus(scheduleId: string, taskIds: string[], status: string) {
    const response = await this.api.put('/bulk/tasks/status', { scheduleId, taskIds, status });
    return response.data;
  }
}

/** A task moved by the date re-flow after links were added */
export interface RescheduledTask {
  taskId: string;
  name: string;
  oldStart: string | null;
  oldEnd: string | null;
  newStart: string;
  newEnd: string;
  movedDays: number;
}

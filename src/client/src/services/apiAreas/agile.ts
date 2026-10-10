import { ApiBase } from './http';

/**
 * Sprints, standups, retrospectives, Definition of Ready/Done, burndown and velocity.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class AgileApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Burndown / Burnup
  // -------------------------------------------------------------------------

  async getBurndownData(scheduleId: string) {
    const response = await this.api.get(`/burndown/${scheduleId}`);
    return response.data;
  }

  async getVelocityData(scheduleId: string) {
    const response = await this.api.get(`/burndown/${scheduleId}/velocity`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Sprint Planning / Agile Mode
  // -------------------------------------------------------------------------

  async createSprint(data: { projectId: string; scheduleId: string; name: string; goal?: string; startDate: string; endDate: string; velocityCommitment?: number }) {
    const response = await this.api.post('/sprints', data);
    return response.data;
  }

  async getSprints(projectId: string) {
    const response = await this.api.get(`/sprints/project/${projectId}`);
    return response.data;
  }

  async getSprint(id: string) {
    const response = await this.api.get(`/sprints/${id}`);
    return response.data;
  }

  async updateSprint(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/sprints/${id}`, data);
    return response.data;
  }

  async deleteSprint(id: string) {
    const response = await this.api.delete(`/sprints/${id}`);
    return response.data;
  }

  async addSprintTask(sprintId: string, taskId: string, storyPoints?: number) {
    const response = await this.api.post(`/sprints/${sprintId}/tasks`, { taskId, storyPoints });
    return response.data;
  }

  async updateSprintTaskPoints(sprintId: string, taskId: string, storyPoints: number) {
    const response = await this.api.patch(`/sprints/${sprintId}/tasks/${taskId}/points`, { storyPoints });
    return response.data;
  }

  async removeSprintTask(sprintId: string, taskId: string) {
    const response = await this.api.delete(`/sprints/${sprintId}/tasks/${taskId}`);
    return response.data;
  }

  async startSprint(id: string) {
    const response = await this.api.post(`/sprints/${id}/start`);
    return response.data;
  }

  async completeSprint(id: string) {
    const response = await this.api.post(`/sprints/${id}/complete`);
    return response.data;
  }

  async getSprintBoard(sprintId: string) {
    const response = await this.api.get(`/sprints/${sprintId}/board`);
    return response.data;
  }

  async getSprintBurndown(sprintId: string) {
    const response = await this.api.get(`/sprints/${sprintId}/burndown`);
    return response.data;
  }

  async getVelocityHistory(projectId: string) {
    const response = await this.api.get(`/sprints/velocity/${projectId}`);
    return response.data;
  }

  async getBacklogTasks(scheduleId: string) {
    const response = await this.api.get(`/sprints/backlog/${scheduleId}`);
    return response.data;
  }

  async generateSprintRetrospective(sprintId: string) {
    const response = await this.api.post(`/sprints/${sprintId}/retrospective`);
    return response.data;
  }

  async getCumulativeFlow(sprintId: string) {
    const response = await this.api.get(`/sprints/${sprintId}/cumulative-flow`);
    return response.data;
  }

  async getEpics(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/epics`);
    return response.data;
  }

  async getEpicChildren(scheduleId: string, epicId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/epics/${epicId}/children`);
    return response.data;
  }

  async getFlowMetrics(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/flow-metrics`);
    return response.data;
  }

  async getCapacityRecommendation(sprintId: string) {
    const response = await this.api.get(`/sprints/${sprintId}/capacity`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Standup Logging
  // -------------------------------------------------------------------------

  async submitStandup(sprintId: string, data: { projectId: string; entryDate: string; yesterday?: string | null; today?: string | null; blockers?: string[] | null }) {
    const response = await this.api.post(`/sprints/${sprintId}/standups`, data);
    return response.data;
  }

  async getStandups(sprintId: string, date?: string) {
    const response = await this.api.get(`/sprints/${sprintId}/standups`, { params: { date } });
    return response.data;
  }

  async getStandupTimeline(sprintId: string) {
    const response = await this.api.get(`/sprints/${sprintId}/standups/timeline`);
    return response.data;
  }

  async updateStandup(sprintId: string, entryId: string, data: { yesterday?: string | null; today?: string | null; blockers?: string[] | null }) {
    const response = await this.api.put(`/sprints/${sprintId}/standups/${entryId}`, data);
    return response.data;
  }

  async deleteStandup(sprintId: string, entryId: string) {
    const response = await this.api.delete(`/sprints/${sprintId}/standups/${entryId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Retrospective Board
  // -------------------------------------------------------------------------

  async getRetroBoard(sprintId: string) {
    const response = await this.api.get(`/sprints/${sprintId}/retro`);
    return response.data;
  }

  async addRetroItem(sprintId: string, data: { projectId: string; category: string; content: string }) {
    const response = await this.api.post(`/sprints/${sprintId}/retro`, data);
    return response.data;
  }

  async deleteRetroItem(sprintId: string, itemId: string) {
    const response = await this.api.delete(`/sprints/${sprintId}/retro/${itemId}`);
    return response.data;
  }

  async voteRetroItem(sprintId: string, itemId: string) {
    const response = await this.api.post(`/sprints/${sprintId}/retro/${itemId}/vote`);
    return response.data;
  }

  async unvoteRetroItem(sprintId: string, itemId: string) {
    const response = await this.api.delete(`/sprints/${sprintId}/retro/${itemId}/vote`);
    return response.data;
  }

  /** The server uses the sprint's own project */
  async seedRetroFromAI(sprintId: string) {
    const response = await this.api.post(`/sprints/${sprintId}/retro/seed`, {});
    return response.data;
  }

  async convertRetroItem(sprintId: string, itemId: string, scheduleId: string) {
    const response = await this.api.post(`/sprints/${sprintId}/retro/${itemId}/convert`, { scheduleId });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Definition of Ready / Done
  // -------------------------------------------------------------------------

  async getScrumDefinitions(projectId: string) {
    const response = await this.api.get(`/sprints/definitions/${projectId}`);
    return response.data;
  }

  async upsertScrumDefinition(projectId: string, type: 'dor' | 'dod', criteria: Array<{ id: string; label: string; order: number }>) {
    const response = await this.api.put(`/sprints/definitions/${projectId}/${type}`, { criteria });
    return response.data;
  }

  async getTaskChecklists(taskId: string) {
    const response = await this.api.get(`/sprints/checklists/${taskId}`);
    return response.data;
  }

  async initializeTaskChecklist(taskId: string, type: 'dor' | 'dod', projectId: string) {
    const response = await this.api.post(`/sprints/checklists/${taskId}/${type}`, { projectId });
    return response.data;
  }

  async updateTaskChecklist(checklistId: string, criterionId: string, checked: boolean) {
    const response = await this.api.put(`/sprints/checklists/${checklistId}`, { criterionId, checked });
    return response.data;
  }

  async getBulkReadiness(type: 'dor' | 'dod', taskIds: string[]) {
    const response = await this.api.get(`/sprints/checklists/bulk/${type}`, { params: { taskIds: taskIds.join(',') } });
    return response.data;
  }
}

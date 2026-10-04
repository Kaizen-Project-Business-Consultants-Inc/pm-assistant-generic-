import { ApiBase } from './http';

/**
 * Resources and people, rate card, availability, workload, leveling, resource requests, time entries, weekly timesheets and expenses.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class ResourcesApi extends ApiBase {
  // Rate card: hourly rates by role, each from a date (admin / PMO / PM / company owner only)
  async getRateCard(): Promise<{ rates: RateCardEntry[] }> {
    return (await this.api.get('/rate-card')).data;
  }

  async addRate(rate: RateInput): Promise<{ rate: RateCardEntry }> {
    return (await this.api.post('/rate-card', rate)).data;
  }

  async updateRate(id: string, rate: RateInput): Promise<{ rate: RateCardEntry }> {
    return (await this.api.put(`/rate-card/${id}`, rate)).data;
  }

  async deleteRate(id: string): Promise<void> {
    await this.api.delete(`/rate-card/${id}`);
  }

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  async getResources() {
    const response = await this.api.get('/resources');
    return response.data;
  }

  async getResourceSkills() {
    const response = await this.api.get('/resources/skills');
    return response.data as { skills: string[] };
  }

  async getResourcesBySkill(skill: string, minLevel?: number) {
    const params = new URLSearchParams({ skill });
    if (minLevel != null) params.set('minLevel', String(minLevel));
    const response = await this.api.get(`/resources/by-skill?${params}`);
    return response.data;
  }

  async createResource(data: {
    name: string;
    role: string;
    /** Required for a person; left out for a generic role */
    email?: string;
    isGeneric?: boolean;
    capacityHoursPerWeek?: number;
    skills?: Array<string | { name: string; level: number }>;
    resourceGroup?: string | null;
    userId?: string | null;
    calendarTemplateId?: string | null;
  }) {
    const response = await this.api.post('/resources', data);
    return response.data;
  }

  async updateResource(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/resources/${id}`, data);
    return response.data;
  }

  async getResourceDeleteImpact(id: string) {
    const response = await this.api.get(`/resources/${id}/delete-impact`);
    return response.data as { resourceName: string; taskAssignments: number; resourceAssignments: number; raidItems: number };
  }

  async deleteResource(id: string, removeAccess?: boolean) {
    const response = await this.api.delete(`/resources/${id}${removeAccess ? '?removeAccess=true' : ''}`);
    return response.data;
  }

  async bulkDeleteResources(ids: string[]) {
    const response = await this.api.post('/resources/bulk-delete', { ids });
    return response.data;
  }

  /** The Invite button: invite this person to log in (saving a resource never sends anything) */
  async inviteResource(id: string) {
    const response = await this.api.post(`/resources/${id}/invite`);
    return response.data as { sent: boolean; message: string };
  }

  /** People doing work on this project's tasks (generic roles left out), for the Team tab */
  async getPeopleOnProject(projectId: string) {
    const response = await this.api.get(`/resources/on-project/${projectId}`);
    return response.data as { people: Array<{ resourceId: string; name: string; role: string; email: string; userId: string | null; placeholderEmail: boolean; taskCount: number }> };
  }

  /** The tasks in one plan a resource is on (Replace dialog) */
  async getResourceTasks(resourceId: string, scheduleId: string) {
    const response = await this.api.get(`/resources/${resourceId}/tasks`, { params: { scheduleId } });
    return response.data as { tasks: Array<{ taskId: string; name: string; startDate: string | null; endDate: string | null; status: string }> };
  }

  /** Weeks the new person would be over 100% after taking these tasks over */
  async checkReplaceLoad(body: { scheduleId: string; fromResourceId: string; toResourceId: string; taskIds: string[] }) {
    const response = await this.api.post('/resources/replace/check', body);
    return response.data as { resourceName: string; overWeeks: Array<{ weekStart: string; utilization: number }> };
  }

  /** "Replace Generic Developer with …" on these tasks — undoable from Schedule History */
  async replaceResource(body: { scheduleId: string; fromResourceId: string; toResourceId: string; taskIds: string[] }) {
    const response = await this.api.post('/resources/replace', body);
    return response.data as { replaced: number; changeId: string | null };
  }

  /** Team Planner: everyone on the viewer's projects, week by week, across all their work */
  async getTeamPlanner(from: string, weeks = 8) {
    const response = await this.api.get('/resources/planner', { params: { from, weeks } });
    return response.data as import('../../types/teamPlanner').PlannerBoard;
  }

  /** What a Team Planner drop would do — nothing is saved */
  async checkPlannerMove(body: import('../../types/teamPlanner').PlannerMoveInput) {
    const response = await this.api.post('/resources/planner/check', body);
    return response.data as import('../../types/teamPlanner').PlannerPreview;
  }

  /** Apply a Team Planner drop — one Schedule History change, undoable */
  async plannerMove(body: import('../../types/teamPlanner').PlannerMoveInput) {
    const response = await this.api.post('/resources/planner/move', body);
    return response.data as { changeId: string | null; summary: string };
  }

  async getResourceWorkload(projectId: string) {
    const response = await this.api.get(`/resources/workload/${projectId}`);
    return response.data;
  }

  /** Would this booking take the person over 100% in some week? (warning only) */
  async checkResourceLoad(body: { resourceId: string; startDate: string; endDate: string; allocationPct: number; excludeTaskId?: string }) {
    const response = await this.api.post('/resources/load-check', body);
    return response.data as import('../../utils/resourceLoad').LoadCheckResult;
  }

  async getGlobalResourceWorkload() {
    const response = await this.api.get('/resources/workload');
    return response.data;
  }

  async getResourceUtilizationHistory(resourceId: string, weeks = 12) {
    const response = await this.api.get(`/resources/${resourceId}/utilization-history`, { params: { weeks } });
    return response.data;
  }

  async quickAssignResource(data: { resourceId: string; taskId: string; scheduleId: string }) {
    const response = await this.api.post('/resources/quick-assign', data);
    return response.data;
  }

  async importResources(csv: string) {
    const response = await this.api.post('/resources/import', { csv });
    return response.data;
  }

  async getResourceProfile(id: string) {
    const response = await this.api.get(`/resources/${id}/profile`);
    return response.data;
  }

  async getCapacityByRole() {
    const response = await this.api.get('/resources/capacity-by-role');
    return response.data;
  }

  async getResourceProjectAllocations() {
    const response = await this.api.get('/resources/project-allocations');
    return response.data;
  }

  async getResourceUsageForProject(projectId: string) {
    const response = await this.api.get(`/resources/usage/${projectId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Resource Availability
  // -------------------------------------------------------------------------

  async getResourceAvailability(resourceId: string, from?: string, to?: string) {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await this.api.get(`/resources/${resourceId}/availability`, { params });
    return response.data;
  }

  async createResourceAvailability(resourceId: string, data: {
    dateFrom: string;
    dateTo: string;
    type: 'vacation' | 'holiday' | 'unavailable' | 'reduced';
    hoursAvailable?: number;
    note?: string;
  }) {
    const response = await this.api.post(`/resources/${resourceId}/availability`, data);
    return response.data;
  }

  async updateResourceAvailability(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/resources/availability/${id}`, data);
    return response.data;
  }

  async deleteResourceAvailability(id: string) {
    const response = await this.api.delete(`/resources/availability/${id}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Resource Optimizer
  // -------------------------------------------------------------------------

  async getResourceForecast(projectId: string, weeksAhead?: number) {
    const params = weeksAhead ? { weeksAhead } : {};
    const response = await this.api.get(`/resource-optimizer/${projectId}/forecast`, { params });
    return response.data;
  }

  async getSkillMatch(taskId: string, scheduleId: string) {
    const response = await this.api.post('/resource-optimizer/skill-match', { taskId, scheduleId });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Time Entries
  // -------------------------------------------------------------------------

  async createTimeEntry(data: {
    taskId: string; scheduleId: string; projectId: string;
    date: string; hours: number; description?: string; billable?: boolean;
  }) {
    const response = await this.api.post('/time-entries', data);
    return response.data;
  }

  async getTaskTimeEntries(taskId: string) {
    const response = await this.api.get(`/time-entries/task/${taskId}`);
    return response.data;
  }

  async getProjectTimeEntries(projectId: string, startDate?: string, endDate?: string, userId?: string) {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (userId) params.userId = userId;
    const response = await this.api.get(`/time-entries/project/${projectId}`, { params });
    return response.data;
  }

  async getWeeklyTimesheet(weekStart: string) {
    const response = await this.api.get('/time-entries/timesheet', { params: { weekStart } });
    return response.data;
  }

  async getActualVsEstimated(scheduleId: string) {
    const response = await this.api.get(`/time-entries/actual-vs-estimated/${scheduleId}`);
    return response.data;
  }

  async updateTimeEntry(id: string, data: { date?: string; hours?: number; description?: string; billable?: boolean }) {
    const response = await this.api.put(`/time-entries/${id}`, data);
    return response.data;
  }

  async deleteTimeEntry(id: string) {
    const response = await this.api.delete(`/time-entries/${id}`);
    return response.data;
  }

  // ── Weekly timesheets (2026-10-02): one per person per week, approved by the line manager ──

  /** My week holding `date`: a line per task (planned this week, hours by day, task so far) */
  async getMyWeek(date: string) {
    const response = await this.api.get('/time-entries/week', { params: { date } });
    return response.data as import('../../types/timesheet').WeekView;
  }

  async submitWeek(date: string) {
    const response = await this.api.post('/time-entries/week/submit', { date });
    return response.data as import('../../types/timesheet').WeekView;
  }

  async recallWeek(date: string) {
    const response = await this.api.post('/time-entries/week/recall', { date });
    return response.data as import('../../types/timesheet').WeekView;
  }

  /** Timesheets waiting for me as line manager */
  async getTimesheetApprovals() {
    const response = await this.api.get('/time-entries/approvals');
    return response.data as { timesheets: import('../../types/timesheet').PendingTimesheet[]; isApprover: boolean };
  }

  async getTimesheet(id: string) {
    const response = await this.api.get(`/time-entries/timesheets/${id}`);
    return response.data as import('../../types/timesheet').WeekView & { userId: string; userName: string };
  }

  async approveTimesheetWeek(id: string) {
    const response = await this.api.post(`/time-entries/timesheets/${id}/approve`);
    return response.data;
  }

  async rejectTimesheetWeek(id: string, reason: string) {
    const response = await this.api.post(`/time-entries/timesheets/${id}/reject`, { reason });
    return response.data;
  }

  /** A project's PM flags one task line for the line manager */
  async flagTimesheetLine(id: string, taskId: string, note: string) {
    const response = await this.api.post(`/time-entries/timesheets/${id}/flags`, { taskId, note });
    return response.data;
  }

  /** Hours waiting for approval on this project (its PM) */
  async getProjectPendingTime(projectId: string) {
    const response = await this.api.get(`/time-entries/project/${projectId}/pending`);
    return response.data as { pending: import('../../types/timesheet').ProjectPending[] };
  }

  // -------------------------------------------------------------------------
  // Time Anomalies & Compliance
  // -------------------------------------------------------------------------

  async getTimeAnomalies(projectId: string, startDate?: string, endDate?: string) {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    const response = await this.api.get(`/time-entries/anomalies/${projectId}`, { params });
    return response.data;
  }

  async getComplianceStatus(projectId: string, weekStart?: string) {
    const params: Record<string, string> = {};
    if (weekStart) params.weekStart = weekStart;
    const response = await this.api.get(`/time-entries/compliance/${projectId}`, { params });
    return response.data;
  }

  async getWeeklyReview(projectId: string, weekStart?: string) {
    const params: Record<string, string> = {};
    if (weekStart) params.weekStart = weekStart;
    const response = await this.api.get(`/time-entries/weekly-review/${projectId}`, { params });
    return response.data;
  }

  async getBurndownForecast(projectId: string) {
    const response = await this.api.get(`/time-entries/burndown/${projectId}`);
    return response.data;
  }

  async getTrendAnalysis(projectId: string, weeks?: number) {
    const params: Record<string, string> = {};
    if (weeks) params.weeks = String(weeks);
    const response = await this.api.get(`/time-entries/trends/${projectId}`, { params });
    return response.data;
  }

  async getUtilizationHeatmap(projectId: string, startDate?: string, endDate?: string) {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    const response = await this.api.get(`/time-entries/heatmap/${projectId}`, { params });
    return response.data;
  }

  async getTimeSuggestion(projectId: string, date?: string) {
    const params: Record<string, string> = { projectId };
    if (date) params.date = date;
    const response = await this.api.get('/time-entries/suggest', { params });
    return response.data;
  }

  async explainAnomaly(anomaly: any, projectId: string) {
    const response = await this.api.post('/time-entries/anomaly-explain', { anomaly, projectId });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------

  async createExpense(data: { projectId: string; date: string; amount: number; category: string; vendor?: string; description?: string }) {
    const response = await this.api.post('/expenses', data);
    return response.data;
  }

  async getProjectExpenses(projectId: string, startDate?: string, endDate?: string) {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    const response = await this.api.get(`/expenses/project/${projectId}`, { params });
    return response.data;
  }

  async getExpenseSummary(projectId: string) {
    const response = await this.api.get(`/expenses/project/${projectId}/summary`);
    return response.data;
  }

  async updateExpense(id: string, data: { date?: string; amount?: number; category?: string; vendor?: string; description?: string }) {
    const response = await this.api.put(`/expenses/${id}`, data);
    return response.data;
  }

  async deleteExpense(id: string) {
    const response = await this.api.delete(`/expenses/${id}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Resource Leveling
  // -------------------------------------------------------------------------

  async getResourceHistogram(scheduleId: string) {
    const response = await this.api.get(`/resource-leveling/${scheduleId}/histogram`);
    return response.data;
  }

  async levelResources(scheduleId: string) {
    const response = await this.api.post(`/resource-leveling/${scheduleId}/level`);
    return response.data;
  }

  async applyResourceLeveling(scheduleId: string, adjustments: any[]) {
    const response = await this.api.post(`/resource-leveling/${scheduleId}/apply`, { adjustments });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Resource Requests
  // -------------------------------------------------------------------------

  async getResourceRequests(params?: { projectId?: string; status?: string; priority?: string }) {
    const qp = new URLSearchParams();
    if (params?.projectId) qp.set('projectId', params.projectId);
    if (params?.status) qp.set('status', params.status);
    if (params?.priority) qp.set('priority', params.priority);
    const qs = qp.toString();
    const response = await this.api.get(`/resource-requests${qs ? `?${qs}` : ''}`);
    return response.data;
  }

  async getResourceRequest(id: string) {
    const response = await this.api.get(`/resource-requests/${id}`);
    return response.data;
  }

  async getPendingResourceRequests() {
    const response = await this.api.get('/resource-requests/pending');
    return response.data;
  }

  async getResourceRequestSummary() {
    const response = await this.api.get('/resource-requests/summary');
    return response.data;
  }

  async createResourceRequest(data: Record<string, unknown>) {
    const response = await this.api.post('/resource-requests', data);
    return response.data;
  }

  async updateResourceRequest(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/resource-requests/${id}`, data);
    return response.data;
  }

  async submitResourceRequest(id: string) {
    const response = await this.api.post(`/resource-requests/${id}/submit`);
    return response.data;
  }

  async approveResourceRequest(id: string, comment?: string) {
    const response = await this.api.post(`/resource-requests/${id}/approve`, { comment });
    return response.data;
  }

  async rejectResourceRequest(id: string, comment: string) {
    const response = await this.api.post(`/resource-requests/${id}/reject`, { comment });
    return response.data;
  }

  async fulfillResourceRequest(id: string, resourceId: string) {
    const response = await this.api.post(`/resource-requests/${id}/fulfill`, { resourceId });
    return response.data;
  }

  async cancelResourceRequest(id: string) {
    const response = await this.api.post(`/resource-requests/${id}/cancel`);
    return response.data;
  }
}

export interface RateCardEntry {
  id: string;
  role: string;
  hourlyRate: number;
  overtimeRate: number | null;
  effectiveFrom: string;
}
export interface RateInput { role: string; hourlyRate: number; overtimeRate?: number | null; effectiveFrom: string }

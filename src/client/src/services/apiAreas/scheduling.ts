import { ApiBase } from './http';

/**
 * Scheduling extras: working calendar and holidays, calendar templates, Schedule Review and fixes, change history, CSV import, Monte Carlo, EVM, auto-reschedule.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class SchedulingApi extends ApiBase {
  // Working calendar (project) + company holidays
  async getWorkingCalendar(projectId: string): Promise<WorkingCalendarData> {
    return (await this.api.get(`/projects/${projectId}/working-calendar`)).data;
  }

  async previewWorkingCalendar(projectId: string, change: WorkingCalendarChange): Promise<CalendarChangePreview> {
    return (await this.api.post(`/projects/${projectId}/working-calendar/preview`, change)).data;
  }

  async applyWorkingCalendar(projectId: string, change: WorkingCalendarChange): Promise<CalendarChangePreview> {
    return (await this.api.post(`/projects/${projectId}/working-calendar/apply`, change)).data;
  }

  async getCompanyHolidays(): Promise<{ holidays: CompanyHoliday[]; canEdit: boolean }> {
    return (await this.api.get('/company-holidays')).data;
  }

  async previewCompanyHoliday(change: CompanyHolidayChange): Promise<CalendarChangePreview> {
    return (await this.api.post('/company-holidays/preview', change)).data;
  }

  async applyCompanyHoliday(change: CompanyHolidayChange): Promise<CalendarChangePreview> {
    return (await this.api.post('/company-holidays/apply', change)).data;
  }

  async getNonWorkingDates(projectId: string, start: string, end: string): Promise<{ dates: string[] }> {
    const response = await this.api.get(`/projects/${projectId}/non-working-dates`, { params: { start, end } });
    return response.data;
  }

  // Schedule Review — deterministic schedule quality check
  async reviewSchedule(scheduleId: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/review`);
    return response.data;
  }

  async getScheduleReviewLatest(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/review/latest`);
    // 204 when no review has run yet
    return response.status === 204 || !response.data ? null : response.data;
  }

  async getScheduleReviewHistory(scheduleId: string, limit = 8) {
    const response = await this.api.get(`/schedules/${scheduleId}/review/history`, { params: { limit } });
    return response.data;
  }

  // Schedule Review Phase 3 — structural fix proposals
  async proposeScheduleFixes(scheduleId: string, useAi = false) {
    const response = await this.api.post(`/schedules/${scheduleId}/review/propose`, undefined, {
      params: useAi ? { ai: '1' } : undefined,
    });
    return response.data;
  }

  async getScheduleFixProposal(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/review/proposal`);
    return response.status === 204 || !response.data ? null : response.data;
  }

  async applyScheduleFixes(scheduleId: string, proposalId: string, fixIds: string[]) {
    const response = await this.api.post(`/schedules/${scheduleId}/review/proposals/${proposalId}/apply`, { fixIds });
    return response.data;
  }

  async undoScheduleFixProposal(scheduleId: string, proposalId: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/review/proposals/${proposalId}/undo`);
    return response.data;
  }

  /** Schedule History: group changes of the last 30 days */
  async getScheduleChanges(scheduleId: string) {
    const response = await this.api.get(`/schedules/${scheduleId}/changes`);
    return response.data?.changes ?? [];
  }

  /** Undo one group change. 409 { error: 'edited_since', editedCount } unless force. */
  /** Only the newest change, while nothing in the plan has changed since (Schedule History rule) */
  async undoScheduleChange(scheduleId: string, changeId: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/changes/${changeId}/undo`, {});
    return response.data;
  }

  async rejectScheduleFixProposal(scheduleId: string, proposalId: string, feedback?: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/review/proposals/${proposalId}/reject`, { feedback });
    return response.data;
  }

  // Calendar Templates
  async getCalendarTemplates() {
    const response = await this.api.get('/resources/calendar-templates');
    return response.data;
  }

  async createCalendarTemplate(data: { name: string; workingDays: string[]; hoursPerDay: number; isDefault?: boolean }) {
    const response = await this.api.post('/resources/calendar-templates', data);
    return response.data;
  }

  async updateCalendarTemplate(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/resources/calendar-templates/${id}`, data);
    return response.data;
  }

  async deleteCalendarTemplate(id: string) {
    const response = await this.api.delete(`/resources/calendar-templates/${id}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Monte Carlo Simulation
  // -------------------------------------------------------------------------

  async runMonteCarloSimulation(scheduleId: string, config?: { iterations?: number; confidenceLevels?: number[]; uncertaintyModel?: string }) {
    const response = await this.api.post(`/monte-carlo/${scheduleId}/simulate`, config || {});
    return response.data;
  }

  // -------------------------------------------------------------------------
  // EVM Forecast
  // -------------------------------------------------------------------------

  async getEVMForecast(projectId: string) {
    const response = await this.api.get(`/evm-forecast/${projectId}`);
    return response.data;
  }

  async getEVMAIPredictions(projectId: string) {
    const response = await this.api.get(`/evm-forecast/${projectId}/ai`);
    return response.data;
  }

  async getEVMTaskVariances(projectId: string) {
    const response = await this.api.get(`/evm-forecast/${projectId}/task-variances`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Auto-Reschedule
  // -------------------------------------------------------------------------

  async getDelays(scheduleId: string) {
    const response = await this.api.get(`/auto-reschedule/${scheduleId}/delays`);
    return response.data;
  }

  async generateRescheduleProposal(scheduleId: string) {
    const response = await this.api.post(`/auto-reschedule/${scheduleId}/propose`);
    return response.data;
  }

  async getRescheduleProposals(scheduleId: string) {
    const response = await this.api.get(`/auto-reschedule/${scheduleId}/proposals`);
    return response.data;
  }

  async acceptRescheduleProposal(proposalId: string) {
    const response = await this.api.post(`/auto-reschedule/proposals/${proposalId}/accept`);
    return response.data;
  }

  async rejectRescheduleProposal(proposalId: string, feedback?: string) {
    const response = await this.api.post(`/auto-reschedule/proposals/${proposalId}/reject`, { feedback });
    return response.data;
  }

  async modifyRescheduleProposal(proposalId: string, modifications: any[]) {
    const response = await this.api.post(`/auto-reschedule/proposals/${proposalId}/modify`, { modifications });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // CSV Import
  // -------------------------------------------------------------------------

  async importTasks(scheduleId: string, csv: string, columnMap?: Record<string, string>, fileName?: string) {
    const response = await this.api.post(`/schedules/${scheduleId}/import`, { csv, columnMap, fileName });
    return response.data;
  }

  async suggestColumns(
    headers: string[],
    unmappedHeaders: string[],
    targetFields: string[],
    samples?: Record<string, string[]>,
  ): Promise<Record<string, string>> {
    const response = await this.api.post('/schedules/suggest-columns', {
      headers,
      unmappedHeaders,
      targetFields,
      samples,
    });
    return response.data?.suggestions ?? {};
  }
}

export interface CompanyHoliday { id: string; date: string; name: string }
export interface WorkingCalendarData {
  workingDays: number[];
  exceptions: Array<{ id: string; date: string; type: 'holiday' | 'working'; name: string }>;
  companyHolidays: CompanyHoliday[];
}
export type WorkingCalendarChange =
  | { workingDays: number[] }
  | { add: { date: string; type: 'holiday' | 'working'; name?: string } }
  | { removeId: string };
export type CompanyHolidayChange = { add: { date: string; name?: string } } | { removeId: string };
export interface CalendarChangePreview {
  moves: Array<{ taskId: string; name: string; scheduleName: string; oldStart: string | null; oldEnd: string | null; newStart: string; newEnd: string }>;
  tasksMoved: number;
  projectsAffected: number;
  finishBefore: string | null;
  finishAfter: string | null;
}

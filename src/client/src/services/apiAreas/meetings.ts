import { ApiBase } from './http';

/**
 * Meetings, meeting intelligence (incl. From Teams) and meeting action-item history.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class MeetingsApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Meeting Intelligence
  // -------------------------------------------------------------------------

  async analyzeMeetingTranscript(data: { transcript: string; projectId: string; scheduleId: string }) {
    const response = await this.api.post('/meeting-intelligence/analyze', data);
    return response.data;
  }

  async applyMeetingChanges(analysisId: string, selectedItems: number[]) {
    const response = await this.api.post(`/meeting-intelligence/${analysisId}/apply`, { selectedItems });
    return response.data;
  }

  // Meeting Intelligence → From Teams (your own Microsoft account; PM of the project)
  async getTeamsMeetingsStatus(): Promise<{ configured: boolean; connected: boolean }> {
    return (await this.api.get('/teams-meetings/status')).data;
  }

  async getTeamsMeetingsInstallUrl(): Promise<{ url: string }> {
    return (await this.api.get('/teams-meetings/install')).data;
  }

  async getTeamsAdminApprovalUrl(): Promise<{ url: string }> {
    return (await this.api.get('/teams-meetings/admin-approval-url')).data;
  }

  async disconnectTeamsMeetings() {
    return (await this.api.delete('/teams-meetings/connection')).data;
  }

  async listTeamsMeetings(projectId: string) {
    return (await this.api.get('/teams-meetings/meetings', { params: { projectId } })).data;
  }

  async getTeamsMeetingSpeakers(projectId: string, eventId: string) {
    return (await this.api.post('/teams-meetings/speakers', { projectId, eventId })).data;
  }

  async analyzeTeamsMeeting(data: { projectId: string; scheduleId: string; eventId: string; mapping: Record<string, string | null> }) {
    return (await this.api.post('/teams-meetings/analyze', data)).data;
  }

  async getMeetingHistory(projectId: string) {
    const response = await this.api.get(`/meeting-intelligence/project/${projectId}/history`);
    return response.data;
  }

  async sendToRaid(analysisId: string, projectId: string, items: Record<string, any>[]) {
    const response = await this.api.post(`/meeting-intelligence/${analysisId}/send-to-raid`, { projectId, items });
    return response.data;
  }

  async checkRaidDuplicates(analysisId: string, projectId: string, titles: string[]) {
    const response = await this.api.post(`/meeting-intelligence/${analysisId}/check-raid-duplicates`, { projectId, titles });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Meetings
  // -------------------------------------------------------------------------

  async getMeetings(projectId: string, filters?: { status?: string; type?: string; from?: string; to?: string }) {
    const params = new URLSearchParams({ projectId });
    if (filters?.status) params.set('status', filters.status);
    if (filters?.type) params.set('type', filters.type);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    const response = await this.api.get(`/meetings?${params}`);
    return response.data;
  }

  async getMeetingDetail(id: string) {
    const response = await this.api.get(`/meetings/${id}`);
    return response.data;
  }

  async createMeeting(data: Record<string, any>) {
    const response = await this.api.post('/meetings', data);
    return response.data;
  }

  async updateMeeting(id: string, data: Record<string, any>) {
    const response = await this.api.put(`/meetings/${id}`, data);
    return response.data;
  }

  async deleteMeeting(id: string) {
    const response = await this.api.delete(`/meetings/${id}`);
    return response.data;
  }

  async completeMeeting(id: string) {
    const response = await this.api.post(`/meetings/${id}/complete`);
    return response.data;
  }

  async cancelMeeting(id: string) {
    const response = await this.api.post(`/meetings/${id}/cancel`);
    return response.data;
  }

  async getUpcomingMeetings(projectId: string) {
    const response = await this.api.get(`/meetings/upcoming?projectId=${projectId}`);
    return response.data;
  }

  async linkAnalysisToMeeting(meetingId: string, analysisId: string) {
    const response = await this.api.post(`/meetings/${meetingId}/link-analysis`, { analysisId });
    return response.data;
  }

  async uploadTranscriptFile(file: File, projectId: string, scheduleId: string, meetingId?: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', projectId);
    formData.append('scheduleId', scheduleId);
    if (meetingId) formData.append('meetingId', meetingId);
    const response = await this.api.post('/meeting-intelligence/upload-transcript', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async syncExternalMeeting(data: {
    projectId: string;
    title: string;
    scheduledDate: string;
    durationMinutes?: number;
    location?: string;
    attendees?: string[];
    summary: string;
    /** Each becomes a RAID action on the project */
    actionItems?: Array<{ description: string; assigneeName?: string; priority?: string; dueDate?: string }>;
    source?: string;
  }) {
    const response = await this.api.post('/meetings/sync-external', data);
    return response.data;
  }

  async sendMeetingMinutes(meetingId: string, analysisId: string, recipientEmails: string[]) {
    const response = await this.api.post(`/meetings/${meetingId}/send-minutes`, { analysisId, recipientEmails });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Meeting Action Items — read-only history (Oct 2026). Meeting actions now live in the
  // RAID log (type 'action'); nothing writes the old list any more.
  // -------------------------------------------------------------------------

  async getMeetingActionItems(filters: { projectId?: string; meetingId?: string; status?: string; assigneeUserId?: string; overdue?: boolean }) {
    const params = new URLSearchParams();
    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.meetingId) params.set('meetingId', filters.meetingId);
    if (filters.status) params.set('status', filters.status);
    if (filters.assigneeUserId) params.set('assigneeUserId', filters.assigneeUserId);
    if (filters.overdue) params.set('overdue', 'true');
    const response = await this.api.get(`/meeting-action-items?${params}`);
    return response.data;
  }
}

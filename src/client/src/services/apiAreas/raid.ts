import { ApiBase } from './http';
import type { RaidReview, RaidFixesResponse, RaidFixApplyEntry } from '../../components/raids/review/raidReviewHelpers';

/**
 * RAID log, project sponsor, RAID Review, RAID reports and strategic risk scan.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class RaidApi extends ApiBase {
  // -------------------------------------------------------------------------
  // RAID — Risks & Issues
  // -------------------------------------------------------------------------

  async getRiskItems(projectId: string, filters?: Record<string, string>) {
    const qp = new URLSearchParams(filters);
    const qs = qp.toString();
    const response = await this.api.get(`/projects/${projectId}/risks${qs ? `?${qs}` : ''}`);
    return response.data;
  }

  async getRiskStats(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/risks/stats`);
    return response.data;
  }

  /** Project sponsor (Oct 2026): who it is; who the PM can pick; set/clear; escalate a RAID item */
  async getProjectSponsor(projectId: string): Promise<{ sponsor: ProjectSponsor | null }> {
    return (await this.api.get(`/projects/${projectId}/sponsor`)).data;
  }

  async getSponsorCandidates(projectId: string): Promise<{ candidates: ProjectSponsor[] }> {
    return (await this.api.get(`/projects/${projectId}/sponsor/candidates`)).data;
  }

  async setProjectSponsor(projectId: string, choice: { userId?: string | null; resourceId?: string | null }): Promise<{ sponsor: ProjectSponsor | null }> {
    return (await this.api.put(`/projects/${projectId}/sponsor`, choice)).data;
  }

  async escalateRaidItem(projectId: string, riskId: string, note: string) {
    return (await this.api.post(`/projects/${projectId}/risks/${riskId}/escalate`, { note })).data;
  }

  async dismissEscalationPrompt(projectId: string, riskId: string) {
    return (await this.api.post(`/projects/${projectId}/risks/${riskId}/escalation-prompt/dismiss`)).data;
  }

  async getRiskItem(projectId: string, riskId: string) {
    const response = await this.api.get(`/projects/${projectId}/risks/${riskId}`);
    return response.data;
  }

  async createRiskItem(projectId: string, data: Record<string, any>) {
    const response = await this.api.post(`/projects/${projectId}/risks`, data);
    return response.data;
  }

  async updateRiskItem(projectId: string, riskId: string, data: Record<string, any>) {
    const response = await this.api.put(`/projects/${projectId}/risks/${riskId}`, data);
    return response.data;
  }

  async cancelRaidItem(projectId: string, riskId: string, reason: string) {
    const response = await this.api.post(`/projects/${projectId}/risks/${riskId}/cancel`, { reason });
    return response.data;
  }

  async reverseRaidItem(projectId: string, riskId: string, reason: string) {
    const response = await this.api.post(`/projects/${projectId}/risks/${riskId}/reverse`, { reason });
    return response.data;
  }

  async getRaidActivity(projectId: string, riskId: string) {
    const response = await this.api.get(`/projects/${projectId}/risks/${riskId}/activity`);
    return response.data;
  }

  async getRaidUpdates(projectId: string, riskId: string) {
    const response = await this.api.get(`/projects/${projectId}/risks/${riskId}/updates`);
    return response.data;
  }

  async addRaidUpdate(projectId: string, riskId: string, text: string) {
    const response = await this.api.post(`/projects/${projectId}/risks/${riskId}/updates`, { text });
    return response.data;
  }

  async editRaidUpdate(projectId: string, riskId: string, updateId: string, text: string) {
    const response = await this.api.put(`/projects/${projectId}/risks/${riskId}/updates/${updateId}`, { text });
    return response.data;
  }

  async deleteRaidUpdate(projectId: string, riskId: string, updateId: string) {
    const response = await this.api.delete(`/projects/${projectId}/risks/${riskId}/updates/${updateId}`);
    return response.data;
  }

  async addRaidComment(projectId: string, riskId: string, comment: string) {
    const response = await this.api.post(`/projects/${projectId}/risks/${riskId}/comments`, { comment });
    return response.data;
  }

  async runAiRiskScan(projectId: string) {
    const response = await this.api.post(`/projects/${projectId}/risks/ai-scan`);
    return response.data;
  }

  async batchImportRisks(projectId: string, items: Record<string, any>[]) {
    const response = await this.api.post(`/projects/${projectId}/risks/batch`, { items });
    return response.data;
  }

  async importRaidItems(projectId: string, csv: string, columnMap: Record<string, string>, defaultType?: string): Promise<{ data: { succeeded: number; failed: { row: number; error: string }[]; warnings?: { row: number; message: string }[] } }> {
    const response = await this.api.post(`/projects/${projectId}/risks/import`, { csv, columnMap, defaultType });
    return response.data;
  }

  async suggestRiskMitigation(projectId: string, riskId: string, field: 'mitigation' | 'trigger' | 'response' = 'mitigation') {
    const response = await this.api.post(`/projects/${projectId}/risks/${riskId}/suggest-mitigation?field=${field}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Strategic Risk Scan endpoints
  // -------------------------------------------------------------------------

  async runStrategicRiskScan(projectId: string) {
    const response = await this.api.post('/strategic-risk-scan/scan', { projectId });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // RAID Reports endpoints
  // -------------------------------------------------------------------------

  async generateRAIDReport(
    projectId: string,
    filters?: { types?: string[]; severities?: string[]; owners?: string[]; categories?: string[] },
    options?: { recipients?: string[]; sendEmail?: boolean },
  ) {
    const response = await this.api.post('/raid-reports/generate', { projectId, filters, ...options });
    return response.data;
  }

  async scheduleRAIDReport(data: {
    projectId: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek?: number;
    dayOfMonth?: number;
    timeOfDay?: string;
    recipients: string[];
  }) {
    const response = await this.api.post('/raid-reports/schedule', data);
    return response.data;
  }

  async getRAIDReportSchedules(projectId: string) {
    const response = await this.api.get(`/raid-reports/schedules/${projectId}`);
    return response.data;
  }

  async deleteRAIDReportSchedule(id: string) {
    const response = await this.api.delete(`/raid-reports/schedule/${id}`);
    return response.data;
  }

  // RAID Review — quality check of the RAID log
  async getRaidReview(projectId: string): Promise<{ review: RaidReview | null }> {
    const response = await this.api.get(`/projects/${projectId}/raid-review`);
    return response.data;
  }

  async runRaidReview(projectId: string): Promise<{ review: RaidReview }> {
    const response = await this.api.post(`/projects/${projectId}/raid-review/run`);
    return response.data;
  }

  async getRaidReviewFixes(projectId: string): Promise<RaidFixesResponse> {
    const response = await this.api.get(`/projects/${projectId}/raid-review/fixes`);
    return response.data;
  }

  async applyRaidReviewFixes(projectId: string, fixes: RaidFixApplyEntry[]): Promise<{ batchId: string; applied: number; summary: string }> {
    const response = await this.api.post(`/projects/${projectId}/raid-review/fixes/apply`, { fixes });
    return response.data;
  }

  /** 409 { error: 'edited_since', message } unless force */
  async undoRaidReviewFixes(projectId: string, batchId: string): Promise<{ restored: number }> {
    const response = await this.api.post(`/projects/${projectId}/raid-review/fixes/${batchId}/undo`, {});
    return response.data;
  }

  async setRaidReviewSettings(projectId: string, disabledRules: string[]): Promise<{ disabledRules: string[] }> {
    const response = await this.api.put(`/projects/${projectId}/raid-review/settings`, { disabledRules });
    return response.data;
  }
}

/** A project's sponsor: a person with a login ('user') or without one ('person', emailed) */
export interface ProjectSponsor { kind: 'user' | 'person'; id: string; name: string; email?: string }

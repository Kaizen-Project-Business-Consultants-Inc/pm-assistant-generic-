import { ApiBase } from './http';

/**
 * Platform admin, support view, waitlist, pricing, feedback, audit trail/ledger and policies.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class AdminApi extends ApiBase {
  // Support view: the platform admin's read-only, recorded 30-minute visit into one company
  async startSupportVisit(body: { organizationId: string; reason: string; password: string }): Promise<void> {
    await this.api.post('/admin/support-sessions', body);
  }

  async getSupportVisits(): Promise<{ visits: Array<{ id: string; reason: string; startedAt: string; endedAt: string | null; expiresAt: string; active: boolean }> }> {
    return (await this.api.get('/org/support-visits')).data;
  }

  async endSupportVisit(): Promise<void> {
    await this.api.delete('/admin/support-sessions/current');
  }

  // -------------------------------------------------------------------------
  // Audit Trail
  // -------------------------------------------------------------------------

  async getAuditTrail(projectId: string, limit = 50, offset = 0) {
    const response = await this.api.get(`/audit/${projectId}`, { params: { limit, offset } });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Audit Ledger & Compliance
  // -------------------------------------------------------------------------

  async verifyAuditChain(projectId?: string) {
    const params = projectId ? { projectId } : {};
    const response = await this.api.get('/audit/verify', { params });
    return response.data;
  }

  async getComplianceExport(projectId: string, format: 'csv' | 'pdf' = 'csv', from?: string, to?: string) {
    const params: Record<string, string> = { format };
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await this.api.get(`/audit/${projectId}/compliance-export`, { params });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Policy Engine
  // -------------------------------------------------------------------------

  async getPolicies(projectId?: string) {
    const params = projectId ? { projectId } : {};
    const response = await this.api.get('/policies', { params });
    return response.data;
  }

  async createPolicy(data: Record<string, unknown>) {
    const response = await this.api.post('/policies', data);
    return response.data;
  }

  async updatePolicy(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/policies/${id}`, data);
    return response.data;
  }

  async deletePolicy(id: string) {
    const response = await this.api.delete(`/policies/${id}`);
    return response.data;
  }

  async getPolicyEvaluationStats(projectId?: string, since?: string) {
    const params: Record<string, string> = {};
    if (projectId) params.projectId = projectId;
    if (since) params.since = since;
    const response = await this.api.get('/policies/evaluations/stats', { params });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Admin endpoints
  // -------------------------------------------------------------------------

  async getAdminUsers() {
    const response = await this.api.get('/admin/users');
    return response.data;
  }

  async getAdminConfig() {
    const response = await this.api.get('/admin/config');
    return response.data;
  }

  async getAdminAiUsage(since?: string) {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await this.api.get(`/admin/ai-usage${params}`);
    return response.data;
  }

  async getAgentCosts(since?: string) {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await this.api.get(`/agent/costs${params}`);
    return response.data;
  }

  async getAdminUsageAnalytics(days: number = 30) {
    const response = await this.api.get(`/admin/usage-analytics?days=${days}`);
    return response.data;
  }

  async setAdminUserStatus(userId: string, active: boolean) {
    const response = await this.api.patch(`/admin/users/${userId}/status`, { active });
    return response.data;
  }

  async adminResetUserPassword(userId: string) {
    const response = await this.api.post(`/admin/users/${userId}/reset-password`, {});
    return response.data;
  }

  async adminClearLoginToken(userId: string) {
    const response = await this.api.post(`/admin/users/${userId}/clear-login-token`, {});
    return response.data;
  }

  async updateAdminUserBudget(userId: string, budget: number | null) {
    const response = await this.api.patch(`/admin/users/${userId}/budget`, { budget });
    return response.data;
  }

  async getAdminTenants() {
    const response = await this.api.get('/admin/tenants');
    return response.data;
  }

  async getAdminTenant(id: string) {
    const response = await this.api.get(`/admin/tenants/${id}`);
    return response.data;
  }

  async updateAdminTenant(id: string, data: Record<string, unknown>) {
    const response = await this.api.patch(`/admin/tenants/${id}`, data);
    return response.data;
  }

  async provisionTenant(id: string) {
    const response = await this.api.post(`/admin/tenants/${id}/provision`, {});
    return response.data;
  }

  async runTenantMigrations(id: string) {
    const response = await this.api.post(`/admin/tenants/${id}/run-migrations`, {});
    return response.data;
  }

  async getAdminRevenue() {
    const response = await this.api.get('/admin/revenue');
    return response.data;
  }

  async adminChangeTier(userId: string, tier: string) {
    const response = await this.api.patch(`/admin/users/${userId}/tier`, { tier });
    return response.data;
  }

  async getAdminUserSubscriptionEvents(userId: string) {
    const response = await this.api.get(`/admin/users/${userId}/subscription-events`);
    return response.data;
  }

  async getAdminOperations() {
    const response = await this.api.get('/admin/operations');
    return response.data;
  }

  async getAdminAudit(params: { limit?: number; offset?: number; action?: string; entityType?: string; since?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.action) qs.set('action', params.action);
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.since) qs.set('since', params.since);
    const response = await this.api.get(`/admin/audit?${qs.toString()}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Waitlist Admin
  // -------------------------------------------------------------------------

  async getWaitlistEntries() {
    const response = await this.api.get('/waitlist/admin/list');
    return response.data;
  }

  async exportWaitlistCsv() {
    const response = await this.api.get('/waitlist/admin/export', { responseType: 'blob' });
    return response.data;
  }

  async sendWaitlistLaunchEmail() {
    const response = await this.api.post('/waitlist/admin/send-launch-email', {});
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Pricing Config
  // -------------------------------------------------------------------------

  async getPricingConfig() {
    const response = await this.api.get('/pricing');
    return response.data;
  }

  async getAdminPricing() {
    const response = await this.api.get('/admin/pricing');
    return response.data;
  }

  async updateAdminPricing(tier: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/admin/pricing/${tier}`, data);
    return response.data;
  }

  async updateAdminFeatures(tier: string, features: Record<string, boolean>) {
    const response = await this.api.put(`/admin/pricing/${tier}/features`, features);
    return response.data;
  }

  // --- Feedback ---
  async getAdminFeedback(params?: string) {
    const response = await this.api.get(`/feedback${params ? `?${params}` : ''}`);
    return response.data;
  }

  async updateFeedbackItem(id: string, data: Record<string, unknown>) {
    const response = await this.api.patch(`/feedback/${id}`, data);
    return response.data;
  }

  async submitFeedbackItem(data: Record<string, unknown>) {
    const response = await this.api.post('/feedback', data);
    return response.data;
  }

  async getMyFeedback() {
    const response = await this.api.get('/feedback/mine');
    return response.data;
  }

  async getFeedbackScreenshot(id: string) {
    const response = await this.api.get(`/feedback/${id}/screenshot`);
    return response.data;
  }
}

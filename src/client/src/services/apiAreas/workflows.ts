import { ApiBase } from './http';

/**
 * Workflows, approval workflows and change requests, automations.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class WorkflowsApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Workflows
  // -------------------------------------------------------------------------

  async getWorkflows(projectId?: string) {
    const params = projectId ? `?projectId=${projectId}` : '';
    const response = await this.api.get(`/workflows${params}`);
    return response.data;
  }

  async getWorkflow(id: string) {
    const response = await this.api.get(`/workflows/${id}`);
    return response.data;
  }

  async createWorkflow(data: Record<string, unknown>) {
    const response = await this.api.post('/workflows', data);
    return response.data;
  }

  async updateWorkflow(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/workflows/${id}`, data);
    return response.data;
  }

  async deleteWorkflow(id: string) {
    const response = await this.api.delete(`/workflows/${id}`);
    return response.data;
  }

  async toggleWorkflow(id: string, enabled: boolean) {
    const response = await this.api.patch(`/workflows/${id}/toggle`, { enabled });
    return response.data;
  }

  async triggerWorkflow(id: string, entityType: string, entityId: string) {
    const response = await this.api.post(`/workflows/${id}/trigger`, { entityType, entityId });
    return response.data;
  }

  async getWorkflowExecutions(filters?: Record<string, string>) {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
    const response = await this.api.get(`/workflows/executions${params}`);
    return response.data;
  }

  async getWorkflowExecution(id: string) {
    const response = await this.api.get(`/workflows/executions/${id}`);
    return response.data;
  }

  async resumeWorkflowExecution(id: string, nodeId: string, result: Record<string, unknown> = {}) {
    const response = await this.api.post(`/workflows/executions/${id}/resume`, { nodeId, result });
    return response.data;
  }

  async generateWorkflow(description: string, projectId?: string) {
    const response = await this.api.post('/workflows/generate', { description, projectId });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Approval Workflows & Change Requests
  // -------------------------------------------------------------------------

  async createApprovalWorkflow(projectId: string, data: { name: string; description?: string; entityType: string; steps: any[] }) {
    const response = await this.api.post(`/approvals/workflows/${projectId}`, data);
    return response.data;
  }

  async getApprovalWorkflows(projectId: string) {
    const response = await this.api.get(`/approvals/workflows/${projectId}`);
    return response.data;
  }

  async updateApprovalWorkflow(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/approvals/workflows/${id}`, data);
    return response.data;
  }

  async deleteApprovalWorkflow(id: string) {
    const response = await this.api.delete(`/approvals/workflows/${id}`);
    return response.data;
  }

  async createChangeRequest(projectId: string, data: { title: string; description: string; category: string; priority?: string; impactSummary?: string }) {
    const response = await this.api.post(`/approvals/change-requests/${projectId}`, data);
    return response.data;
  }

  async updateChangeRequest(id: string, data: { title?: string; description?: string; category?: string; priority?: string; impactSummary?: string }) {
    const response = await this.api.put(`/approvals/change-requests/${id}`, data);
    return response.data;
  }

  async deleteChangeRequest(id: string) {
    const response = await this.api.delete(`/approvals/change-requests/${id}`);
    return response.data;
  }

  async getChangeRequests(projectId: string, filters?: { status?: string; priority?: string; sortBy?: string; sortDir?: string }) {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.priority) params.priority = filters.priority;
    if (filters?.sortBy) params.sortBy = filters.sortBy;
    if (filters?.sortDir) params.sortDir = filters.sortDir;
    const response = await this.api.get(`/approvals/change-requests/${projectId}`, { params });
    return response.data;
  }

  async getChangeRequestDetail(id: string) {
    const response = await this.api.get(`/approvals/change-requests/${id}/detail`);
    return response.data;
  }

  async submitChangeRequestForApproval(id: string, workflowId: string) {
    const response = await this.api.post(`/approvals/change-requests/${id}/submit`, { workflowId });
    return response.data;
  }

  async actOnChangeRequest(id: string, action: string, comment?: string) {
    const response = await this.api.post(`/approvals/change-requests/${id}/action`, { action, comment });
    return response.data;
  }

  async withdrawChangeRequest(id: string) {
    const response = await this.api.post(`/approvals/change-requests/${id}/withdraw`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Automations
  // -------------------------------------------------------------------------

  async getAutomationEventTypes(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/automations/event-types`);
    return response.data;
  }

  async getAutomations(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/automations`);
    return response.data;
  }

  async getAutomation(projectId: string, id: string) {
    const response = await this.api.get(`/projects/${projectId}/automations/${id}`);
    return response.data;
  }

  async createAutomation(projectId: string, data: Record<string, unknown>) {
    const response = await this.api.post(`/projects/${projectId}/automations`, data);
    return response.data;
  }

  async updateAutomation(projectId: string, id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/projects/${projectId}/automations/${id}`, data);
    return response.data;
  }

  async deleteAutomation(projectId: string, id: string) {
    const response = await this.api.delete(`/projects/${projectId}/automations/${id}`);
    return response.data;
  }

  async enableAutomation(projectId: string, id: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/${id}/enable`);
    return response.data;
  }

  async disableAutomation(projectId: string, id: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/${id}/disable`);
    return response.data;
  }

  async getAutomationExecutions(projectId: string, id: string, limit = 20, offset = 0) {
    const response = await this.api.get(`/projects/${projectId}/automations/${id}/executions`, { params: { limit, offset } });
    return response.data;
  }

  async testAutomation(projectId: string, id: string, data?: { eventPayload?: Record<string, unknown>; entityId?: string }) {
    const response = await this.api.post(`/projects/${projectId}/automations/${id}/test`, data || {});
    return response.data;
  }

  async getAutomationAnalytics(projectId: string, id: string) {
    const response = await this.api.get(`/projects/${projectId}/automations/${id}/analytics`);
    return response.data;
  }

  async generateAutomationFromNL(projectId: string, description: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/ai-generate`, { description });
    return response.data;
  }

  async getAutomationSuggestions(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/automations/suggestions`);
    return response.data;
  }

  async dismissAutomationSuggestion(projectId: string, suggestionId: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/suggestions/${suggestionId}/dismiss`);
    return response.data;
  }

  async applyAutomationSuggestion(projectId: string, suggestionId: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/suggestions/${suggestionId}/apply`);
    return response.data;
  }

  async getPortfolioAutomations(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/automations/portfolio`);
    return response.data;
  }

  async getGovernancePacks(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/automations/governance-packs`);
    return response.data;
  }

  async applyGovernancePack(projectId: string, packId: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/governance-packs/${packId}/apply`);
    return response.data;
  }

  async getMarketplaceAutomations(projectId: string, limit = 50, offset = 0, category?: string) {
    const response = await this.api.get(`/projects/${projectId}/automations/marketplace`, { params: { limit, offset, category } });
    return response.data;
  }

  async publishToMarketplace(projectId: string, automationId: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/${automationId}/publish`);
    return response.data;
  }

  async importFromMarketplace(projectId: string, marketplaceId: string) {
    const response = await this.api.post(`/projects/${projectId}/automations/marketplace/${marketplaceId}/import`);
    return response.data;
  }
}

import { ApiBase } from './http';

/**
 * AI chat, briefing, predictions, intelligence, NL query, agents and autonomy, narratives, documents, context engineering, memory, dreaming and skills.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class AiApi extends ApiBase {
  // -------------------------------------------------------------------------
  // AI Chat endpoints
  // -------------------------------------------------------------------------

  async streamChatMessage(data: {
    message: string;
    conversationId?: string;
    context?: { type: string; projectId?: string };
  }): Promise<Response> {
    const streamBase = import.meta.env.DEV ? 'http://localhost:3001' : '';
    return fetch(`${streamBase}/api/v1/ai-chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
  }

  async sendChatMessage(data: {
    message: string;
    conversationId?: string;
    context?: { type: string; projectId?: string };
  }) {
    const response = await this.api.post('/ai-chat/message', data);
    return response.data;
  }

  async executeAlertAction(data: { toolName: string; params: Record<string, any> }) {
    const response = await this.api.post('/alerts/execute-action', data);
    return response.data;
  }

  async getAlerts() {
    const response = await this.api.get('/alerts');
    return response.data;
  }

  async getAlertsSummary() {
    const response = await this.api.get('/alerts/summary');
    return response.data;
  }

  // -------------------------------------------------------------------------
  // AI Chat extended endpoints
  // -------------------------------------------------------------------------

  async createProjectFromChat(description: string) {
    const response = await this.api.post('/ai-chat/create-project', { description });
    return response.data;
  }

  async extractTasksFromNotes(data: {
    meetingNotes: string;
    projectId?: string;
    scheduleId?: string;
  }) {
    const response = await this.api.post('/ai-chat/extract-tasks', data);
    return response.data;
  }

  async getConversations() {
    const response = await this.api.get('/ai-chat/conversations');
    return response.data;
  }

  async getConversation(conversationId: string) {
    const response = await this.api.get(`/ai-chat/conversations/${conversationId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Briefing endpoints
  // -------------------------------------------------------------------------

  async getDailyBriefing(scope?: string) {
    const params = scope ? `?scope=${scope}` : '';
    const response = await this.api.get(`/briefing/daily${params}`);
    return response.data;
  }

  async getStandupSummary(projectId: string, refresh = false) {
    const params = refresh ? '?refresh=true' : '';
    const response = await this.api.get(`/standup/project/${projectId}${params}`);
    return response.data;
  }

  async emailStandupSummary(projectId: string) {
    const response = await this.api.get(`/standup/project/${projectId}/email`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Predictions endpoints
  // -------------------------------------------------------------------------

  /**
   * Portfolio numbers (rules, refreshed every 5 minutes). `ai`: also the AI highlights — only the
   * Portfolio Intelligence panel asks. `refresh`: new AI highlights now (at most every 10 minutes).
   */
  async getDashboardPredictions(refresh = false, ai = false) {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = '1';
    if (ai) params.ai = '1';
    const response = await this.api.get('/predictions/dashboard', { params });
    return response.data;
  }

  /** `ai`: false = no AI call (a kept AI answer, else the rules' answer); true = ask the AI */
  async getProjectRisks(projectId: string, ai: boolean) {
    const response = await this.api.get(`/predictions/project/${projectId}/risks`, { params: ai ? {} : { ai: '0' } });
    return response.data;
  }

  async getProjectWeather(projectId: string, ai: boolean) {
    const response = await this.api.get(`/predictions/project/${projectId}/weather`, { params: ai ? {} : { ai: '0' } });
    return response.data;
  }

  async getProjectBudget(projectId: string, ai: boolean) {
    const response = await this.api.get(`/predictions/project/${projectId}/budget`, { params: ai ? {} : { ai: '0' } });
    return response.data;
  }

  async getProjectHealth(projectId: string) {
    const response = await this.api.get(`/predictions/project/${projectId}/health`);
    return response.data;
  }

  async getScopeCreepIndicators(projectId: string) {
    const response = await this.api.get(`/predictions/project/${projectId}/scope-creep`);
    return response.data;
  }

  async getTaskSlipPredictions(projectId: string) {
    const response = await this.api.get(`/predictions/project/${projectId}/task-slips`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Learning & Feedback endpoints
  // -------------------------------------------------------------------------

  async submitFeedback(data: {
    feature: string;
    projectId?: string;
    userAction: 'accepted' | 'modified' | 'rejected';
    feedbackText?: string;
  }) {
    const response = await this.api.post('/learning/feedback', data);
    return response.data;
  }

  async submitAccuracy(data: {
    projectId: string;
    metricType: string;
    predictedValue: number;
    actualValue: number;
    projectType?: string;
  }) {
    const response = await this.api.post('/learning/accuracy', data);
    return response.data;
  }

  async getAccuracyReport(projectType?: string) {
    const params = projectType ? { projectType } : {};
    const response = await this.api.get('/learning/accuracy-report', { params });
    return response.data;
  }

  async getFeedbackStats(feature?: string) {
    const params = feature ? { feature } : {};
    const response = await this.api.get('/learning/feedback-stats', { params });
    return response.data;
  }

  async getLearningInsights() {
    const response = await this.api.get('/learning/insights');
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Intelligence endpoints
  // -------------------------------------------------------------------------

  async getPortfolioAnomalies() {
    const response = await this.api.get('/intelligence/anomalies');
    return response.data;
  }

  async getProjectAnomalies(projectId: string) {
    const response = await this.api.get(`/intelligence/anomalies/project/${projectId}`);
    return response.data;
  }

  async getCrossProjectIntelligence() {
    const response = await this.api.get('/intelligence/cross-project');
    return response.data;
  }

  async getSimilarProjects(projectId: string) {
    const response = await this.api.get(`/intelligence/cross-project/similar/${projectId}`);
    return response.data;
  }

  async modelScenario(data: {
    projectId: string;
    scenario: string;
    parameters?: {
      budgetChangePct?: number;
      workerChange?: number;
      daysExtension?: number;
      scopeChangePct?: number;
    };
  }) {
    const response = await this.api.post('/intelligence/scenarios', data);
    return response.data;
  }

  async getScenarioBaseline(projectId: string) {
    const response = await this.api.get(`/intelligence/scenarios/baseline/${projectId}`);
    return response.data;
  }

  async getScenarioHistory(projectId: string) {
    const response = await this.api.get(`/intelligence/scenarios/history/${projectId}`);
    return response.data;
  }

  async deleteScenario(id: string) {
    const response = await this.api.delete(`/intelligence/scenarios/${id}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Natural Language Query
  // -------------------------------------------------------------------------

  async submitNLQuery(data: { query: string; context?: { projectId?: string } }) {
    const response = await this.api.post('/nl-query', data);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Agent
  // -------------------------------------------------------------------------

  async triggerAgentScan(projectId?: string) {
    const response = await this.api.post('/agent/trigger', projectId ? { projectId } : {});
    return response.data;
  }

  async getAgentProposals(params?: { projectId?: string; status?: string; agentId?: string; limit?: number; offset?: number }) {
    const response = await this.api.get('/agent/proposals', { params });
    return response.data;
  }

  async getAgentProposal(id: string) {
    const response = await this.api.get(`/agent/proposals/${id}`);
    return response.data;
  }

  async approveAgentProposal(id: string, comment?: string) {
    const response = await this.api.post(`/agent/proposals/${id}/approve`, { comment });
    return response.data;
  }

  async rejectAgentProposal(id: string, reason?: string) {
    const response = await this.api.post(`/agent/proposals/${id}/reject`, { reason });
    return response.data;
  }

  async executeAgentProposal(id: string) {
    const response = await this.api.post(`/agent/proposals/${id}/execute`);
    return response.data;
  }

  async rollbackAgentProposal(id: string) {
    const response = await this.api.post(`/agent/proposals/${id}/rollback`);
    return response.data;
  }

  async getAgentProposalActions(id: string) {
    const response = await this.api.get(`/agent/proposals/${id}/actions`);
    return response.data;
  }

  async submitAgentProposalFeedback(id: string, outcome: string, comment?: string) {
    const response = await this.api.post(`/agent/proposals/${id}/feedback`, { outcome, comment });
    return response.data;
  }

  async getAgentHealth() {
    const response = await this.api.get('/agent/health');
    return response.data;
  }

  async getAgentKillSwitch() {
    const response = await this.api.get('/agent/kill-switch');
    return response.data;
  }

  // Autonomy (Tier 3)

  async getAutonomyConfigs() {
    const response = await this.api.get('/agent/autonomy');
    return response.data;
  }

  async getAutonomyEligibility(agentId: string, projectId?: string) {
    const response = await this.api.get(`/agent/autonomy/${agentId}/eligibility`, { params: projectId ? { projectId } : {} });
    return response.data;
  }

  async promoteAgent(agentId: string, opts?: { projectId?: string; minConfidenceThreshold?: number; maxRiskLevel?: string }) {
    const response = await this.api.put(`/agent/autonomy/${agentId}`, { action: 'promote', ...opts });
    return response.data;
  }

  async demoteAgent(agentId: string, projectId?: string) {
    const response = await this.api.put(`/agent/autonomy/${agentId}`, { action: 'demote', projectId });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Agent Activity Log
  // -------------------------------------------------------------------------

  async getAgentActivityLog(projectId: string, limit = 50, offset = 0, agent?: string) {
    const params: Record<string, string | number> = { limit, offset };
    if (agent) params.agent = agent;
    const response = await this.api.get(`/agent-log/${projectId}`, { params });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Narratives
  // -------------------------------------------------------------------------

  async getProjectNarrative(projectId: string) {
    const response = await this.api.get(`/narratives/project/${projectId}`);
    return response.data;
  }

  async getPortfolioNarrative() {
    const response = await this.api.get('/narratives/portfolio');
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Text Simplification & Reading Level
  // -------------------------------------------------------------------------

  async simplifyText(text: string, level: 'mild' | 'strong') {
    const response = await this.api.post('/accessibility/simplify', { text, level });
    return response.data;
  }

  async analyzeReadingLevel(text: string) {
    const response = await this.api.post('/accessibility/reading-level', { text });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // AI Task Estimation
  // -------------------------------------------------------------------------

  async estimateTaskDuration(data: { taskName: string; taskDescription?: string; projectId: string; scheduleId?: string }) {
    const response = await this.api.post('/ai/estimate-task', data);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Document Intelligence
  // -------------------------------------------------------------------------

  async uploadProjectDocument(projectId: string, file: File, description?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (description) formData.append('description', description);
    const response = await this.api.post(`/projects/${projectId}/documents/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getProjectDocuments(projectId: string, filters?: { documentType?: string; projectPhase?: string; folder?: string; search?: string }) {
    const params: Record<string, string> = {};
    if (filters?.documentType) params.documentType = filters.documentType;
    if (filters?.projectPhase) params.projectPhase = filters.projectPhase;
    if (filters?.folder) params.folder = filters.folder;
    if (filters?.search) params.search = filters.search;
    const response = await this.api.get(`/projects/${projectId}/documents`, { params });
    return response.data;
  }

  async getProjectDocument(projectId: string, documentId: string) {
    const response = await this.api.get(`/projects/${projectId}/documents/${documentId}`);
    return response.data;
  }

  async searchProjectDocuments(projectId: string, query: string, topK?: number) {
    const params: Record<string, string> = { q: query };
    if (topK) params.topK = String(topK);
    const response = await this.api.get(`/projects/${projectId}/documents/search`, { params });
    return response.data;
  }

  async getProjectDocumentFolders(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/documents/folders`);
    return response.data;
  }

  async updateProjectDocument(projectId: string, documentId: string, data: { description?: string | null; folder?: string | null; isPinned?: boolean }) {
    const response = await this.api.patch(`/projects/${projectId}/documents/${documentId}`, data);
    return response.data;
  }

  async deleteProjectDocument(projectId: string, documentId: string) {
    const response = await this.api.delete(`/projects/${projectId}/documents/${documentId}`);
    return response.data;
  }

  async reprocessProjectDocument(projectId: string, documentId: string) {
    const response = await this.api.post(`/projects/${projectId}/documents/${documentId}/reprocess`);
    return response.data;
  }

  getDocumentDownloadUrl(projectId: string, documentId: string): string {
    return `${this.api.defaults.baseURL}/projects/${projectId}/documents/${documentId}/download`;
  }

  // -------------------------------------------------------------------------
  // Context Engineering
  // -------------------------------------------------------------------------

  async getResolvedContextConfig(projectId?: string) {
    const params: Record<string, string> = {};
    if (projectId) params.projectId = projectId;
    const response = await this.api.get('/context/config', { params });
    return response.data;
  }

  async getContextConfigAtScope(scope: string, scopeId: string) {
    const response = await this.api.get(`/context/config/${scope}/${scopeId}`);
    return response.data;
  }

  async updateContextConfig(scope: string, scopeId: string, configKey: string, configValue: unknown, versionHash?: string) {
    const response = await this.api.put(`/context/config/${scope}/${scopeId}`, { configKey, configValue, versionHash });
    return response.data;
  }

  async lockContextConfigKey(scope: string, scopeId: string, configKey: string) {
    const response = await this.api.post(`/context/config/${scope}/${scopeId}/lock`, { configKey });
    return response.data;
  }

  async getContextConfigHistory(configId: string) {
    const response = await this.api.get(`/context/config/history/${configId}`);
    return response.data;
  }

  async previewAIContext(projectId?: string) {
    const params: Record<string, string> = {};
    if (projectId) params.projectId = projectId;
    const response = await this.api.get('/context/preview', { params });
    return response.data;
  }

  // Versioned Memory
  async listVersionedMemories(filters?: Record<string, string>) {
    const response = await this.api.get('/memory', { params: filters });
    return response.data;
  }

  async getVersionedMemory(id: string) {
    const response = await this.api.get(`/memory/${id}`);
    return response.data;
  }

  async updateVersionedMemory(id: string, data: { value?: unknown; permissionScope?: string; versionHash: string }) {
    const response = await this.api.put(`/memory/${id}`, data);
    return response.data;
  }

  async deleteVersionedMemory(id: string) {
    const response = await this.api.delete(`/memory/${id}`);
    return response.data;
  }

  async rollbackMemory(id: string) {
    const response = await this.api.post(`/memory/${id}/rollback`);
    return response.data;
  }

  async getMemoryHistory(id: string) {
    const response = await this.api.get(`/memory/${id}/history`);
    return response.data;
  }

  // Dreaming
  async listDreamingRuns() {
    const response = await this.api.get('/dreaming/runs');
    return response.data;
  }

  async listDreamingProposals(status?: string) {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    const response = await this.api.get('/dreaming/proposals', { params });
    return response.data;
  }

  async approveDreamingProposal(id: string) {
    const response = await this.api.post(`/dreaming/proposals/${id}/approve`);
    return response.data;
  }

  async rejectDreamingProposal(id: string) {
    const response = await this.api.post(`/dreaming/proposals/${id}/reject`);
    return response.data;
  }

  async triggerDreamingRun() {
    const response = await this.api.post('/dreaming/trigger');
    return response.data;
  }

  // Skills
  async listSkills() {
    const response = await this.api.get('/skills');
    return response.data;
  }

  async getSkillDetail(id: string) {
    const response = await this.api.get(`/skills/${id}`);
    return response.data;
  }
}

import { ApiBase } from './http';

/**
 * External integrations, webhooks, storage connectors, Slack, Teams, Web Push and Google Calendar.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class IntegrationsApi extends ApiBase {
  // -------------------------------------------------------------------------
  // External Integrations
  // -------------------------------------------------------------------------

  async createIntegration(data: { provider: string; config: Record<string, unknown>; projectId?: string }) {
    const response = await this.api.post('/integrations', data);
    return response.data;
  }

  async getIntegrations() {
    const response = await this.api.get('/integrations');
    return response.data;
  }

  async getIntegration(id: string) {
    const response = await this.api.get(`/integrations/${id}`);
    return response.data;
  }

  async updateIntegration(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/integrations/${id}`, data);
    return response.data;
  }

  async deleteIntegration(id: string) {
    const response = await this.api.delete(`/integrations/${id}`);
    return response.data;
  }

  async testIntegrationConnection(id: string) {
    const response = await this.api.post(`/integrations/${id}/test`);
    return response.data;
  }

  async syncIntegration(id: string, direction: string) {
    const response = await this.api.post(`/integrations/${id}/sync`, { direction });
    return response.data;
  }

  async getIntegrationSyncLog(id: string) {
    const response = await this.api.get(`/integrations/${id}/log`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  async createWebhook(data: { url: string; events: string[] }) {
    const response = await this.api.post('/webhooks', data);
    return response.data;
  }

  async listWebhooks() {
    const response = await this.api.get('/webhooks');
    return response.data;
  }

  async updateWebhook(id: string, data: { url?: string; events?: string[]; isActive?: boolean }) {
    const response = await this.api.put(`/webhooks/${id}`, data);
    return response.data;
  }

  async deleteWebhook(id: string) {
    const response = await this.api.delete(`/webhooks/${id}`);
    return response.data;
  }

  async testWebhook(id: string) {
    const response = await this.api.post(`/webhooks/${id}/test`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Webhook Deliveries
  // -------------------------------------------------------------------------

  async getWebhookDeliveries(webhookId: string, page = 1, limit = 20) {
    const response = await this.api.get(`/webhooks/${webhookId}/deliveries`, { params: { page, limit } });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Storage Connectors (BYOS)
  // -------------------------------------------------------------------------

  async listStorageConnectors(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/storage-connectors`);
    return response.data;
  }

  async getAvailableProviders(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/storage-connectors/providers`);
    return response.data;
  }

  async initiateStorageAuth(projectId: string, provider: string, extra?: Record<string, string>) {
    const response = await this.api.post(`/projects/${projectId}/storage-connectors/${provider}/auth`, extra || {});
    return response.data;
  }

  /** @deprecated Use initiateStorageAuth instead */
  async initiateOneDriveAuth(projectId: string) {
    return this.initiateStorageAuth(projectId, 'onedrive');
  }

  async browseConnectorFolder(projectId: string, connectorId: string, folderId?: string) {
    const params: Record<string, string> = {};
    if (folderId) params.folderId = folderId;
    const response = await this.api.get(`/projects/${projectId}/storage-connectors/${connectorId}/browse`, { params });
    return response.data;
  }

  async setConnectorFolders(projectId: string, connectorId: string, folderIds: string[]) {
    const response = await this.api.put(`/projects/${projectId}/storage-connectors/${connectorId}/folders`, { folderIds });
    return response.data;
  }

  async triggerConnectorSync(projectId: string, connectorId: string) {
    const response = await this.api.post(`/projects/${projectId}/storage-connectors/${connectorId}/sync`);
    return response.data;
  }

  async updateStorageConnector(projectId: string, connectorId: string, data: { displayName?: string; status?: string; syncIntervalMinutes?: number }) {
    const response = await this.api.put(`/projects/${projectId}/storage-connectors/${connectorId}`, data);
    return response.data;
  }

  async deleteStorageConnector(projectId: string, connectorId: string) {
    const response = await this.api.delete(`/projects/${projectId}/storage-connectors/${connectorId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Slack OAuth
  // -------------------------------------------------------------------------

  async getSlackInstallUrl() {
    const response = await this.api.get('/slack/install');
    return response.data;
  }

  async getSlackChannels(integrationId?: string) {
    const response = await this.api.get('/slack/channels', {
      params: integrationId ? { integrationId } : undefined,
    });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Microsoft Teams
  // -------------------------------------------------------------------------

  async getTeamsInstallUrl() {
    const response = await this.api.get('/teams/install');
    return response.data;
  }

  async getTeamsTeams(integrationId?: string) {
    const response = await this.api.get('/teams/teams', {
      params: integrationId ? { integrationId } : undefined,
    });
    return response.data;
  }

  async getTeamsChannels(integrationId: string, teamId: string) {
    const response = await this.api.get('/teams/channels', {
      params: { integrationId, teamId },
    });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Web Push Notifications
  // -------------------------------------------------------------------------

  async getVapidKey() {
    const response = await this.api.get('/notifications/push/vapid-key');
    return response.data;
  }

  async subscribeToPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    const response = await this.api.post('/notifications/push/subscribe', subscription);
    return response.data;
  }

  async unsubscribeFromPush(endpoint: string) {
    const response = await this.api.delete('/notifications/push/subscribe', { data: { endpoint } });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Google Calendar
  // -------------------------------------------------------------------------

  async getCalendarConnectUrl() {
    const response = await this.api.get('/calendar/connect');
    return response.data;
  }

  async getCalendarList() {
    const response = await this.api.get('/calendar/calendars');
    return response.data;
  }

  async syncCalendar() {
    const response = await this.api.post('/calendar/sync');
    return response.data;
  }

  async updateCalendarSettings(settings: { calendarId?: string; syncDirection?: string }) {
    const response = await this.api.post('/calendar/settings', settings);
    return response.data;
  }

  async disconnectCalendar() {
    const response = await this.api.delete('/calendar/disconnect');
    return response.data;
  }

  async linkTaskToCalendar(data: { taskId: string; name: string; startDate?: string; endDate?: string; dueDate?: string; description?: string }) {
    const response = await this.api.post('/calendar/link-task', data);
    return response.data;
  }
}

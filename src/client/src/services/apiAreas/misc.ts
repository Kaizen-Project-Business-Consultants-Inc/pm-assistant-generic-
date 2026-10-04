import { ApiBase } from './http';

/**
 * Notifications, global search, goals/OKRs and the generic request helper.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class MiscApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  async getNotifications(limit = 50, offset = 0) {
    const response = await this.api.get('/notifications', { params: { limit, offset } });
    return response.data;
  }

  async getUnreadNotificationCount() {
    const response = await this.api.get('/notifications/unread-count');
    return response.data;
  }

  async markNotificationRead(id: string) {
    const response = await this.api.post(`/notifications/${id}/read`);
    return response.data;
  }

  async markAllNotificationsRead() {
    const response = await this.api.post('/notifications/mark-all-read');
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Global Search
  // -------------------------------------------------------------------------

  async search(q: string, filters?: { type?: string; project?: string; status?: string }) {
    const params: Record<string, string> = { q };
    if (filters?.type) params.type = filters.type;
    if (filters?.project) params.project = filters.project;
    if (filters?.status) params.status = filters.status;
    const response = await this.api.get('/search', { params });
    return response.data;
  }

  /** Generic request helper for one-off API calls */
  async request(method: 'get' | 'post' | 'put' | 'delete', path: string, data?: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.api[method](path, data as any);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Goals / OKR
  // -------------------------------------------------------------------------

  async listGoals(params?: { ownerId?: string; projectId?: string; goalType?: string; status?: string }) {
    const response = await this.api.get('/goals', { params });
    return response.data;
  }

  async getGoal(id: string) {
    const response = await this.api.get(`/goals/${id}`);
    return response.data;
  }

  async createGoal(data: Record<string, unknown>) {
    const response = await this.api.post('/goals', data);
    return response.data;
  }

  async updateGoal(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/goals/${id}`, data);
    return response.data;
  }

  async deleteGoal(id: string) {
    const response = await this.api.delete(`/goals/${id}`);
    return response.data;
  }
}

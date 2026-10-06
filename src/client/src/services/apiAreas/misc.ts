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

  /**
   * Generic request helper for one-off API calls. `data` is the request body for POST / PUT,
   * the query string for GET (`?key=value`), and the JSON body for DELETE (axios `{ data }`,
   * as the app's other DELETEs with a body send it). axios's second argument to get/delete
   * is the request options, not a body — passing `data` there used to send nothing.
   */
  async request(method: 'get' | 'post' | 'put' | 'delete', path: string, data?: unknown) {
    let response;
    if (method === 'get') {
      response = await this.api.get(path, data === undefined ? undefined : { params: data });
    } else if (method === 'delete') {
      response = await this.api.delete(path, data === undefined ? undefined : { data });
    } else if (method === 'post') {
      response = await this.api.post(path, data);
    } else {
      response = await this.api.put(path, data);
    }
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

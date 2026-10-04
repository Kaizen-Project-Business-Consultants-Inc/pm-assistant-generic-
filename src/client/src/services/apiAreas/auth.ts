import { ApiBase } from './http';

/**
 * Sign-in, account, invites, organisation members, personal preferences and API keys.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class AuthApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Auth endpoints
  // -------------------------------------------------------------------------

  async login(username: string, password: string) {
    const response = await this.api.post('/auth/login', { username, password });
    return response.data;
  }

  async register(userData: {
    username?: string;
    email: string;
    password: string;
    fullName?: string;
    organizationName?: string;
    inviteToken?: string;
    tier?: 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise';
    plan?: 'monthly' | 'annual';
    seats?: number;
    /** Cloudflare Turnstile proof. Absent when the challenge is switched off. */
    turnstileToken?: string;
  }) {
    const response = await this.api.post('/auth/register', userData);
    return response.data;
  }

  async logout() {
    const response = await this.api.post('/auth/logout');
    return response.data;
  }

  async verifyEmail(token: string) {
    const response = await this.api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`);
    return response.data;
  }

  /** Public CAPTCHA site key, or '' when the challenge is switched off. */
  async getTurnstileSiteKey(): Promise<string> {
    const response = await this.api.get('/auth/turnstile');
    return response.data?.siteKey ?? '';
  }

  async resendVerificationEmail(email: string) {
    const response = await this.api.post('/auth/resend-verification', { email });
    return response.data;
  }

  async forgotPassword(email: string) {
    const response = await this.api.post('/auth/forgot-password', { email });
    return response.data;
  }

  async resetPassword(token: string, password: string) {
    const response = await this.api.post('/auth/reset-password', { token, password });
    return response.data;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const response = await this.api.post('/auth/change-password', { currentPassword, newPassword });
    return response.data;
  }

  async deleteAccount() {
    const response = await this.api.delete('/auth/delete-account');
    return response.data;
  }

  async getCurrentUser() {
    const response = await this.api.get('/users/me');
    return response.data;
  }

  async getMe() {
    const response = await this.api.get('/auth/me');
    return response.data;
  }

  // -------------------------------------------------------------------------
  // API Keys
  // -------------------------------------------------------------------------

  async createApiKey(data: { name: string; scopes?: string[]; rateLimit?: number; expiresAt?: string }) {
    const response = await this.api.post('/api-keys', data);
    return response.data;
  }

  async listApiKeys() {
    const response = await this.api.get('/api-keys');
    return response.data;
  }

  async revokeApiKey(id: string) {
    const response = await this.api.delete(`/api-keys/${id}`);
    return response.data;
  }

  async getApiKeyUsage(id: string, since?: string) {
    const response = await this.api.get(`/api-keys/${id}/usage`, { params: { since } });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Notification Preferences
  // -------------------------------------------------------------------------

  async getNotificationPreferences() {
    const response = await this.api.get('/users/me');
    return response.data;
  }

  async updateProfile(data: { fullName?: string; email?: string; username?: string; organizationName?: string; role?: string }) {
    const response = await this.api.put('/users/me/profile', data);
    return response.data;
  }

  async updateNotificationPreferences(prefs: {
    emailNotificationsEnabled?: boolean;
    digestFrequency?: 'none' | 'daily' | 'weekly';
    digestPreferredHour?: number;
    digestSections?: string[];
    typePreferences?: Record<string, { inApp: boolean; email: boolean }>;
  }) {
    const response = await this.api.put('/users/me/notification-preferences', prefs);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // User Preferences (timezone, locale)
  // -------------------------------------------------------------------------

  async updateUserPreferences(prefs: { timezone?: string; locale?: string }) {
    const response = await this.api.put('/users/me/preferences', prefs);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Accessibility Preferences
  // -------------------------------------------------------------------------

  async getAccessibilityPreferences() {
    const response = await this.api.get('/users/me/accessibility');
    return response.data;
  }

  async updateAccessibilityPreferences(prefs: Record<string, unknown>) {
    const response = await this.api.put('/users/me/accessibility', prefs);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Dashboard preferences
  // -------------------------------------------------------------------------

  async getDashboardPreferences() {
    const response = await this.api.get('/users/me/dashboard-preferences');
    return response.data;
  }

  async updateDashboardPreferences(prefs: { enabledWidgets: string[]; widgetOrder: string[]; scope?: string }) {
    const response = await this.api.put('/users/me/dashboard-preferences', prefs);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Invites
  // -------------------------------------------------------------------------

  async createInvite(data: { email: string; projectId?: string; role?: string }) {
    const response = await this.api.post('/invites', data);
    return response.data;
  }

  async listInvites() {
    const response = await this.api.get('/invites');
    return response.data;
  }

  async validateInvite(token: string) {
    const response = await this.api.get(`/invites/${token}/validate`);
    return response.data;
  }

  async revokeInvite(id: string) {
    const response = await this.api.delete(`/invites/${id}`);
    return response.data;
  }

  async resendInvite(id: string) {
    const response = await this.api.post(`/invites/${id}/resend`);
    return response.data;
  }

  async acceptInvite(token: string) {
    const response = await this.api.post('/invites/accept', { token });
    return response.data;
  }

  // --- Organization management ---
  async getOrgMembers() {
    const response = await this.api.get('/org/members');
    return response.data;
  }

  async inviteOrgMember(email: string, role: string) {
    const response = await this.api.post('/org/invite', { email, role });
    return response.data;
  }

  async updateOrgMemberRole(memberId: string, role: string) {
    const response = await this.api.patch(`/org/members/${memberId}`, { role });
    return response.data;
  }

  async removeOrgMember(memberId: string) {
    const response = await this.api.delete(`/org/members/${memberId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // View Preferences (cross-device UI state)
  // -------------------------------------------------------------------------

  async getViewPreferences() {
    const response = await this.api.get('/users/me/view-preferences');
    return response.data;
  }

  async updateViewPreferences(prefs: Record<string, unknown>) {
    const response = await this.api.put('/users/me/view-preferences', prefs);
    return response.data;
  }
}

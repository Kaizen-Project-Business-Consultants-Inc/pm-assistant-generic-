import { ApiBase } from './http';

/**
 * Projects, members, links, groups, sample project, templates, custom fields, attachments, portal, intake, guests and lessons learned.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class ProjectsApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Project endpoints
  // -------------------------------------------------------------------------

  async getProjects(scope?: 'portfolio', includeArchived = false) {
    const qp = new URLSearchParams();
    if (scope) qp.set('scope', scope);
    if (includeArchived) qp.set('includeArchived', 'true');
    const qs = qp.toString();
    const response = await this.api.get(`/projects${qs ? `?${qs}` : ''}`);
    return response.data;
  }

  async getProject(id: string) {
    const response = await this.api.get(`/projects/${id}`);
    return response.data;
  }

  async getProjectSummary(id: string) {
    const response = await this.api.get(`/projects/${id}/summary`);
    return response.data;
  }

  async createProject(projectData: {
    name: string;
    description?: string;
    status?: string;
    priority?: string;
    methodology?: string;
    budgetAllocated?: number;
    startDate?: string;
    endDate?: string;
    location?: string;
  }) {
    const response = await this.api.post('/projects', projectData);
    return response.data;
  }

  async updateProject(id: string, projectData: Record<string, unknown>) {
    const response = await this.api.put(`/projects/${id}`, projectData);
    return response.data;
  }

  async updateProjectStatus(id: string, status: string, cancellationReason?: string) {
    const body: Record<string, string> = { status };
    if (cancellationReason) body.cancellationReason = cancellationReason;
    const response = await this.api.patch(`/projects/${id}/status`, body);
    return response.data;
  }

  async deleteProject(id: string) {
    const response = await this.api.delete(`/projects/${id}`);
    return response.data;
  }

  async archiveProject(id: string) {
    const response = await this.api.post(`/projects/${id}/archive`);
    return response.data;
  }

  async unarchiveProject(id: string) {
    const response = await this.api.post(`/projects/${id}/unarchive`);
    return response.data;
  }

  async getFavouriteProjects() {
    const response = await this.api.get('/projects/favourites');
    return response.data;
  }

  async favouriteProject(projectId: string) {
    const response = await this.api.post(`/projects/${projectId}/favourite`);
    return response.data;
  }

  async unfavouriteProject(projectId: string) {
    const response = await this.api.delete(`/projects/${projectId}/favourite`);
    return response.data;
  }

  /** Settings → Sample project: is the read-only example loaded, and may this user change that */
  async getSampleProject(): Promise<{ loaded: boolean; canManage: boolean }> {
    return (await this.api.get('/sample-project')).data;
  }

  async removeSampleProject(): Promise<{ loaded: false; removed: number; keptPeople: string[] }> {
    return (await this.api.post('/sample-project/remove')).data;
  }

  async loadSampleProject(): Promise<{ loaded: true }> {
    return (await this.api.post('/sample-project/load')).data;
  }

  // -------------------------------------------------------------------------
  // Project Members (RBAC)
  // -------------------------------------------------------------------------

  async getProjectMembers(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/members`);
    return response.data;
  }

  // Project Links
  async getProjectLinks(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/links`);
    return response.data;
  }

  async createProjectLink(projectId: string, data: { label: string; url: string; icon?: string }) {
    const response = await this.api.post(`/projects/${projectId}/links`, data);
    return response.data;
  }

  async updateProjectLink(projectId: string, linkId: string, data: { label?: string; url?: string; icon?: string | null }) {
    const response = await this.api.put(`/projects/${projectId}/links/${linkId}`, data);
    return response.data;
  }

  async deleteProjectLink(projectId: string, linkId: string) {
    const response = await this.api.delete(`/projects/${projectId}/links/${linkId}`);
    return response.data;
  }

  async reorderProjectLinks(projectId: string, orderedIds: string[]) {
    const response = await this.api.put(`/projects/${projectId}/links/reorder`, { orderedIds });
    return response.data;
  }

  async addProjectMember(projectId: string, data: { userId?: string; userName: string; email: string; role: string }) {
    const response = await this.api.post(`/projects/${projectId}/members`, data);
    return response.data;
  }

  async updateProjectMemberRole(projectId: string, memberId: string, role: string) {
    const response = await this.api.put(`/projects/${projectId}/members/${memberId}`, { role });
    return response.data;
  }

  async removeProjectMember(projectId: string, memberId: string) {
    const response = await this.api.delete(`/projects/${projectId}/members/${memberId}`);
    return response.data;
  }

  /** The caller's role on a project: { role, canEdit, canManageOwners } */
  async getMyProjectRole(projectId: string) {
    const response = await this.api.get(`/projects/${projectId}/members/me`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Lessons Learned
  // -------------------------------------------------------------------------

  async getLessonsKnowledgeBase() {
    const response = await this.api.get('/lessons-learned/knowledge-base');
    return response.data;
  }

  async extractLessons(projectId: string) {
    const response = await this.api.post(`/lessons-learned/extract/${projectId}`);
    return response.data;
  }

  async getRelevantLessons(projectType?: string, category?: string) {
    const params: Record<string, string> = {};
    if (projectType) params.projectType = projectType;
    if (category) params.category = category;
    const response = await this.api.get('/lessons-learned/relevant', { params });
    return response.data;
  }

  async detectPatterns() {
    const response = await this.api.post('/lessons-learned/patterns');
    return response.data;
  }

  async suggestMitigations(riskDescription: string, projectType: string) {
    const response = await this.api.post('/lessons-learned/mitigations', { riskDescription, projectType });
    return response.data;
  }

  async addLesson(data: { projectId: string; projectName: string; projectType: string; category: string; title: string; description: string; impact: string; recommendation: string; rootCause?: string; severity?: string }) {
    const response = await this.api.post('/lessons-learned', data);
    return response.data;
  }

  async seedLessons() {
    const response = await this.api.post('/lessons-learned/seed');
    return response.data;
  }

  async updateLesson(id: string, data: { title?: string; description?: string; category?: string; impact?: string; recommendation?: string; rootCause?: string; severity?: string; isElevated?: boolean; tags?: string[]; status?: string }) {
    const response = await this.api.put(`/lessons-learned/${id}`, data);
    return response.data;
  }

  async updateLessonStatus(id: string, status: string) {
    const response = await this.api.patch(`/lessons-learned/${id}/status`, { status });
    return response.data;
  }

  async deleteLesson(id: string) {
    const response = await this.api.delete(`/lessons-learned/${id}`);
    return response.data;
  }

  async elevateLesson(id: string) {
    const response = await this.api.patch(`/lessons-learned/${id}/elevate`);
    return response.data;
  }

  async getLessonsReport() {
    const response = await this.api.get('/lessons-learned/report');
    return response.data;
  }

  async submitLessonFeedback(lessonId: string, action: 'helpful' | 'dismissed' | 'outdated', comment?: string, context?: string) {
    const response = await this.api.post(`/lessons-learned/${lessonId}/feedback`, { action, comment, context });
    return response.data;
  }

  async getLessons(limit = 20, offset = 0, projectId?: string) {
    const params: Record<string, any> = { limit, offset };
    if (projectId) params.projectId = projectId;
    const response = await this.api.get('/lessons-learned', { params });
    return response.data;
  }

  async getPatterns() {
    const response = await this.api.get('/lessons-learned/knowledge-base');
    return response.data?.data || response.data;
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  async getTemplates(projectType?: string, category?: string) {
    const params: Record<string, string> = {};
    if (projectType) params.projectType = projectType;
    if (category) params.category = category;
    const response = await this.api.get('/templates', { params });
    return response.data;
  }

  async getTemplate(id: string) {
    const response = await this.api.get(`/templates/${id}`);
    return response.data;
  }

  async createTemplate(data: Record<string, unknown>) {
    const response = await this.api.post('/templates', data);
    return response.data;
  }

  async applyTemplate(data: {
    templateId: string;
    projectName: string;
    startDate: string;
    budget?: number;
    priority?: string;
    methodology?: string;
    location?: string;
    selectedTaskRefIds?: string[];
  }) {
    const response = await this.api.post('/templates/apply', data);
    return response.data;
  }

  async saveProjectAsTemplate(data: {
    projectId: string;
    templateName: string;
    description?: string;
    tags?: string[];
  }) {
    const response = await this.api.post('/templates/save-from-project', data);
    return response.data;
  }

  async getMarketplaceTemplates(category?: string) {
    const params: Record<string, string> = {};
    if (category) params.category = category;
    const response = await this.api.get('/templates/marketplace', { params });
    return response.data;
  }

  async publishTemplate(id: string) {
    const response = await this.api.post(`/templates/${id}/publish`);
    return response.data;
  }

  async importMarketplaceTemplate(marketplaceId: string) {
    const response = await this.api.post(`/templates/marketplace/${marketplaceId}/import`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Agent Activity Log
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // File Attachments
  // -------------------------------------------------------------------------

  async uploadAttachment(entityType: string, entityId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await this.api.post(`/attachments/${entityType}/${entityId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getAttachments(entityType: string, entityId: string) {
    const response = await this.api.get(`/attachments/${entityType}/${entityId}`);
    return response.data;
  }

  async downloadAttachment(id: string) {
    const response = await this.api.get(`/attachments/${id}/download`, { responseType: 'blob' });
    return response.data;
  }

  async uploadAttachmentVersion(id: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await this.api.post(`/attachments/${id}/version`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getAttachmentVersions(id: string) {
    const response = await this.api.get(`/attachments/${id}/versions`);
    return response.data;
  }

  async deleteAttachment(id: string) {
    const response = await this.api.delete(`/attachments/${id}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Custom Fields
  // -------------------------------------------------------------------------

  async getCustomFields(projectId: string, entityType?: string) {
    const params: Record<string, string> = {};
    if (entityType) params.entityType = entityType;
    const response = await this.api.get(`/custom-fields/project/${projectId}`, { params });
    return response.data;
  }

  async createCustomField(projectId: string, data: {
    entityType: string; fieldName: string; fieldLabel: string;
    fieldType: string; options?: string[]; isRequired?: boolean; sortOrder?: number;
  }) {
    const response = await this.api.post(`/custom-fields/project/${projectId}`, data);
    return response.data;
  }

  async updateCustomField(id: string, data: { fieldLabel?: string; fieldType?: string; options?: string[]; isRequired?: boolean; sortOrder?: number }) {
    const response = await this.api.put(`/custom-fields/${id}`, data);
    return response.data;
  }

  async deleteCustomField(id: string) {
    const response = await this.api.delete(`/custom-fields/${id}`);
    return response.data;
  }

  async getCustomFieldValues(entityType: string, entityId: string, projectId: string) {
    const response = await this.api.get(`/custom-fields/values/${entityType}/${entityId}`, { params: { projectId } });
    return response.data;
  }

  async saveCustomFieldValues(entityType: string, entityId: string, values: Array<{ fieldId: string; text?: string; number?: number; date?: string; boolean?: boolean }>) {
    const response = await this.api.post(`/custom-fields/values/${entityType}/${entityId}`, { values });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Client / Stakeholder Portal
  // -------------------------------------------------------------------------

  async createPortalLink(projectId: string, data: { permissions: Record<string, boolean>; label?: string; expiresAt?: string }) {
    const response = await this.api.post(`/portal/links/${projectId}`, data);
    return response.data;
  }

  async getPortalLinks(projectId: string) {
    const response = await this.api.get(`/portal/links/${projectId}`);
    return response.data;
  }

  async updatePortalLink(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/portal/links/${id}`, data);
    return response.data;
  }

  async deletePortalLink(id: string) {
    const response = await this.api.delete(`/portal/links/${id}`);
    return response.data;
  }

  async getPortalComments(projectId: string) {
    const response = await this.api.get(`/portal/comments/${projectId}`);
    return response.data;
  }

  async getPortalView(token: string) {
    const response = await this.api.get(`/portal/view/${token}`);
    return response.data.view;
  }

  async addPortalComment(token: string, data: { entityType: string; entityId: string; authorName: string; content: string }) {
    const response = await this.api.post(`/portal/view/${token}/comment`, data);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Project Intake Forms
  // -------------------------------------------------------------------------

  async createIntakeForm(data: { name: string; description?: string; fields: any[] }) {
    const response = await this.api.post('/intake/forms', data);
    return response.data;
  }

  async getIntakeForms() {
    const response = await this.api.get('/intake/forms');
    return response.data;
  }

  async getIntakeForm(id: string) {
    const response = await this.api.get(`/intake/forms/${id}`);
    return response.data;
  }

  async updateIntakeForm(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/intake/forms/${id}`, data);
    return response.data;
  }

  async deleteIntakeForm(id: string) {
    const response = await this.api.delete(`/intake/forms/${id}`);
    return response.data;
  }

  async submitIntakeForm(formId: string, values: Record<string, unknown>) {
    const response = await this.api.post(`/intake/forms/${formId}/submit`, { values });
    return response.data;
  }

  async getIntakeSubmissions(formId?: string, status?: string) {
    const params: Record<string, string> = {};
    if (formId) params.formId = formId;
    if (status) params.status = status;
    const response = await this.api.get('/intake/submissions', { params });
    return response.data;
  }

  async getIntakeSubmission(id: string) {
    const response = await this.api.get(`/intake/submissions/${id}`);
    return response.data;
  }

  async reviewIntakeSubmission(id: string, data: { status: string; notes?: string }) {
    const response = await this.api.post(`/intake/submissions/${id}/review`, data);
    return response.data;
  }

  async convertIntakeToProject(submissionId: string) {
    const response = await this.api.post(`/intake/submissions/${submissionId}/convert`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Project Groups
  // -------------------------------------------------------------------------

  async getProjectGroups() {
    const response = await this.api.get('/project-groups');
    return response.data;
  }

  async createProjectGroup(data: { name: string; color?: string; icon?: string }) {
    const response = await this.api.post('/project-groups', data);
    return response.data;
  }

  async updateProjectGroup(id: string, data: { name?: string; color?: string; icon?: string }) {
    const response = await this.api.put(`/project-groups/${id}`, data);
    return response.data;
  }

  async deleteProjectGroup(id: string) {
    const response = await this.api.delete(`/project-groups/${id}`);
    return response.data;
  }

  async reorderProjectGroups(orderedIds: string[]) {
    const response = await this.api.put('/project-groups/reorder', { orderedIds });
    return response.data;
  }

  async assignProjectToGroup(groupId: string, projectId: string) {
    const response = await this.api.put(`/project-groups/${groupId}/assign`, { projectId });
    return response.data;
  }

  async unassignProjectFromGroup(projectId: string) {
    const response = await this.api.put('/project-groups/unassign', { projectId });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Guest Collaborators
  // -------------------------------------------------------------------------

  async inviteGuest(data: { email: string; projectId: string; permissions?: Record<string, boolean>; expiresAt?: string }) {
    const response = await this.api.post('/org/invite-guest', data);
    return response.data;
  }

  async getGuests() {
    const response = await this.api.get('/org/guests');
    return response.data;
  }

  async updateGuest(guestId: string, data: Record<string, unknown>) {
    const response = await this.api.patch(`/org/guests/${guestId}`, data);
    return response.data;
  }

  async revokeGuest(guestId: string) {
    const response = await this.api.delete(`/org/guests/${guestId}`);
    return response.data;
  }
}

import { ApiBase } from './http';

/**
 * Reports (AI, instant, status, custom, scheduled), exports, portfolio, analytics and dashboard data.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export class ReportsApi extends ApiBase {
  // -------------------------------------------------------------------------
  // AI Reports endpoints
  // -------------------------------------------------------------------------

  async generateReport(data: {
    reportType: string;
    projectId?: string;
  }) {
    const response = await this.api.post('/ai-reports/generate', data);
    return response.data;
  }

  async getReportHistory(params?: {
    type?: string;
    subType?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }) {
    const response = await this.api.get('/ai-reports/history', { params });
    return response.data;
  }

  async getReport(id: string) {
    const response = await this.api.get(`/ai-reports/${id}`);
    return response.data;
  }

  async deleteReport(id: string) {
    const response = await this.api.delete(`/ai-reports/${id}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Instant Reports endpoints
  // -------------------------------------------------------------------------

  async generateInstantReport(data: { reportType: string; projectId: string }) {
    const response = await this.api.post('/instant-reports/generate', data);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Status Reports endpoints
  // -------------------------------------------------------------------------

  async generateStatusReport(projectId: string, options?: { recipients?: string[]; sendEmail?: boolean }) {
    const response = await this.api.post('/status-reports/generate', { projectId, ...options });
    return response.data;
  }

  async scheduleStatusReport(data: {
    projectId: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek?: number;
    dayOfMonth?: number;
    timeOfDay?: string;
    recipients: string[];
  }) {
    const response = await this.api.post('/status-reports/schedule', data);
    return response.data;
  }

  async getStatusReportSchedules(projectId: string) {
    const response = await this.api.get(`/status-reports/schedules/${projectId}`);
    return response.data;
  }

  async deleteStatusReportSchedule(id: string) {
    const response = await this.api.delete(`/status-reports/schedule/${id}`);
    return response.data;
  }

  async renderStatusReport(data: any) {
    const response = await this.api.post('/status-reports/render', data);
    return response.data;
  }

  async emailStatusReport(html: string, projectName: string, recipients: string[], projectId?: string) {
    // projectId lets the server attach a portal link — the only link a client
    // without a login can actually open.
    const response = await this.api.post('/status-reports/email', { html, projectName, recipients, projectId });
    return response.data;
  }

  /**
   * The schedule review as a Word document — the one form of it that can be
   * attached to a proposal or sent to a sponsor who has no login.
   */
  async exportScheduleReviewDocx(scheduleId: string): Promise<Blob> {
    const response = await this.api.get(`/schedules/${scheduleId}/review/export/docx`, { responseType: 'blob' });
    return response.data;
  }

  async exportStatusReportDocx(data: Record<string, unknown>): Promise<Blob> {
    const response = await this.api.post('/status-reports/export/docx', data, { responseType: 'blob' });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Portfolio
  // -------------------------------------------------------------------------

  async getPortfolio() {
    const response = await this.api.get('/portfolio');
    return response.data;
  }

  async getPortfolioResources() {
    const response = await this.api.get('/portfolio/resources');
    return response.data;
  }

  async getPortfolioAnalytics() {
    const response = await this.api.get('/portfolio/analytics');
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  async exportProjectCSV(projectId: string) {
    const response = await this.api.get(`/exports/projects/${projectId}/export?format=csv`, {
      responseType: 'blob',
    });
    // Trigger download
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${projectId}-export.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  async exportProjectXML(projectId: string) {
    const response = await this.api.get(`/exports/projects/${projectId}/export?format=xml`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'application/xml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${projectId}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------------------------
  // Export (continued)
  // -------------------------------------------------------------------------

  async exportProjectJSON(projectId: string) {
    const response = await this.api.get(`/exports/projects/${projectId}/export?format=json`);
    return response.data;
  }

  /**
   * Generate a printable HTML report in a new window and trigger print.
   */
  async exportProjectPDF(projectId: string) {
    const data = await this.exportProjectJSON(projectId);
    const project = data.project;
    const schedules = data.schedules || [];

    const statusColor: Record<string, string> = {
      completed: '#22c55e',
      in_progress: '#3b82f6',
      pending: '#9ca3af',
      cancelled: '#ef4444',
    };

    let taskRowsHtml = '';
    for (const sch of schedules) {
      for (const t of sch.tasks) {
        const color = statusColor[t.status] || '#9ca3af';
        taskRowsHtml += `<tr>
          <td>${sch.name}</td>
          <td>${t.name}</td>
          <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px"></span>${t.status.replace('_', ' ')}</td>
          <td>${t.priority}</td>
          <td>${t.assignedTo}</td>
          <td>${t.startDate}</td>
          <td>${t.endDate}</td>
          <td>
            <div style="background:#e5e7eb;border-radius:4px;height:14px;width:80px;position:relative">
              <div style="background:${color};border-radius:4px;height:100%;width:${t.progressPercentage}%"></div>
              <span style="position:absolute;top:0;left:50%;transform:translateX(-50%);font-size:9px;line-height:14px">${t.progressPercentage}%</span>
            </div>
          </td>
        </tr>`;
      }
    }

    const budgetPct = project && project.budgetAllocated > 0
      ? Math.round((project.budgetSpent / project.budgetAllocated) * 100)
      : 0;

    const html = `<!DOCTYPE html>
<html><head>
<title>Project Report - ${project?.name || 'Export'}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; padding: 40px; font-size: 11px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .meta { color: #6b7280; font-size: 10px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
  .kpi .label { font-size: 9px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
  .kpi .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #f9fafb; text-align: left; padding: 6px 8px; border-bottom: 2px solid #e5e7eb; font-weight: 600; text-transform: uppercase; font-size: 9px; color: #6b7280; }
  td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
  tr:hover { background: #f9fafb; }
  .footer { margin-top: 30px; text-align: center; color: #9ca3af; font-size: 9px; }
  @media print { body { padding: 20px; } @page { size: landscape; margin: 0.4in; } }
</style>
</head><body>
<div class="header">
  <div>
    <h1>${project?.name || 'Project Report'}</h1>
    <div class="meta">Status: ${project?.status || 'N/A'} | Generated: ${new Date().toLocaleString()}</div>
  </div>
</div>

${project ? `<div class="kpis">
  <div class="kpi">
    <div class="label">Progress</div>
    <div class="value" style="color:#3b82f6">${project.progressPercentage || 0}%</div>
  </div>
  <div class="kpi">
    <div class="label">Budget Spent</div>
    <div class="value" style="color:${budgetPct > 90 ? '#ef4444' : '#22c55e'}">$${((project.budgetSpent || 0) / 1e6).toFixed(1)}M / $${((project.budgetAllocated || 0) / 1e6).toFixed(1)}M</div>
  </div>
  <div class="kpi">
    <div class="label">Budget Used</div>
    <div class="value">${budgetPct}%</div>
  </div>
  <div class="kpi">
    <div class="label">Schedules</div>
    <div class="value">${schedules.length}</div>
  </div>
</div>` : ''}

<h2>Task Schedule</h2>
<table>
  <thead>
    <tr><th>Schedule</th><th>Task</th><th>Status</th><th>Priority</th><th>Assigned To</th><th>Start</th><th>End</th><th>Progress</th></tr>
  </thead>
  <tbody>${taskRowsHtml}</tbody>
</table>

${schedules.some((s: any) => s.criticalPath?.criticalPathTaskIds?.length) ? `
<h2>Critical Path</h2>
${schedules.filter((s: any) => s.criticalPath?.criticalPathTaskIds?.length).map((s: any) => `
  <p style="margin-bottom:4px"><strong>${s.name}</strong> - Duration: ${s.criticalPath.projectDuration} days, Critical tasks: ${s.criticalPath.criticalPathTaskIds.length}</p>
  <p style="color:#6b7280;margin-bottom:12px">${s.criticalPath.criticalPathTaskIds.map((id: string) => {
    const task = s.tasks.find((t: any) => t.id === id);
    return task ? task.name : id;
  }).join(' → ')}</p>
`).join('')}` : ''}

<div class="footer">Kovarti PM - Project Report</div>

<script>window.onload = function() { window.print(); }</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  // -------------------------------------------------------------------------
  // Custom Report Builder
  // -------------------------------------------------------------------------

  async createReportTemplate(data: { name: string; description?: string; config: Record<string, unknown>; isShared?: boolean }) {
    const response = await this.api.post('/report-builder/templates', data);
    return response.data;
  }

  async getReportTemplates() {
    const response = await this.api.get('/report-builder/templates');
    return response.data;
  }

  async getReportTemplate(id: string) {
    const response = await this.api.get(`/report-builder/templates/${id}`);
    return response.data;
  }

  async updateReportTemplate(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/report-builder/templates/${id}`, data);
    return response.data;
  }

  async deleteReportTemplate(id: string) {
    const response = await this.api.delete(`/report-builder/templates/${id}`);
    return response.data;
  }

  async generateReportFromTemplate(templateId: string, params?: Record<string, unknown>) {
    const response = await this.api.post(`/report-builder/templates/${templateId}/generate`, params || {});
    return response.data;
  }

  async exportReportFromTemplate(templateId: string, format: string) {
    const response = await this.api.post(`/report-builder/templates/${templateId}/export`, { format });
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Analytics Summary
  // -------------------------------------------------------------------------

  async getAnalyticsSummary(scope?: 'portfolio') {
    const params = scope ? `?scope=${scope}` : '';
    const response = await this.api.get(`/analytics/summary${params}`);
    // The server wraps it as { summary }; three dashboard widgets read `.tasks` straight off
    // the result and showed 0 overdue. Unwrap once here so every caller gets the summary.
    return response.data?.summary ?? response.data;
  }

  async getDashboardOverdueTasks(scope?: 'portfolio') {
    const params = scope ? `?scope=${scope}` : '';
    const response = await this.api.get(`/dashboard/overdue-tasks${params}`);
    return response.data;
  }

  async getDashboardIssuesTrend(scope?: 'portfolio', weeks?: number) {
    const qp = new URLSearchParams();
    if (scope) qp.set('scope', scope);
    if (weeks) qp.set('weeks', String(weeks));
    const qs = qp.toString();
    const response = await this.api.get(`/dashboard/issues-trend${qs ? `?${qs}` : ''}`);
    return response.data;
  }

  async getDashboardMilestones(scope?: 'portfolio', limit?: number) {
    const qp = new URLSearchParams();
    if (scope) qp.set('scope', scope);
    if (limit) qp.set('limit', String(limit));
    const qs = qp.toString();
    const response = await this.api.get(`/dashboard/milestones${qs ? `?${qs}` : ''}`);
    return response.data;
  }

  async getProjectAnalyticsSummary(projectId: string) {
    const response = await this.api.get(`/analytics/summary/project/${projectId}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Report Schedules
  // -------------------------------------------------------------------------

  async createReportSchedule(data: {
    templateId: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek?: number;
    dayOfMonth?: number;
    timeOfDay?: string;
    recipients: string[];
    isActive?: boolean;
  }) {
    const response = await this.api.post('/report-schedules', data);
    return response.data;
  }

  async getReportSchedules() {
    const response = await this.api.get('/report-schedules');
    return response.data;
  }

  async getReportSchedule(id: string) {
    const response = await this.api.get(`/report-schedules/${id}`);
    return response.data;
  }

  async getReportSchedulesByTemplate(templateId: string) {
    const response = await this.api.get(`/report-schedules/template/${templateId}`);
    return response.data;
  }

  async updateReportSchedule(id: string, data: Record<string, unknown>) {
    const response = await this.api.put(`/report-schedules/${id}`, data);
    return response.data;
  }

  async deleteReportSchedule(id: string) {
    const response = await this.api.delete(`/report-schedules/${id}`);
    return response.data;
  }

  async runReportScheduleNow(id: string) {
    const response = await this.api.post(`/report-schedules/${id}/run-now`);
    return response.data;
  }

  async getAdminReportSchedules() {
    const response = await this.api.get('/report-schedules/admin/all');
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Health History
  // -------------------------------------------------------------------------

  async getHealthHistory(projectId: string, days = 30) {
    const response = await this.api.get(`/predictions/project/${projectId}/health/history?days=${days}`);
    return response.data;
  }

  // -------------------------------------------------------------------------
  // Dashboard — CR Summary
  // -------------------------------------------------------------------------

  async getDashboardCRSummary() {
    const response = await this.api.get('/dashboard/cr-summary');
    return response.data;
  }
}

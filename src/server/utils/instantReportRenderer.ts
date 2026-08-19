/**
 * Renders instant reports to styled HTML.
 * Follows statusReportRenderer.ts conventions (navy theme, inline CSS, escapeHtml).
 */

// ---------------------------------------------------------------------------
// DBJ Template colours (shared with statusReportRenderer)
// ---------------------------------------------------------------------------
const NAVY = '#283480';
const WHITE = '#FFFFFF';
const BODY_TEXT = '#1f2937';
const FONT = "Calibri, 'Segoe UI', Arial, sans-serif";
const LABEL_BG = '#EAECF6';
const GREEN_BG = '#A8D5A2';
const AMBER_BG = '#FFD966';
const RED_BG = '#FF9B9B';

const TH = `padding: 8px 10px; background: ${NAVY}; color: ${WHITE}; font-size: 11px; font-weight: 700; text-align: left; border: 1px solid ${NAVY};`;
const TD = `padding: 8px 10px; font-size: 12px; color: ${BODY_TEXT}; border: 1px solid #d1d5db; vertical-align: top;`;
const SECTION_TITLE = `color: ${NAVY}; font-size: 14px; font-weight: 700; margin: 24px 0 8px; padding: 0;`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sectionHeading(title: string): string {
  return `<p style="${SECTION_TITLE}">${escapeHtml(title)}</p>`;
}

function wrapReport(title: string, subtitle: string, projectName: string, generatedAt: string, body: string): string {
  const titleBanner = `
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 0;">
      <tr>
        <td style="background: ${NAVY}; padding: 18px 20px; border-radius: 6px 6px 0 0;">
          <p style="color: ${WHITE}; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;">${escapeHtml(title)}</p>
          <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 11px;">${escapeHtml(subtitle)}</p>
        </td>
      </tr>
    </table>`;

  const metaRow = `
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 18%;">Project</td>
        <td style="${TD} width: 32%;">${escapeHtml(projectName)}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 18%;">Generated</td>
        <td style="${TD} width: 32%;">${escapeHtml(generatedAt)}</td>
      </tr>
    </table>`;

  const footer = `
    <p style="color: #9ca3af; font-size: 10px; text-align: center; margin-top: 20px;">
      Instant Report — Kovarti PM Assistant
    </p>`;

  return `
    <div style="font-family: ${FONT}; max-width: 800px; margin: 0 auto; color: ${BODY_TEXT};">
      ${titleBanner}
      ${metaRow}
      ${body}
      ${footer}
    </div>`;
}

function emptyState(message: string): string {
  return `<p style="text-align: center; color: #6b7280; font-style: italic; padding: 24px 0; font-size: 13px;">${escapeHtml(message)}</p>`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function statusBadge(status: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    completed: { bg: GREEN_BG, text: '#166534' },
    in_progress: { bg: '#DBEAFE', text: '#1e40af' },
    pending: { bg: '#F3F4F6', text: '#374151' },
    cancelled: { bg: RED_BG, text: '#991b1b' },
  };
  const c = colors[status] || colors.pending;
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return `<span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; background: ${c.bg}; color: ${c.text};">${label}</span>`;
}

function priorityBadge(priority: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    urgent: { bg: RED_BG, text: '#991b1b' },
    high: { bg: AMBER_BG, text: '#92400e' },
    medium: { bg: '#DBEAFE', text: '#1e40af' },
    low: { bg: '#F3F4F6', text: '#374151' },
  };
  const c = colors[priority] || colors.medium;
  const label = priority.charAt(0).toUpperCase() + priority.slice(1);
  return `<span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; background: ${c.bg}; color: ${c.text};">${label}</span>`;
}

function pct(value?: number | null): string {
  if (value == null) return '—';
  return `${Math.round(value)}%`;
}

function currency(value?: number | null): string {
  if (value == null) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(value?: number | null, decimals = 2): string {
  if (value == null) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ---------------------------------------------------------------------------
// Milestone Report
// ---------------------------------------------------------------------------
export interface MilestoneReportData {
  projectName: string;
  milestones: Array<{
    name: string;
    status: string;
    dueDate?: string | null;
    endDate?: string | null;
    progressPercentage?: number | null;
    scheduleName: string;
  }>;
}

export function renderMilestoneReport(data: MilestoneReportData): string {
  const { milestones } = data;
  if (milestones.length === 0) {
    return wrapReport('MILESTONE REPORT', 'Project milestones and deliverables', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No milestones defined. Mark tasks as milestones in the schedule to populate this report.'));
  }

  const completed = milestones.filter(m => m.status === 'completed').length;
  const summary = `${milestones.length} milestone${milestones.length !== 1 ? 's' : ''} | ${completed} completed | ${milestones.length - completed} remaining`;

  const rows = milestones.map(m => `
    <tr>
      <td style="${TD}">${escapeHtml(m.name)}</td>
      <td style="${TD} text-align: center;">${statusBadge(m.status)}</td>
      <td style="${TD} text-align: center;">${formatDate(m.dueDate || m.endDate)}</td>
      <td style="${TD} text-align: center;">${pct(m.progressPercentage)}</td>
      <td style="${TD} font-size: 11px;">${escapeHtml(m.scheduleName)}</td>
    </tr>`).join('');

  const body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">${escapeHtml(summary)}</p>
    ${sectionHeading('MILESTONES')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Milestone</th>
        <th style="${TH} text-align: center; width: 100px;">Status</th>
        <th style="${TH} text-align: center; width: 100px;">Due Date</th>
        <th style="${TH} text-align: center; width: 80px;">Progress</th>
        <th style="${TH} width: 120px;">Schedule</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return wrapReport('MILESTONE REPORT', 'Project milestones and deliverables', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Critical Tasks Report
// ---------------------------------------------------------------------------
export interface CriticalTasksReportData {
  projectName: string;
  criticalTasks: Array<{
    name: string;
    duration: number;
    totalFloat: number;
    status: string;
    startDate?: string | null;
    endDate?: string | null;
  }>;
  projectDuration: number;
  scheduleName: string;
}

export function renderCriticalTasksReport(data: CriticalTasksReportData): string {
  const { criticalTasks, projectDuration, scheduleName } = data;
  if (criticalTasks.length === 0) {
    return wrapReport('CRITICAL PATH REPORT', 'Tasks on the critical path', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No tasks found in the schedule. Add tasks with dependencies to calculate the critical path.'));
  }

  const summary = `${criticalTasks.length} critical task${criticalTasks.length !== 1 ? 's' : ''} | Project duration: ${projectDuration} day${projectDuration !== 1 ? 's' : ''} | Schedule: ${scheduleName}`;

  const rows = criticalTasks.map(t => `
    <tr>
      <td style="${TD}">${escapeHtml(t.name)}</td>
      <td style="${TD} text-align: center;">${t.duration}d</td>
      <td style="${TD} text-align: center;">${t.totalFloat}d</td>
      <td style="${TD} text-align: center;">${statusBadge(t.status)}</td>
      <td style="${TD} text-align: center;">${formatDate(t.startDate)}</td>
      <td style="${TD} text-align: center;">${formatDate(t.endDate)}</td>
    </tr>`).join('');

  const body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">${escapeHtml(summary)}</p>
    ${sectionHeading('CRITICAL PATH TASKS')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Task</th>
        <th style="${TH} text-align: center; width: 80px;">Duration</th>
        <th style="${TH} text-align: center; width: 80px;">Total Float</th>
        <th style="${TH} text-align: center; width: 100px;">Status</th>
        <th style="${TH} text-align: center; width: 90px;">Start</th>
        <th style="${TH} text-align: center; width: 90px;">End</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size: 11px; color: #6b7280; margin: 6px 0 0;">Tasks with zero total float are on the critical path. Any delay to these tasks will delay the project end date.</p>`;

  return wrapReport('CRITICAL PATH REPORT', 'Tasks on the critical path', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Late & Slipping Tasks Report
// ---------------------------------------------------------------------------
export interface LateSlippingTasksReportData {
  projectName: string;
  lateTasks: Array<{
    name: string;
    status: string;
    endDate?: string | null;
    dueDate?: string | null;
    progressPercentage?: number | null;
    priority: string;
    daysLate: number;
    scheduleName: string;
  }>;
  slippingTasks: Array<{
    name: string;
    status: string;
    startDate?: string | null;
    endDate?: string | null;
    progressPercentage?: number | null;
    priority: string;
    daysSinceStart: number;
    scheduleName: string;
  }>;
}

export function renderLateSlippingReport(data: LateSlippingTasksReportData): string {
  const { lateTasks, slippingTasks } = data;
  if (lateTasks.length === 0 && slippingTasks.length === 0) {
    return wrapReport('LATE & SLIPPING TASKS', 'Past-due and stalled tasks', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No late or slipping tasks found. All tasks are on track.'));
  }

  let body = '';

  if (lateTasks.length > 0) {
    const rows = lateTasks.map(t => `
      <tr>
        <td style="${TD}">${escapeHtml(t.name)}</td>
        <td style="${TD} text-align: center;">${priorityBadge(t.priority)}</td>
        <td style="${TD} text-align: center;">${formatDate(t.endDate || t.dueDate)}</td>
        <td style="${TD} text-align: center; color: #dc2626; font-weight: 600;">${t.daysLate}d late</td>
        <td style="${TD} text-align: center;">${pct(t.progressPercentage)}</td>
        <td style="${TD} font-size: 11px;">${escapeHtml(t.scheduleName)}</td>
      </tr>`).join('');

    body += `
      ${sectionHeading(`LATE TASKS (${lateTasks.length})`)}
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr>
          <th style="${TH}">Task</th>
          <th style="${TH} text-align: center; width: 80px;">Priority</th>
          <th style="${TH} text-align: center; width: 90px;">Due Date</th>
          <th style="${TH} text-align: center; width: 80px;">Overdue</th>
          <th style="${TH} text-align: center; width: 70px;">Progress</th>
          <th style="${TH} width: 120px;">Schedule</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  if (slippingTasks.length > 0) {
    const rows = slippingTasks.map(t => `
      <tr>
        <td style="${TD}">${escapeHtml(t.name)}</td>
        <td style="${TD} text-align: center;">${priorityBadge(t.priority)}</td>
        <td style="${TD} text-align: center;">${formatDate(t.startDate)}</td>
        <td style="${TD} text-align: center;">${t.daysSinceStart}d</td>
        <td style="${TD} text-align: center;">${pct(t.progressPercentage)}</td>
        <td style="${TD} font-size: 11px;">${escapeHtml(t.scheduleName)}</td>
      </tr>`).join('');

    body += `
      ${sectionHeading(`SLIPPING TASKS (${slippingTasks.length})`)}
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 8px;">In-progress tasks with low progress (&lt;25%) after 7+ days.</p>
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr>
          <th style="${TH}">Task</th>
          <th style="${TH} text-align: center; width: 80px;">Priority</th>
          <th style="${TH} text-align: center; width: 90px;">Start Date</th>
          <th style="${TH} text-align: center; width: 80px;">Elapsed</th>
          <th style="${TH} text-align: center; width: 70px;">Progress</th>
          <th style="${TH} width: 120px;">Schedule</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  return wrapReport('LATE & SLIPPING TASKS', 'Past-due and stalled tasks', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Resource Overview Report
// ---------------------------------------------------------------------------
export interface ResourceOverviewReportData {
  projectName: string;
  resources: Array<{
    name: string;
    role: string;
    email: string;
    capacityHoursPerWeek: number;
    skills: Array<{ name: string; proficiency?: number }>;
    isActive: boolean;
    resourceGroup?: string | null;
    costRateHourly?: number | null;
  }>;
}

export function renderResourceOverviewReport(data: ResourceOverviewReportData): string {
  const { resources } = data;
  if (resources.length === 0) {
    return wrapReport('RESOURCE OVERVIEW', 'Team members and their capabilities', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No resources defined. Add resources in the Resource Management page.'));
  }

  const active = resources.filter(r => r.isActive).length;
  const summary = `${resources.length} resource${resources.length !== 1 ? 's' : ''} | ${active} active | ${resources.length - active} inactive`;

  const rows = resources.map(r => {
    const skillStr = r.skills.map(s => s.proficiency ? `${s.name} (${s.proficiency}/5)` : s.name).join(', ') || '—';
    return `
    <tr>
      <td style="${TD} font-weight: 600;">${escapeHtml(r.name)}</td>
      <td style="${TD}">${escapeHtml(r.role || '—')}</td>
      <td style="${TD} font-size: 11px;">${escapeHtml(r.email || '—')}</td>
      <td style="${TD} text-align: center;">${r.capacityHoursPerWeek}h</td>
      <td style="${TD} text-align: center;">${r.costRateHourly != null ? currency(r.costRateHourly) + '/h' : '—'}</td>
      <td style="${TD} font-size: 11px;">${escapeHtml(r.resourceGroup || '—')}</td>
      <td style="${TD} font-size: 11px;">${escapeHtml(skillStr)}</td>
    </tr>`;
  }).join('');

  const body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">${escapeHtml(summary)}</p>
    ${sectionHeading('RESOURCES')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Name</th>
        <th style="${TH} width: 100px;">Role</th>
        <th style="${TH} width: 140px;">Email</th>
        <th style="${TH} text-align: center; width: 70px;">Capacity</th>
        <th style="${TH} text-align: center; width: 80px;">Rate</th>
        <th style="${TH} width: 90px;">Group</th>
        <th style="${TH}">Skills</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return wrapReport('RESOURCE OVERVIEW', 'Team members and their capabilities', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Who Does What Report
// ---------------------------------------------------------------------------
export interface WhoDoesWhatReportData {
  projectName: string;
  resourceAssignments: Array<{
    resourceName: string;
    role: string;
    tasks: Array<{
      taskName: string;
      status: string;
      allocationPct: number;
      scheduleName: string;
    }>;
  }>;
  unassignedTaskCount: number;
}

export function renderWhoDoesWhatReport(data: WhoDoesWhatReportData): string {
  const { resourceAssignments, unassignedTaskCount } = data;
  if (resourceAssignments.length === 0) {
    return wrapReport('WHO DOES WHAT', 'Resource-to-task assignments', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No task assignments found. Assign resources to tasks in the Gantt chart or schedule.'));
  }

  const totalAssignments = resourceAssignments.reduce((sum, r) => sum + r.tasks.length, 0);
  const summary = `${resourceAssignments.length} resource${resourceAssignments.length !== 1 ? 's' : ''} with assignments | ${totalAssignments} total assignment${totalAssignments !== 1 ? 's' : ''}${unassignedTaskCount > 0 ? ` | ${unassignedTaskCount} unassigned task${unassignedTaskCount !== 1 ? 's' : ''}` : ''}`;

  let body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">${escapeHtml(summary)}</p>`;

  for (const ra of resourceAssignments) {
    const rows = ra.tasks.map(t => `
      <tr>
        <td style="${TD}">${escapeHtml(t.taskName)}</td>
        <td style="${TD} text-align: center;">${statusBadge(t.status)}</td>
        <td style="${TD} text-align: center;">${t.allocationPct}%</td>
        <td style="${TD} font-size: 11px;">${escapeHtml(t.scheduleName)}</td>
      </tr>`).join('');

    body += `
      ${sectionHeading(`${ra.resourceName} (${ra.role || 'No Role'})`)}
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr>
          <th style="${TH}">Task</th>
          <th style="${TH} text-align: center; width: 100px;">Status</th>
          <th style="${TH} text-align: center; width: 80px;">Allocation</th>
          <th style="${TH} width: 120px;">Schedule</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  return wrapReport('WHO DOES WHAT', 'Resource-to-task assignments', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Resource Availability Report
// ---------------------------------------------------------------------------
export interface ResourceAvailabilityReportData {
  projectName: string;
  resources: Array<{
    resourceName: string;
    role: string;
    averageUtilization: number;
    isOverAllocated: boolean;
    weeks: Array<{
      weekStart: string;
      allocated: number;
      capacity: number;
      utilization: number;
    }>;
  }>;
}

export function renderResourceAvailabilityReport(data: ResourceAvailabilityReportData): string {
  const { resources } = data;
  if (resources.length === 0) {
    return wrapReport('RESOURCE AVAILABILITY', 'Weekly capacity and utilization', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No workload data available. Ensure resources have assignments in this project.'));
  }

  const overAllocCount = resources.filter(r => r.isOverAllocated).length;
  const avgUtil = resources.length > 0 ? Math.round(resources.reduce((s, r) => s + r.averageUtilization, 0) / resources.length) : 0;

  const summaryRows = resources.map(r => {
    const utilColor = r.averageUtilization > 100 ? `color: #dc2626; font-weight: 700;` : r.averageUtilization > 80 ? `color: #d97706;` : '';
    return `
    <tr>
      <td style="${TD} font-weight: 600;">${escapeHtml(r.resourceName)}</td>
      <td style="${TD}">${escapeHtml(r.role || '—')}</td>
      <td style="${TD} text-align: center; ${utilColor}">${Math.round(r.averageUtilization)}%</td>
      <td style="${TD} text-align: center;">${r.isOverAllocated ? '<span style="color: #dc2626; font-weight: 700;">Yes</span>' : 'No'}</td>
    </tr>`;
  }).join('');

  const body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">Average utilization: ${avgUtil}% | ${overAllocCount} overallocated resource${overAllocCount !== 1 ? 's' : ''}</p>
    ${sectionHeading('RESOURCE UTILIZATION')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Resource</th>
        <th style="${TH} width: 120px;">Role</th>
        <th style="${TH} text-align: center; width: 100px;">Avg Utilization</th>
        <th style="${TH} text-align: center; width: 100px;">Overallocated</th>
      </tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>`;

  return wrapReport('RESOURCE AVAILABILITY', 'Weekly capacity and utilization', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Resource Cost Overview Report
// ---------------------------------------------------------------------------
export interface ResourceCostReportData {
  projectName: string;
  resources: Array<{
    resourceName: string;
    role: string;
    costRateHourly: number | null;
    totalCost: number;
    totalAllocatedHours: number;
  }>;
  totalProjectCost: number;
}

export function renderResourceCostReport(data: ResourceCostReportData): string {
  const { resources, totalProjectCost } = data;
  if (resources.length === 0) {
    return wrapReport('RESOURCE COST OVERVIEW', 'Cost rates and resource spending', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No resource cost data available. Set cost rates on resources and create assignments.'));
  }

  const rows = resources.map(r => `
    <tr>
      <td style="${TD} font-weight: 600;">${escapeHtml(r.resourceName)}</td>
      <td style="${TD}">${escapeHtml(r.role || '—')}</td>
      <td style="${TD} text-align: right;">${r.costRateHourly != null ? currency(r.costRateHourly) + '/h' : '—'}</td>
      <td style="${TD} text-align: right;">${num(r.totalAllocatedHours, 1)}h</td>
      <td style="${TD} text-align: right; font-weight: 600;">${currency(r.totalCost)}</td>
    </tr>`).join('');

  const body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">Total resource cost: <strong>${currency(totalProjectCost)}</strong></p>
    ${sectionHeading('COST BY RESOURCE')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Resource</th>
        <th style="${TH} width: 120px;">Role</th>
        <th style="${TH} text-align: right; width: 90px;">Rate</th>
        <th style="${TH} text-align: right; width: 90px;">Hours</th>
        <th style="${TH} text-align: right; width: 100px;">Total Cost</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="4" style="${TD} font-weight: 700; text-align: right;">Total</td>
        <td style="${TD} text-align: right; font-weight: 700;">${currency(totalProjectCost)}</td>
      </tr></tfoot>
    </table>`;

  return wrapReport('RESOURCE COST OVERVIEW', 'Cost rates and resource spending', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Overallocated Resources Report
// ---------------------------------------------------------------------------
export interface OverallocatedReportData {
  projectName: string;
  resources: Array<{
    resourceName: string;
    role: string;
    averageUtilization: number;
    peakUtilization: number;
    peakWeek: string;
    capacityHoursPerWeek: number;
  }>;
}

export function renderOverallocatedReport(data: OverallocatedReportData): string {
  const { resources } = data;
  if (resources.length === 0) {
    return wrapReport('OVERALLOCATED RESOURCES', 'Resources exceeding capacity', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No overallocated resources found. All resources are within their weekly capacity.'));
  }

  const rows = resources.map(r => `
    <tr>
      <td style="${TD} font-weight: 600;">${escapeHtml(r.resourceName)}</td>
      <td style="${TD}">${escapeHtml(r.role || '—')}</td>
      <td style="${TD} text-align: center;">${r.capacityHoursPerWeek}h</td>
      <td style="${TD} text-align: center; color: #dc2626; font-weight: 700;">${Math.round(r.averageUtilization)}%</td>
      <td style="${TD} text-align: center; color: #dc2626; font-weight: 700;">${Math.round(r.peakUtilization)}%</td>
      <td style="${TD} text-align: center;">${formatDate(r.peakWeek)}</td>
    </tr>`).join('');

  const body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">${resources.length} resource${resources.length !== 1 ? 's' : ''} overallocated — exceeding weekly capacity.</p>
    ${sectionHeading('OVERALLOCATED RESOURCES')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Resource</th>
        <th style="${TH} width: 120px;">Role</th>
        <th style="${TH} text-align: center; width: 80px;">Capacity</th>
        <th style="${TH} text-align: center; width: 90px;">Avg Util.</th>
        <th style="${TH} text-align: center; width: 90px;">Peak Util.</th>
        <th style="${TH} text-align: center; width: 100px;">Peak Week</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size: 11px; color: #6b7280; margin: 6px 0 0;">Consider resource leveling or redistributing assignments to reduce overallocation.</p>`;

  return wrapReport('OVERALLOCATED RESOURCES', 'Resources exceeding capacity', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Cost Overview Report
// ---------------------------------------------------------------------------
export interface CostOverviewReportData {
  projectName: string;
  budgetAllocated?: number | null;
  budgetSpent: number;
  currency: string;
  tasks: Array<{
    name: string;
    budgetAllocated?: number | null;
    actualCost?: number | null;
    status: string;
    scheduleName: string;
  }>;
}

export function renderCostOverviewReport(data: CostOverviewReportData): string {
  const { budgetAllocated, budgetSpent, tasks } = data;
  const tasksWithBudget = tasks.filter(t => (t.budgetAllocated != null && t.budgetAllocated > 0) || (t.actualCost != null && t.actualCost > 0));

  const remaining = budgetAllocated != null ? budgetAllocated - budgetSpent : null;
  const utilizationPct = budgetAllocated && budgetAllocated > 0 ? Math.round((budgetSpent / budgetAllocated) * 100) : null;

  const summaryBody = `
    ${sectionHeading('PROJECT BUDGET')}
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">Budget Allocated</td>
        <td style="${TD} width: 25%;">${budgetAllocated != null ? currency(budgetAllocated) : 'Not set'}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">Budget Spent</td>
        <td style="${TD} width: 25%;">${currency(budgetSpent)}</td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">Remaining</td>
        <td style="${TD}${remaining != null && remaining < 0 ? ' color: #dc2626; font-weight: 700;' : ''}">${remaining != null ? currency(remaining) : '—'}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">Utilization</td>
        <td style="${TD}${utilizationPct != null && utilizationPct > 100 ? ' color: #dc2626; font-weight: 700;' : ''}">${utilizationPct != null ? utilizationPct + '%' : '—'}</td>
      </tr>
    </table>`;

  let taskTable = '';
  if (tasksWithBudget.length > 0) {
    const rows = tasksWithBudget.slice(0, 200).map(t => {
      const variance = (t.budgetAllocated != null && t.actualCost != null) ? t.budgetAllocated - t.actualCost : null;
      return `
      <tr>
        <td style="${TD}">${escapeHtml(t.name)}</td>
        <td style="${TD} text-align: right;">${t.budgetAllocated != null ? currency(t.budgetAllocated) : '—'}</td>
        <td style="${TD} text-align: right;">${t.actualCost != null ? currency(t.actualCost) : '—'}</td>
        <td style="${TD} text-align: right;${variance != null && variance < 0 ? ' color: #dc2626; font-weight: 700;' : ''}">${variance != null ? currency(variance) : '—'}</td>
        <td style="${TD} text-align: center;">${statusBadge(t.status)}</td>
      </tr>`;
    }).join('');

    taskTable = `
      ${sectionHeading('TASK-LEVEL COSTS')}
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr>
          <th style="${TH}">Task</th>
          <th style="${TH} text-align: right; width: 100px;">Budget</th>
          <th style="${TH} text-align: right; width: 100px;">Actual</th>
          <th style="${TH} text-align: right; width: 100px;">Variance</th>
          <th style="${TH} text-align: center; width: 100px;">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } else {
    taskTable = emptyState('No tasks have budget or cost data assigned.');
  }

  return wrapReport('COST OVERVIEW', `Project budget vs actual spend (${data.currency})`, data.projectName, new Date().toLocaleDateString('en-US'), summaryBody + taskTable);
}

// ---------------------------------------------------------------------------
// Earned Value Summary Report
// ---------------------------------------------------------------------------
export interface EarnedValueReportData {
  projectName: string;
  metrics: {
    BAC: number;
    EV: number;
    AC: number;
    PV: number;
    CPI: number;
    SPI: number;
    EAC: number;
    ETC: number;
    VAC: number;
    TCPI: number;
  };
  earlyWarnings: Array<{
    type: string;
    message: string;
    severity: string;
  }>;
  forecasts: {
    eacCumulative: number;
    eacComposite: number;
    eacManagement: number;
  };
}

export function renderEarnedValueReport(data: EarnedValueReportData): string {
  const { metrics, earlyWarnings, forecasts } = data;

  const cpiColor = metrics.CPI < 1 ? 'color: #dc2626; font-weight: 700;' : metrics.CPI > 1 ? 'color: #16a34a; font-weight: 700;' : '';
  const spiColor = metrics.SPI < 1 ? 'color: #dc2626; font-weight: 700;' : metrics.SPI > 1 ? 'color: #16a34a; font-weight: 700;' : '';

  const metricsTable = `
    ${sectionHeading('KEY METRICS')}
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">BAC (Budget at Completion)</td>
        <td style="${TD} width: 25%;">${currency(metrics.BAC)}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">EV (Earned Value)</td>
        <td style="${TD} width: 25%;">${currency(metrics.EV)}</td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">AC (Actual Cost)</td>
        <td style="${TD}">${currency(metrics.AC)}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">PV (Planned Value)</td>
        <td style="${TD}">${currency(metrics.PV)}</td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">CPI (Cost Performance)</td>
        <td style="${TD} ${cpiColor}">${num(metrics.CPI)}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">SPI (Schedule Performance)</td>
        <td style="${TD} ${spiColor}">${num(metrics.SPI)}</td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">EAC (Estimate at Completion)</td>
        <td style="${TD}">${currency(metrics.EAC)}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">ETC (Estimate to Complete)</td>
        <td style="${TD}">${currency(metrics.ETC)}</td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">VAC (Variance at Completion)</td>
        <td style="${TD}${metrics.VAC < 0 ? ' color: #dc2626; font-weight: 700;' : ''}">${currency(metrics.VAC)}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">TCPI</td>
        <td style="${TD}">${num(metrics.TCPI)}</td>
      </tr>
    </table>`;

  const forecastTable = `
    ${sectionHeading('FORECAST COMPARISON')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Method</th>
        <th style="${TH} text-align: right; width: 120px;">EAC Estimate</th>
        <th style="${TH} text-align: right; width: 120px;">Variance from BAC</th>
      </tr></thead>
      <tbody>
        <tr>
          <td style="${TD}">Cumulative CPI</td>
          <td style="${TD} text-align: right;">${currency(forecasts.eacCumulative)}</td>
          <td style="${TD} text-align: right;${forecasts.eacCumulative > metrics.BAC ? ' color: #dc2626;' : ''}">${currency(forecasts.eacCumulative - metrics.BAC)}</td>
        </tr>
        <tr>
          <td style="${TD}">Composite (CPI x SPI)</td>
          <td style="${TD} text-align: right;">${currency(forecasts.eacComposite)}</td>
          <td style="${TD} text-align: right;${forecasts.eacComposite > metrics.BAC ? ' color: #dc2626;' : ''}">${currency(forecasts.eacComposite - metrics.BAC)}</td>
        </tr>
        <tr>
          <td style="${TD}">Management Estimate</td>
          <td style="${TD} text-align: right;">${currency(forecasts.eacManagement)}</td>
          <td style="${TD} text-align: right;${forecasts.eacManagement > metrics.BAC ? ' color: #dc2626;' : ''}">${currency(forecasts.eacManagement - metrics.BAC)}</td>
        </tr>
      </tbody>
    </table>`;

  let warningsHtml = '';
  if (earlyWarnings.length > 0) {
    const sevColors: Record<string, string> = { critical: RED_BG, warning: AMBER_BG, info: '#DBEAFE' };
    const rows = earlyWarnings.map(w => `
      <tr>
        <td style="${TD} text-align: center; width: 80px;"><span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; background: ${sevColors[w.severity] || '#F3F4F6'};">${escapeHtml(w.severity)}</span></td>
        <td style="${TD}">${escapeHtml(w.message)}</td>
      </tr>`).join('');

    warningsHtml = `
      ${sectionHeading('EARLY WARNINGS')}
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr>
          <th style="${TH} text-align: center; width: 80px;">Severity</th>
          <th style="${TH}">Warning</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  return wrapReport('EARNED VALUE SUMMARY', 'EVM metrics, forecasts, and early warnings', data.projectName, new Date().toLocaleDateString('en-US'), metricsTable + forecastTable + warningsHtml);
}

// ---------------------------------------------------------------------------
// Resource Status Report (dashboard-style)
// ---------------------------------------------------------------------------
export interface ResourceStatusReportData {
  projectName: string;
  totalResources: number;
  activeResources: number;
  inactiveResources: number;
  byRole: Array<{ role: string; count: number }>;
  byGroup: Array<{ group: string; count: number }>;
  utilizationBuckets: Array<{ label: string; count: number }>;
  averageUtilization: number;
  overallocatedCount: number;
  totalCapacityHours: number;
}

export function renderResourceStatusReport(data: ResourceStatusReportData): string {
  const {
    totalResources, activeResources, inactiveResources,
    byRole, byGroup, utilizationBuckets,
    averageUtilization, overallocatedCount, totalCapacityHours,
  } = data;

  if (totalResources === 0) {
    return wrapReport('RESOURCE STATUS', 'Resource dashboard overview', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No resources defined. Add resources in the Resource Management page.'));
  }

  // Summary cards row
  const summaryHtml = `
    ${sectionHeading('OVERVIEW')}
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">Total Resources</td>
        <td style="${TD} width: 25%; font-weight: 700; font-size: 16px;">${totalResources}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">Active / Inactive</td>
        <td style="${TD} width: 25%;"><span style="color: #16a34a; font-weight: 700;">${activeResources}</span> / <span style="color: #6b7280;">${inactiveResources}</span></td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">Avg Utilization</td>
        <td style="${TD} font-weight: 700;">${Math.round(averageUtilization)}%</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">Overallocated</td>
        <td style="${TD}${overallocatedCount > 0 ? ' color: #dc2626; font-weight: 700;' : ''}">${overallocatedCount}</td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">Total Weekly Capacity</td>
        <td style="${TD}">${num(totalCapacityHours, 0)}h</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">&nbsp;</td>
        <td style="${TD}">&nbsp;</td>
      </tr>
    </table>`;

  // By Role
  const roleRows = byRole.map(r => `
    <tr>
      <td style="${TD}">${escapeHtml(r.role || 'Unassigned')}</td>
      <td style="${TD} text-align: center; font-weight: 600;">${r.count}</td>
      <td style="${TD}"><div style="background: ${NAVY}; height: 14px; border-radius: 3px; width: ${totalResources > 0 ? Math.round((r.count / totalResources) * 100) : 0}%;"></div></td>
    </tr>`).join('');

  const roleHtml = `
    ${sectionHeading('BY ROLE')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH} width: 40%;">Role</th>
        <th style="${TH} text-align: center; width: 60px;">Count</th>
        <th style="${TH}">Distribution</th>
      </tr></thead>
      <tbody>${roleRows}</tbody>
    </table>`;

  // By Group
  let groupHtml = '';
  if (byGroup.length > 0) {
    const groupRows = byGroup.map(g => `
      <tr>
        <td style="${TD}">${escapeHtml(g.group || 'Ungrouped')}</td>
        <td style="${TD} text-align: center; font-weight: 600;">${g.count}</td>
      </tr>`).join('');

    groupHtml = `
      ${sectionHeading('BY GROUP')}
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr>
          <th style="${TH}">Group</th>
          <th style="${TH} text-align: center; width: 80px;">Count</th>
        </tr></thead>
        <tbody>${groupRows}</tbody>
      </table>`;
  }

  // Utilization distribution
  let utilHtml = '';
  if (utilizationBuckets.length > 0) {
    const bucketColors: Record<string, string> = {
      'Idle (0%)': '#F3F4F6',
      'Low (1-50%)': '#DBEAFE',
      'Medium (51-80%)': GREEN_BG,
      'High (81-100%)': AMBER_BG,
      'Overallocated (>100%)': RED_BG,
    };
    const bucketRows = utilizationBuckets.map(b => `
      <tr>
        <td style="${TD}"><span style="display: inline-block; width: 12px; height: 12px; border-radius: 2px; background: ${bucketColors[b.label] || '#F3F4F6'}; vertical-align: middle; margin-right: 6px;"></span>${escapeHtml(b.label)}</td>
        <td style="${TD} text-align: center; font-weight: 600;">${b.count}</td>
      </tr>`).join('');

    utilHtml = `
      ${sectionHeading('UTILIZATION DISTRIBUTION')}
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr>
          <th style="${TH}">Utilization Range</th>
          <th style="${TH} text-align: center; width: 80px;">Resources</th>
        </tr></thead>
        <tbody>${bucketRows}</tbody>
      </table>`;
  }

  return wrapReport('RESOURCE STATUS', 'Resource dashboard overview', data.projectName, new Date().toLocaleDateString('en-US'), summaryHtml + roleHtml + groupHtml + utilHtml);
}

// ---------------------------------------------------------------------------
// Who Does What When Report (time-phased)
// ---------------------------------------------------------------------------
export interface WhoDoesWhatWhenReportData {
  projectName: string;
  resources: Array<{
    resourceName: string;
    role: string;
    weeks: Array<{
      weekStart: string;
      tasks: Array<{ taskName: string; hours: number }>;
      totalHours: number;
      capacity: number;
    }>;
  }>;
}

export function renderWhoDoesWhatWhenReport(data: WhoDoesWhatWhenReportData): string {
  const { resources } = data;
  if (resources.length === 0) {
    return wrapReport('WHO DOES WHAT WHEN', 'Time-phased resource assignments', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No resource assignments found. Assign resources to tasks to populate this report.'));
  }

  let body = `
    ${sectionHeading('SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; margin: 0 0 16px;">${resources.length} resource${resources.length !== 1 ? 's' : ''} with weekly assignment data.</p>`;

  for (const r of resources) {
    if (r.weeks.length === 0) continue;

    // Build weekly table for this resource
    const weekHeaders = r.weeks.map(w => {
      const d = new Date(w.weekStart);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<th style="${TH} text-align: center; width: 70px; font-size: 10px;">${escapeHtml(label)}</th>`;
    }).join('');

    // Collect all unique tasks across all weeks
    const allTaskNames = new Set<string>();
    for (const w of r.weeks) {
      for (const t of w.tasks) allTaskNames.add(t.taskName);
    }

    const taskRows = Array.from(allTaskNames).slice(0, 50).map(taskName => {
      const cells = r.weeks.map(w => {
        const entry = w.tasks.find(t => t.taskName === taskName);
        const hours = entry ? entry.hours : 0;
        return `<td style="${TD} text-align: center; font-size: 11px;${hours > 0 ? '' : ' color: #d1d5db;'}">${hours > 0 ? num(hours, 1) + 'h' : '—'}</td>`;
      }).join('');
      return `<tr><td style="${TD} font-size: 11px;">${escapeHtml(taskName)}</td>${cells}</tr>`;
    }).join('');

    // Totals row
    const totalCells = r.weeks.map(w => {
      const overCap = w.totalHours > w.capacity;
      return `<td style="${TD} text-align: center; font-weight: 700; font-size: 11px;${overCap ? ' color: #dc2626;' : ''}">${num(w.totalHours, 1)}h</td>`;
    }).join('');

    const capacityCells = r.weeks.map(w =>
      `<td style="${TD} text-align: center; font-size: 10px; color: #6b7280;">${num(w.capacity, 0)}h</td>`
    ).join('');

    body += `
      ${sectionHeading(`${r.resourceName} (${r.role || 'No Role'})`)}
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead><tr>
            <th style="${TH}">Task</th>
            ${weekHeaders}
          </tr></thead>
          <tbody>
            ${taskRows}
            <tr style="border-top: 2px solid ${NAVY};">
              <td style="${TD} font-weight: 700;">Total</td>
              ${totalCells}
            </tr>
            <tr>
              <td style="${TD} font-size: 10px; color: #6b7280;">Capacity</td>
              ${capacityCells}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  return wrapReport('WHO DOES WHAT WHEN', 'Time-phased resource assignments', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

// ---------------------------------------------------------------------------
// Overbudget Resources Report
// ---------------------------------------------------------------------------
export interface OverbudgetResourcesReportData {
  projectName: string;
  resources: Array<{
    resourceName: string;
    role: string;
    costRateHourly: number | null;
    plannedHours: number;
    actualHours: number;
    plannedCost: number;
    actualCost: number;
    variance: number;
    variancePct: number;
  }>;
  totalPlannedCost: number;
  totalActualCost: number;
  totalVariance: number;
}

export function renderOverbudgetResourcesReport(data: OverbudgetResourcesReportData): string {
  const { resources, totalPlannedCost, totalActualCost, totalVariance } = data;
  if (resources.length === 0) {
    return wrapReport('OVERBUDGET RESOURCES', 'Resources exceeding planned cost', data.projectName, new Date().toLocaleDateString('en-US'), emptyState('No overbudget resources found. All resources are within their planned cost, or no cost data is available.'));
  }

  const rows = resources.map(r => `
    <tr>
      <td style="${TD} font-weight: 600;">${escapeHtml(r.resourceName)}</td>
      <td style="${TD}">${escapeHtml(r.role || '—')}</td>
      <td style="${TD} text-align: right;">${r.costRateHourly != null ? currency(r.costRateHourly) + '/h' : '—'}</td>
      <td style="${TD} text-align: right;">${num(r.plannedHours, 1)}h</td>
      <td style="${TD} text-align: right;">${num(r.actualHours, 1)}h</td>
      <td style="${TD} text-align: right;">${currency(r.plannedCost)}</td>
      <td style="${TD} text-align: right;">${currency(r.actualCost)}</td>
      <td style="${TD} text-align: right; color: #dc2626; font-weight: 700;">${currency(r.variance)} (${Math.round(r.variancePct)}%)</td>
    </tr>`).join('');

  const body = `
    ${sectionHeading('SUMMARY')}
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">Overbudget Resources</td>
        <td style="${TD} width: 25%; color: #dc2626; font-weight: 700;">${resources.length}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 25%;">Total Overrun</td>
        <td style="${TD} width: 25%; color: #dc2626; font-weight: 700;">${currency(totalVariance)}</td>
      </tr>
      <tr>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">Total Planned Cost</td>
        <td style="${TD}">${currency(totalPlannedCost)}</td>
        <td style="${TD} background: ${LABEL_BG}; font-weight: 600;">Total Actual Cost</td>
        <td style="${TD}">${currency(totalActualCost)}</td>
      </tr>
    </table>
    ${sectionHeading('OVERBUDGET RESOURCES')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr>
        <th style="${TH}">Resource</th>
        <th style="${TH} width: 80px;">Role</th>
        <th style="${TH} text-align: right; width: 70px;">Rate</th>
        <th style="${TH} text-align: right; width: 70px;">Planned h</th>
        <th style="${TH} text-align: right; width: 70px;">Actual h</th>
        <th style="${TH} text-align: right; width: 80px;">Planned $</th>
        <th style="${TH} text-align: right; width: 80px;">Actual $</th>
        <th style="${TH} text-align: right; width: 100px;">Overrun</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size: 11px; color: #6b7280; margin: 6px 0 0;">Resources where actual cost exceeds planned cost based on allocated hours and cost rates.</p>`;

  return wrapReport('OVERBUDGET RESOURCES', 'Resources exceeding planned cost', data.projectName, new Date().toLocaleDateString('en-US'), body);
}

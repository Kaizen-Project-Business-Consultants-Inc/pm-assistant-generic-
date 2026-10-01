import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Read guard (Sep 2026). Rule: inside an organisation a person reads only the projects they
 * created, are a member of, or the sample project (admin/PMO/executive: all). Every GET route
 * must carry a project/owner check, or be listed in READ_OK with the reason it isn't project
 * data (or already filters to the caller's projects inside). A new GET that is neither fails the
 * build. Companion to routePermissionGuard.test.ts (writes).
 */
const READ_GATES = [
  'requireProjectAccess', 'viewerWriteBypass', 'checkEntityProjectAccess', 'requireCRProjectAccess', 'checkProjectRole',
  'raidItemGate', 'requireRole(', 'requireAdmin', 'requireSuperAdmin', "requireScope('admin')",
  'sprintMember', 'listMember', 'itemMember', 'analysisMember', 'readByEntity', 'readById', 'proposalMember', 'taskMember',
  'connectorInProject', 'contextScopeGate', 'orgAdminOnly', 'resourceManagerOnly', 'readableProjectIds', 'findAccessible',
  'findByUserId', 'requireWorkflowPM', 'requireCRPM', 'checklistTaskMember', 'bulkTasksMember', 'workflowReader',
  'executionReader', 'executionListReader', 'requestMember', 'adminOrPmo', 'contextScopeReadGate', 'queryProjectMember',
  'historyAdmin', 'canSeeSchedule', 'integrationOwner', 'apiKeyService.listKeys', 'teamsListPM',
  'scheduleQueryPM',
];

/** GETs that are fine without a gate token, grouped by why */
const READ_OK: Record<string, string[]> = {
  // Admin / platform screens (checked by role inside the handler or by the admin plugin)
  'admin/auditTrail.ts': ['/verify'],
  'admin/deadLetter.ts': ['/', '/failed'],
  'admin/logs.ts': ['/', '/files', '/download/:filename'],
  'admin/metrics.ts': ['/'],
  'admin/waitlist.ts': ['/count'],
  'reporting/reportSchedules.ts': ['/', '/admin/all'], // your own schedules; admin/all checks role
  // Agent configuration and health (organisation settings, no project data)
  'agent/agent.ts': ['/registry', '/registry/:id'],
  'agent/agentHealth.ts': ['/health', '/costs'],
  'agent/autonomy.ts': ['/', '/:agentId/eligibility'],
  'agent/killSwitch.ts': ['/kill-switch'],
  'agent/policies.ts': ['/', '/:id', '/evaluations/stats'],
  'ai/aiBudget.ts': ['/'],
  'ai/learning.ts': ['/accuracy-report', '/feedback-stats', '/insights'],
  'ai/rag.ts': ['/status'],
  'ai/skills.ts': ['/', '/:id'],
  // Already limited to the caller inside (user id / member join / readable projects)
  'agent/alerts.ts': ['/', '/summary'],
  'ai/aiChat.ts': ['/conversations', '/conversations/:id'],
  'ai/aiReports.ts': ['/:id', '/history'],
  'ai/intelligence.ts': ['/anomalies', '/cross-project'],
  'ai/narratives.ts': ['/portfolio'],
  'ai/predictions.ts': ['/dashboard'],
  'collaboration/meetingActionItems.ts': ['/my'],
  'core/search.ts': ['/'],
  'reporting/analyticsSummary.ts': ['/summary'],
  'reporting/briefing.ts': ['/daily'],
  'reporting/dashboardData.ts': ['/overdue-tasks', '/issues-trend', '/milestones', '/cr-summary'],
  'resources/timeEntries.ts': ['/timesheet', '/submissions', '/pending-approvals', '/timesheet-status'],
  'integrations/integrations.ts': ['/'],
  'integrations/teamsMeetings.ts': ['/status', '/install', '/admin-approval-url'], // your own Microsoft connection, no project data
  'integrations/webhooks.ts': ['/', '/:id/deliveries'],
  'core/feedback.ts': ['/mine', '/:id/screenshot'],
  // Shared across the organisation by design
  'collaboration/lessonsLearned.ts': ['/', '/knowledge-base', '/report', '/relevant'], // user decision 2026-09-28
  'collaboration/templates.ts': ['/', '/:id', '/marketplace'],
  'collaboration/intakeForms.ts': ['/forms', '/forms/:id', '/submissions', '/submissions/:id'], // requests for new projects
  'goals.ts': ['/', '/:id'],
  'core/projectGroups.ts': ['/'],
  'reporting/reportBuilder.ts': ['/templates', '/templates/:id'], // report layouts; data is filtered when generated
  // The resource pool: hours and capacity only (other projects' names/costs are hidden in the handlers)
  'resources/resources.ts': ['/', '/skills', '/by-skill', '/:id/delete-impact', '/:id/utilization-history', '/capacity-by-role'],
  'resources/rateCard.ts': ['/'], // company rate card, not project data; rate-card managers only
  'resources/availability.ts': ['/:resourceId/availability'],
  'resources/calendarTemplates.ts': ['/', '/:id'],
  // Your own account, sign-in, pricing, OAuth callbacks, public portal (token)
  'core/auth.ts': ['/verify-login', '/turnstile'],
  'core/invites.ts': ['/:token/validate'],
  'core/notifications.ts': ['/', '/unread-count', '/push/vapid-key'],
  'core/pricing.ts': ['/'],
  'core/users.ts': ['/me', '/me/accessibility', '/me/dashboard-preferences', '/me/view-preferences'],
  'core/websocket.ts': ['/'],
  'collaboration/portal.ts': ['/view/:token'],
  'integrations/calendar.ts': ['/callback', '/connect', '/calendars'],
  'integrations/slack.ts': ['/install', '/callback', '/channels'],
  'integrations/teams.ts': ['/install', '/callback', '/teams', '/channels'],
  'integrations/stripe.ts': ['/topup-balance', '/subscription-status', '/config'],
  'integrations/storageConnectors.ts': ['/storage-connectors/${provider}/callback'],
};

/** Reads sent as POSTs: each must check the project it reads */
const READ_POSTS: Array<[string, string, string]> = [
  ['resources/resources.ts', '/load-check', 'readableProjectIds'],
  ['ai/nlQuery.ts', '/', 'checkProjectRole'],
  ['ai/rag.ts', '/search', 'readableFor'],
  ['ai/aiChat.ts', '/message', 'chatContextMember'],
  ['ai/aiChat.ts', '/stream', 'chatContextMember'],
  ['ai/aiReports.ts', '/generate', 'requireProjectAccess'],
  ['reporting/instantReports.ts', '/generate', 'requireProjectAccess'],
  ['reporting/strategicRiskScan.ts', '/scan', 'requireProjectAccess'],
  ['scheduling/monteCarlo.ts', '/:scheduleId/simulate', 'requireProjectAccess'],
  ['ai/aiScheduling.ts', '/analyze-project', 'checkProjectRole'],
  ['ai/aiScheduling.ts', '/optimize-schedule', 'requireProjectAccess'],
  ['ai/aiTaskEstimation.ts', '/', 'requireProjectAccess'],
  ['reporting/reportBuilder.ts', '/templates/:id/generate', 'readableProjectIds'],
  ['reporting/reportBuilder.ts', '/templates/:id/export', 'readableProjectIds'],
];

const ROUTES = join(__dirname, '..', '..', 'routes');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : n.endsWith('.ts') ? [p] : [];
  });
}
function routeBody(s: string, index: number, headLen: number): string {
  const next = s.indexOf('fastify.', index + headLen);
  return s.slice(index, next > 0 ? next : s.length).slice(0, 6000);
}

function ungatedReads(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of files(ROUTES)) {
    const rel = relative(ROUTES, f).split(sep).join('/');
    if (rel === 'scheduling/calendars.ts') continue; // file-level hook gates every route
    const s = readFileSync(f, 'utf-8');
    const re = /fastify\.get\(\s*['`]([^'`]+)['`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (READ_GATES.some(g => routeBody(s, m!.index, m![0].length).includes(g))) continue;
      (out[rel] ??= []).push(m[1]);
    }
  }
  return out;
}

describe('every project read route checks the project', () => {
  it('no new ungated GET routes', () => {
    const unexpected: string[] = [];
    for (const [file, routes] of Object.entries(ungatedReads())) {
      const ok = new Set(READ_OK[file] ?? []);
      for (const r of routes) if (!ok.has(r)) unexpected.push(`${file}: GET ${r}`);
    }
    expect(unexpected, 'Add a project check, or list the route in READ_OK with the reason').toEqual([]);
  });

  it('reads sent as POSTs check the project they read', () => {
    const missing: string[] = [];
    for (const [file, route, gate] of READ_POSTS) {
      const s = readFileSync(join(ROUTES, file), 'utf-8');
      const m = new RegExp(`fastify\\.post\\(\\s*'${route.replace(/[/:.]/g, c => `\\${c}`)}'`).exec(s);
      if (!m) { missing.push(`${file}: POST ${route} not found`); continue; }
      const body = routeBody(s, m.index, m[0].length);
      const above = s.slice(0, m.index);
      if (!body.includes(gate) && !above.includes(`const ${gate}`) && !above.includes(`function ${gate}`)) missing.push(`${file}: POST ${route} (${gate})`);
      else if (!body.includes(gate)) missing.push(`${file}: POST ${route} (${gate} defined but not used)`);
    }
    expect(missing).toEqual([]);
  });

  it("'?scope=portfolio' never widens what a non-admin sees", () => {
    const offenders = files(ROUTES).concat(join(ROUTES, '..', 'services', 'DailyBriefingService.ts'))
      .filter(f => /\|\|\s*scope\s*===\s*'portfolio'/.test(readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('Mjuzi never lists every project in the organisation for a user', () => {
    const src = readFileSync(join(ROUTES, '..', 'services', 'aiActionExecutor.ts'), 'utf-8');
    expect(src).not.toContain('projectService.findAll()');
  });
});

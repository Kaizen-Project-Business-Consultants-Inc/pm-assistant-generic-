import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Permission guard (Sep 2026). Rule: only a project's Manager/Owner (or admin/PMO) may change
 * project data. Every write route (POST/PUT/PATCH/DELETE) must either carry a project check
 * (requireProjectAccess / a resolver built on it / checkProjectRole / an in-handler
 * checkEntityProjectAccess / an admin role check), or be listed below:
 *  - NON_PROJECT: not project data (sign-in, your own profile, billing, org admin, global
 *    templates, read-only analysis that happens to be a POST)
 *  - NON_PROJECT also covers: your own chat conversations, creating a new project, AI memory
 *    ("dreaming"), knowledge-base usage (lessons search/feedback), the public portal comment
 *    (token-scoped), personal calendar sync, formatting a report you already hold, and the
 *    organisation's resource pool.
 *  - PHASE_2: empty — both phases are done. A route here would be project data not yet gated.
 * The AI chat and alert "execute" routes are gated inside AIActionExecutor.checkProjectWrite;
 * they carry a `checkProjectRoleFor` comment just above the route, which this test accepts.
 * A new write route that is neither gated nor listed fails the build.
 */
const GATES = ["requireProjectAccess", "viewerWriteBypass", "bodySchedule", "bodyUpdateSchedules", "proposalPM", "requireWorkflowPM", "requireCRPM", "projectAndSchedule", "checkEntityProjectAccess", "requireCRProjectAccess", "checkProjectRole", "raidItemGate", "requireRole(", "requireAdmin", "requireSuperAdmin", "sprintPM", "sprintMember", "sprintAndSchedulePM", "checklistTaskPM", "checklistPM", "createPM", "actionItemGate", "analyzePM", "analysisPM", "analysisMember", "sendToRaidPM", "attachmentGate", "linkPM", "lessonPM", "orgAdminOnly", "bodyProjectPM", "workflowPM", "executionPM", "bodyTaskPM", "assignmentPM", "requestPM", "resourceManagerOnly", "connectorInProject", "taskMember", "extractPM", "proposalPMGate", "proposalMember", "scenarioPM", "contextScopeGate"];
const NON_PROJECT: Record<string, string[]> = {
  "admin/waitlist.ts": [
    "POST /"
  ],
  "agent/agent.ts": [
    "PATCH /registry/:id"
  ],
  "agent/autonomy.ts": [
    "PUT /:agentId"
  ],
  "agent/killSwitch.ts": [
    "POST /kill-switch",
    "PUT /kill-switch/agent/:agentId",
    "PUT /kill-switch/project/:projectId"
  ],
  "agent/memory.ts": [
    "POST /",
    "DELETE /"
  ],
  "agent/policies.ts": [
    "POST /",
    "PUT /:id",
    "DELETE /:id"
  ],
  "ai/accessibility.ts": [
    "POST /simplify",
    "POST /reading-level"
  ],
  "ai/aiReports.ts": [
    "POST /generate",
    "DELETE /:id"
  ],
  "ai/aiScheduling.ts": [
    "POST /analyze-project",
    "POST /suggest-dependencies",
    "POST /optimize-schedule"
  ],
  "ai/aiTaskEstimation.ts": [
    "POST /"
  ],
  "ai/learning.ts": [
    "POST /feedback",
    "POST /accuracy"
  ],
  "ai/nlQuery.ts": [
    "POST /"
  ],
  "ai/predictions.ts": [
    "POST /health/snapshot"
  ],
  "ai/rag.ts": [
    "POST /search"
  ],
  "ai/skills.ts": [
    "POST /",
    "PUT /:id"
  ],
  "ai/versionedMemory.ts": [
    "PUT /:id",
    "DELETE /:id",
    "POST /:id/rollback"
  ],
  "collaboration/intakeForms.ts": [
    "POST /forms",
    "PUT /forms/:id",
    "DELETE /forms/:id",
    "POST /forms/:id/submit",
    "POST /submissions/:id/review",
    "POST /submissions/:id/convert"
  ],
  "collaboration/templates.ts": [
    "POST /",
    "PUT /:id",
    "DELETE /:id",
    "POST /apply",
    "POST /save-from-project",
    "POST /:id/publish",
    "POST /marketplace/:id/import"
  ],
  "core/auth.ts": [
    "POST /login",
    "POST /register",
    "POST /resend-verification",
    "POST /forgot-password",
    "POST /reset-password",
    "POST /logout",
    "POST /refresh",
    "POST /change-password",
    "DELETE /delete-account"
  ],
  "core/feedback.ts": [
    "POST /",
    "PATCH /:id"
  ],
  "core/invites.ts": [
    "POST /",
    "POST /accept",
    "POST /:id/resend",
    "DELETE /:id"
  ],
  "core/notifications.ts": [
    "POST /:id/read",
    "POST /mark-all-read",
    "POST /push/subscribe",
    "DELETE /push/subscribe"
  ],
  "core/org.ts": [
    "POST /invite",
    "PATCH /members/:memberId",
    "POST /invite-guest",
    "PATCH /guests/:guestId",
    "DELETE /guests/:guestId",
    "DELETE /members/:memberId"
  ],
  "core/projectGroups.ts": [
    "POST /",
    "PUT /reorder",
    "PUT /unassign",
    "PUT /:id",
    "DELETE /:id",
    "PUT /:id/assign"
  ],
  "core/projects.ts": [
    "POST /",
    "POST /:id/favourite",
    "DELETE /:id/favourite"
  ],
  "core/seats.ts": [
    "POST /add",
    "POST /remove"
  ],
  "core/users.ts": [
    "PUT /me/profile",
    "PUT /me/notification-preferences",
    "PUT /me/preferences",
    "PUT /me/accessibility",
    "PUT /me/dashboard-preferences",
    "PUT /me/view-preferences"
  ],
  "goals.ts": [
    "POST /",
    "PUT /:id",
    "DELETE /:id"
  ],
  "integrations/apiKeys.ts": [
    "POST /",
    "DELETE /:id"
  ],
  "integrations/integrations.ts": [
    "POST /",
    "PUT /:id",
    "DELETE /:id",
    "POST /:id/test",
    "POST /:id/sync"
  ],
  "integrations/slack.ts": [
    "POST /commands",
    "POST /interactivity",
    "POST /send",
    "POST /test"
  ],
  "integrations/stripe.ts": [
    "POST /webhook",
    "POST /create-checkout-session",
    "POST /create-topup-session",
    "POST /create-portal-session",
    "POST /reconcile"
  ],
  "integrations/webhooks.ts": [
    "POST /",
    "PUT /:id",
    "DELETE /:id",
    "POST /:id/test"
  ],
  "reporting/instantReports.ts": [
    "POST /generate"
  ],
  "reporting/reportBuilder.ts": [
    "POST /templates",
    "PUT /templates/:id",
    "DELETE /templates/:id",
    "POST /templates/:id/generate",
    "POST /templates/:id/export"
  ],
  "reporting/reportSchedules.ts": [
    "POST /",
    "POST /:id/run-now",
    "PUT /:id",
    "DELETE /:id"
  ],
  "reporting/strategicRiskScan.ts": [
    "POST /scan"
  ],
  "resources/availability.ts": [
    "POST /:resourceId/availability",
    "PUT /availability/:id",
    "DELETE /availability/:id"
  ],
  "resources/calendarTemplates.ts": [
    "POST /",
    "PUT /:id",
    "DELETE /:id"
  ],
  "resources/resourceOptimizer.ts": [
    "POST /skill-match"
  ],
  "scheduling/import.ts": [
    "POST /suggest-columns"
  ],
  "scheduling/monteCarlo.ts": [
    "POST /:scheduleId/simulate"
  ],
  "ai/aiChat.ts": [
    "DELETE /conversations/:id",
    "POST /create-project"
  ],
  "ai/dreaming.ts": [
    "POST /proposals/:id/approve",
    "POST /proposals/:id/reject",
    "POST /trigger"
  ],
  "collaboration/lessonsLearned.ts": [
    "POST /:id/applied",
    "POST /:id/feedback",
    "POST /mitigations",
    "POST /patterns",
    "POST /similar"
  ],
  "collaboration/portal.ts": [
    "POST /view/:token/comment"
  ],
  "integrations/calendar.ts": [
    "DELETE /disconnect",
    "POST /settings",
    "POST /sync"
  ],
  "reporting/statusReports.ts": [
    "POST /export/docx",
    "POST /render"
  ],
  "resources/resources.ts": [
    "DELETE /:id",
    "POST /",
    "POST /bulk-delete",
    "POST /import",
    "PUT /:id"
  ]
};
// Phase 2 done (Sep 2026): every project write route is now gated. Keep this empty.
const PHASE_2: Record<string, string[]> = {};

const ROUTES = join(__dirname, '..', '..', 'routes');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : n.endsWith('.ts') ? [p] : [];
  });
}

function ungated(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of files(ROUTES)) {
    const rel = relative(ROUTES, f).split(sep).join('/');
    const s = readFileSync(f, 'utf-8');
    if (rel === 'scheduling/calendars.ts') continue; // gated for every route by a file-level hook
    const re = /fastify\.(post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const next = s.indexOf('fastify.', m.index + m[0].length);
      const body = s.slice(m.index, next > 0 ? next : s.length).slice(0, 6000);
      const above = s.slice(Math.max(0, m.index - 200), m.index);
      if (GATES.some(g => body.includes(g)) || above.includes('checkProjectRoleFor')) continue;
      (out[rel] ??= []).push(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  return out;
}

describe('every project write route has a project check', () => {
  const found = ungated();

  it('no new ungated write routes', () => {
    const unexpected: string[] = [];
    for (const [file, routes] of Object.entries(found)) {
      const allowed = new Set([...(NON_PROJECT[file] ?? []), ...(PHASE_2[file] ?? [])]);
      for (const r of routes) if (!allowed.has(r)) unexpected.push(`${file}: ${r}`);
    }
    expect(unexpected).toEqual([]);
  });

  it('Phase 2 is empty — every project area is gated', () => {
    expect(Object.keys(PHASE_2)).toEqual([]);
    for (const f of ['collaboration/sprints.ts', 'collaboration/meetingActionItems.ts', 'collaboration/meetingIntelligence.ts',
      'collaboration/fileAttachments.ts', 'collaboration/workflows.ts', 'resources/resourceRequests.ts',
      'integrations/storageConnectors.ts', 'agent/proposals.ts', 'ai/intelligence.ts', 'ai/contextConfig.ts', 'reporting/raidReports.ts']) {
      expect(found[f] ?? []).toEqual([]);
    }
  });

  it('Phase 1 areas stay gated (tasks, schedules, bulk tools, imports, RAID, change requests, calendars, members)', () => {
    for (const f of ['core/bulk.ts', 'scheduling/schedules.ts', 'scheduling/autoReschedule.ts', 'scheduling/resourceLeveling.ts',
      'scheduling/taskPrioritization.ts', 'scheduling/scheduleFix.ts', 'scheduling/changeHistory.ts', 'collaboration/risks.ts',
      'collaboration/approvalWorkflows.ts', 'core/projectMembers.ts']) {
      expect(found[f] ?? []).toEqual([]);
    }
    expect((found['scheduling/import.ts'] ?? []).filter(r => r !== 'POST /suggest-columns')).toEqual([]);
  });

  it('no route asks for the removed Editor role', () => {
    const offenders = files(ROUTES).filter(f => /requireProjectAccess\('editor'\)|, 'editor', reply\)/.test(readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });
});

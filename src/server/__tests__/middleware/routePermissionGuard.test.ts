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
 *  - PHASE_2: project data still to be gated — the user chose a two-phase rollout. Remove a
 *    route from this list when it is gated; this test then keeps it gated.
 * A new write route that is neither gated nor listed fails the build.
 */
const GATES = ["requireProjectAccess", "viewerWriteBypass", "bodySchedule", "bodyUpdateSchedules", "proposalPM", "requireWorkflowPM", "requireCRPM", "projectAndSchedule", "checkEntityProjectAccess", "requireCRProjectAccess", "checkProjectRole", "raidItemGate", "requireRole(", "requireAdmin", "requireSuperAdmin"];
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
  ]
};
const PHASE_2: Record<string, string[]> = {
  "agent/alerts.ts": [
    "POST /execute-action"
  ],
  "agent/proposals.ts": [
    "POST /:id/approve",
    "POST /:id/reject",
    "POST /:id/execute",
    "POST /:id/rollback",
    "POST /:id/feedback"
  ],
  "ai/aiChat.ts": [
    "POST /message",
    "POST /stream",
    "DELETE /conversations/:id",
    "POST /create-project",
    "POST /extract-tasks"
  ],
  "ai/contextConfig.ts": [
    "PUT /config/:scope/:scopeId",
    "POST /config/:scope/:scopeId/lock"
  ],
  "ai/dreaming.ts": [
    "POST /proposals/:id/approve",
    "POST /proposals/:id/reject",
    "POST /trigger"
  ],
  "ai/intelligence.ts": [
    "POST /scenarios",
    "DELETE /scenarios/:id"
  ],
  "collaboration/fileAttachments.ts": [
    "POST /:entityType/:entityId",
    "POST /:id/version",
    "DELETE /:id"
  ],
  "collaboration/lessonsLearned.ts": [
    "POST /extract/:projectId",
    "POST /patterns",
    "POST /mitigations",
    "POST /",
    "POST /similar",
    "POST /seed",
    "PUT /:id",
    "PATCH /:id/elevate",
    "PATCH /:id/status",
    "POST /:id/applied",
    "PATCH /:id/effectiveness",
    "POST /:id/feedback",
    "DELETE /:id"
  ],
  "collaboration/meetingActionItems.ts": [
    "POST /",
    "PUT /:id",
    "POST /:id/complete",
    "POST /:id/reopen",
    "POST /:id/cancel"
  ],
  "collaboration/meetingIntelligence.ts": [
    "POST /analyze",
    "POST /:analysisId/apply",
    "POST /upload-transcript",
    "POST /:analysisId/check-raid-duplicates",
    "POST /:analysisId/send-to-raid"
  ],
  "collaboration/portal.ts": [
    "POST /view/:token/comment",
    "PUT /links/:id",
    "DELETE /links/:id"
  ],
  "collaboration/sprints.ts": [
    "PUT /:id",
    "DELETE /:id",
    "POST /:id/tasks",
    "PATCH /:id/tasks/:taskId/points",
    "DELETE /:id/tasks/:taskId",
    "POST /:id/start",
    "POST /:id/complete",
    "POST /:id/standups",
    "PUT /:id/standups/:entryId",
    "DELETE /:id/standups/:entryId",
    "POST /:id/retro",
    "DELETE /:id/retro/:itemId",
    "POST /:id/retro/:itemId/vote",
    "DELETE /:id/retro/:itemId/vote",
    "POST /:id/retro/:itemId/convert",
    "POST /checklists/:taskId/:type",
    "PUT /checklists/:checklistId"
  ],
  "collaboration/workflows.ts": [
    "POST /generate",
    "POST /",
    "PUT /:id",
    "DELETE /:id",
    "PATCH /:id/toggle",
    "POST /:id/trigger",
    "POST /executions/:id/resume"
  ],
  "integrations/calendar.ts": [
    "POST /sync",
    "POST /link-task",
    "DELETE /unlink-task/:taskId",
    "POST /settings",
    "DELETE /disconnect"
  ],
  "integrations/storageConnectors.ts": [
    "POST /:projectId/storage-connectors/:provider/auth",
    "PUT /:projectId/storage-connectors/:id/folders",
    "POST /:projectId/storage-connectors/:id/sync",
    "PUT /:projectId/storage-connectors/:id",
    "DELETE /:projectId/storage-connectors/:id"
  ],
  "reporting/raidReports.ts": [
    "POST /generate",
    "POST /schedule",
    "DELETE /schedule/:id"
  ],
  "reporting/statusReports.ts": [
    "POST /render",
    "POST /export/docx",
    "POST /email"
  ],
  "resources/resourceRequests.ts": [
    "POST /",
    "PUT /:id",
    "POST /:id/submit",
    "POST /:id/approve",
    "POST /:id/reject",
    "POST /:id/fulfill",
    "POST /:id/cancel"
  ],
  "resources/resources.ts": [
    "POST /",
    "PUT /:id",
    "DELETE /:id",
    "POST /bulk-delete",
    "POST /assignments",
    "DELETE /assignments/:id",
    "POST /quick-assign",
    "POST /import"
  ]
};

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
      if (GATES.some(g => body.includes(g))) continue;
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

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Work (effort hours, estimatedDurationHours) typed in the Gantt grid or the Table is stored
 * (2026-10-06: the update schema didn't list it, so Zod dropped it and the edit only looked saved).
 * What a saved Work value does and doesn't do:
 * - it does NOT change money: a task's budget prices its bookings (TaskBudgetService), not Work;
 * - it DOES re-weight the summary task's % when the schedule's progressMode is 'work' (so a Work
 *   change rolls the summary up straight away);
 * - Schedule Review's R12 reads it (hours that look like days) — scheduleReviewRules.test.ts.
 * Runs the real route and ScheduleService on a mocked database.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn(async () => ['p1']) }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const queryOn = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query,
    queryOn,
    queryControlPlane: vi.fn(async () => []),
    transaction: async (fn: any) => fn('conn'),
  },
}));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: {}, restoreTaskDates: vi.fn() }));
vi.mock('../../services/FlowMetricsService', () => ({ flowMetricsService: {} }));
vi.mock('../../services/CriticalPathService', () => ({ criticalPathService: {} }));
vi.mock('../../services/BaselineService', () => ({ baselineService: {} }));
vi.mock('../../services/DagWorkflowService', () => ({ dagWorkflowService: { evaluateTaskChange: vi.fn(async () => {}) } }));
vi.mock('../../services/WebSocketService', () => ({ WebSocketService: { broadcast: vi.fn(), sendToUser: vi.fn() } }));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../services/integrations/SlackEventDispatcher', () => ({ slackEventDispatcher: { dispatchToSlack: vi.fn() } }));
vi.mock('../../services/integrations/TeamsEventDispatcher', () => ({ teamsEventDispatcher: { dispatchToTeams: vi.fn() } }));
vi.mock('../../services/RecurrenceService', () => ({ recurrenceService: {} }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: vi.fn(async () => {}) } }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn(), taskChanged: vi.fn() }));

import { z } from 'zod';
import { scheduleRoutes } from '../../routes/scheduling/schedules';
import { sendValidationError } from '../../utils/validationError';
import { scheduleService } from '../../services/ScheduleService';

describe('PUT /schedules/:id/tasks/:taskId — Work (estimatedDurationHours)', () => {
  let app: any;
  let rollup: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = Fastify();
    // As plugins.ts: a body that fails its schema is a 400 with a plain message
    app.setErrorHandler(async (err: unknown, _req: any, reply: any) => (err instanceof z.ZodError ? sendValidationError(reply, err) : reply.status(500).send({})));
    await app.register(scheduleRoutes, { prefix: '/api/v1/schedules' });
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) =>
      (id === 'build'
        ? { id, scheduleId: 's1', name: 'Build', parentTaskId: 'phase', status: 'in_progress', startDate: '2026-10-12', endDate: '2026-10-16', estimatedDurationHours: 8, createdBy: 'u1' } as any
        : null));
    vi.spyOn(scheduleService, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1', progressMode: 'work' } as any);
    vi.spyOn(scheduleService, 'progressFromHoursTaskIds').mockResolvedValue(new Set());
    rollup = vi.spyOn(scheduleService, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    queryOn.mockImplementation(async (_conn: any, sql: string) => (sql.startsWith('SELECT') ? [] : { affectedRows: 1 }));
  });

  const updates = () => queryOn.mock.calls.filter(c => String(c[1]).startsWith('UPDATE tasks SET'));

  it('is stored in estimated_duration_hours, and the summary above rolls up', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/schedules/s1/tasks/build', payload: { estimatedDurationHours: 24 } });
    expect(res.statusCode).toBe(200);
    const upd = updates();
    expect(upd).toHaveLength(1);
    expect(String(upd[0][1])).toContain('estimated_duration_hours = ?');
    expect(upd[0][2]).toEqual([24, 'build']);
    expect(rollup).toHaveBeenCalledWith('phase');
  });

  it('a negative is refused with a 400, nothing written', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/schedules/s1/tasks/build', payload: { estimatedDurationHours: -2 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).not.toMatch(/internal/i);
    expect(updates()).toHaveLength(0);
  });

  it('does not change money: no budget or cost written, and the task budget never reads Work', async () => {
    await app.inject({ method: 'PUT', url: '/api/v1/schedules/s1/tasks/build', payload: { estimatedDurationHours: 40 } });
    const sql = String(updates()[0][1]);
    expect(sql).not.toContain('budget_allocated');
    expect(sql).not.toContain('actual_cost');
    const budget = readFileSync(join(__dirname, '../../services/TaskBudgetService.ts'), 'utf8');
    expect(budget).not.toMatch(/estimatedDurationHours|estimated_duration_hours/);
  });
});

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Outdenting a task out of its summary to the top level (Gantt Shift+Tab, Table right-click
 * Outdent) sends parentTaskId: null to PUT /schedules/:id/tasks/:taskId. The update schema used
 * to accept only a string, so the move was refused with a 400 (2026-10-04). Now null clears the
 * parent, and the OLD summary rolls up (and stops being a summary when it has no tasks left).
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

import { scheduleRoutes, updateTaskSchema } from '../../routes/scheduling/schedules';
import { scheduleService } from '../../services/ScheduleService';

describe('PUT /schedules/:id/tasks/:taskId — outdent to the top level (parentTaskId: null)', () => {
  let app: any;
  let rollup: ReturnType<typeof vi.spyOn>;
  let parentNow: string | null;

  beforeAll(async () => { app = Fastify(); await app.register(scheduleRoutes, { prefix: '/api/v1/schedules' }); }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    parentNow = 'phase';
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) =>
      (id === 'design'
        ? { id, scheduleId: 's1', name: 'Design', parentTaskId: parentNow ?? undefined, status: 'pending', startDate: '2026-10-12', endDate: '2026-10-14', createdBy: 'u1' } as any
        : null));
    vi.spyOn(scheduleService, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1' } as any);
    vi.spyOn(scheduleService, 'progressFromHoursTaskIds').mockResolvedValue(new Set());
    rollup = vi.spyOn(scheduleService, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    queryOn.mockImplementation(async (_conn: any, sql: string, params: any[] = []) => {
      if (sql.startsWith('UPDATE tasks SET') && sql.includes('parent_task_id = ?')) { parentNow = params[0]; return { affectedRows: 1 }; }
      if (sql.startsWith('SELECT')) return [];
      return { affectedRows: 1 };
    });
  });

  it('the schema takes null (and still a string)', () => {
    expect(updateTaskSchema.parse({ parentTaskId: null }).parentTaskId).toBeNull();
    expect(updateTaskSchema.parse({ parentTaskId: 'phase' }).parentTaskId).toBe('phase');
    expect(updateTaskSchema.parse({ name: 'x' }).parentTaskId).toBeUndefined();
    expect(() => updateTaskSchema.parse({ parentTaskId: 5 })).toThrow();
  });

  it('clears the parent and rolls the OLD summary up', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/schedules/s1/tasks/design', payload: { parentTaskId: null } });
    expect(res.statusCode).toBe(200);
    const upd = queryOn.mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks SET') && String(c[1]).includes('parent_task_id = ?'))!;
    expect(upd).toBeTruthy();
    expect(upd[2]).toEqual([null, 'design']);
    expect(parentNow).toBeNull();
    // the old summary works its dates out again (and drops its summary flag if it has no tasks left)
    expect(rollup).toHaveBeenCalledWith('phase');
  });
});

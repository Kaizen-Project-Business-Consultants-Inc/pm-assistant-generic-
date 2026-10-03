import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * A task created with a predecessor starts after it (2026-10-01). It used to keep the project
 * start date until something else re-planned the schedule — same rule now as adding a link.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const svc = vi.hoisted(() => ({ createTask: vi.fn(), findTaskById: vi.fn(), findById: vi.fn(async () => ({ id: 's1', projectId: 'p1' })) }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: svc,
  DependencyValidationError: class extends Error {},
  GroupValidationError: class extends Error {},
}));
const recompute = vi.hoisted(() => vi.fn());
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: { recompute }, restoreTaskDates: vi.fn() }));
vi.mock('../../services/FlowMetricsService', () => ({ flowMetricsService: {} }));
vi.mock('../../services/CriticalPathService', () => ({ criticalPathService: {} }));
vi.mock('../../services/BaselineService', () => ({ baselineService: {} }));
vi.mock('../../services/DagWorkflowService', () => ({ dagWorkflowService: {} }));
vi.mock('../../services/WebSocketService', () => ({ WebSocketService: { broadcast: vi.fn() } }));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../services/integrations/SlackEventDispatcher', () => ({ slackEventDispatcher: {} }));
vi.mock('../../services/integrations/TeamsEventDispatcher', () => ({ teamsEventDispatcher: {} }));
vi.mock('../../services/RecurrenceService', () => ({ recurrenceService: {} }));
vi.mock('../../services/NotificationService', () => ({ notificationService: {} }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: {} }));

import { scheduleRoutes } from '../../routes/scheduling/schedules';

describe('creating a task with a predecessor', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(scheduleRoutes, { prefix: '/api/v1/schedules' }); }, 60_000);
  beforeEach(() => { recompute.mockReset(); svc.createTask.mockReset(); svc.findTaskById.mockReset(); });

  it('moves the new task after its predecessor and returns the moved dates', async () => {
    svc.createTask.mockResolvedValue({ id: 't-new', name: 'Security Review', startDate: '2026-10-05', dependencies: [{ dependencyId: 't-pre', dependencyType: 'FS', lagDays: 0 }] });
    recompute.mockResolvedValue({ deltas: [{ taskId: 't-new', oldStart: '2026-10-05', newStart: '2026-12-08' }] });
    svc.findTaskById.mockResolvedValue({ id: 't-new', name: 'Security Review', startDate: '2026-12-08' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/schedules/s1/tasks', payload: { name: 'Security Review', estimatedDays: 5, dependencies: [{ dependencyId: 't-pre', dependencyType: 'FS', lagDays: 0 }] } });
    expect(res.statusCode).toBe(201);
    expect(recompute).toHaveBeenCalledWith('s1', { onlyFrom: ['t-new'] });
    expect(res.json().task.startDate).toBe('2026-12-08');
  });

  it('a task with no predecessor is not re-planned', async () => {
    svc.createTask.mockResolvedValue({ id: 't-solo', name: 'Kick-off', startDate: '2026-10-05', dependencies: [] });
    const res = await app.inject({ method: 'POST', url: '/api/v1/schedules/s1/tasks', payload: { name: 'Kick-off' } });
    expect(res.statusCode).toBe(201);
    expect(recompute).not.toHaveBeenCalled();
  });
});

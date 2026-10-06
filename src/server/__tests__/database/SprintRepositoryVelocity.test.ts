/**
 * Sprint "actual velocity" (2026-10-06): the story points of a sprint's tasks completed by the
 * time it closed. Saved on close so later task changes don't rewrite history, and read back by
 * the one velocity-history query every screen (sprint list, velocity chart/sparkline, capacity
 * card, Agile EVM, retro AI, MCP get-velocity) goes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (cb: any) => cb({})),
    queryOn: vi.fn().mockResolvedValue([]),
  },
}));

import { sprintRepository } from '../../database/SprintRepository';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const sprintRow = (over: Record<string, unknown> = {}) => ({
  id: 's1', project_id: 'p1', schedule_id: 'sch1', name: 'Sprint 1', goal: null,
  start_date: '2026-09-01', end_date: '2026-09-12', status: 'completed',
  velocity_commitment: 20, velocity_actual: 13, created_by: 'u1',
  created_at: '2026-09-01', updated_at: '2026-09-12', ...over,
});

describe('SprintRepository — actual velocity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (sql: string) => (sql.trim().startsWith('UPDATE') ? [] : [sprintRow()]));
  });

  it('maps the saved figure to velocityActual (null while the sprint is open)', async () => {
    expect((await sprintRepository.findById('s1'))?.velocityActual).toBe(13);
    mockQuery.mockResolvedValueOnce([sprintRow({ status: 'active', velocity_actual: null })]);
    expect((await sprintRepository.findById('s1'))?.velocityActual).toBeNull();
    mockQuery.mockResolvedValueOnce([sprintRow({ velocity_actual: 0 })]);
    expect((await sprintRepository.findById('s1'))?.velocityActual).toBe(0); // no points ≠ unknown
  });

  describe('completeWithVelocity', () => {
    it('closes the sprint and saves ONLY completed tasks\' points of THIS sprint, in one statement', async () => {
      const sprint = await sprintRepository.completeWithVelocity('s1');
      const [sql, params] = mockQuery.mock.calls[0];
      const q = flat(sql);
      expect(q).toMatch(/^UPDATE sprints s SET s\.velocity_actual = \(/);
      // completed vs not completed: only completed tasks count
      expect(q).toContain("SUM(st.story_points)");
      expect(q).toContain("t.status = 'completed'");
      // scoped to this sprint's own tasks
      expect(q).toContain('WHERE st.sprint_id = s.id');
      // no story points at all → 0, not NULL
      expect(q).toContain('COALESCE(SUM(st.story_points), 0)');
      expect(q).toContain("s.status = 'completed'");
      expect(params).toEqual(['s1']);
      expect(sprint.velocityActual).toBe(13);
    });

    it('closing an already-closed sprint keeps the figure saved at the first close', async () => {
      await sprintRepository.completeWithVelocity('s1');
      expect(flat(mockQuery.mock.calls[0][0])).toContain("WHERE s.id = ? AND s.status <> 'completed'");
    });

    it("updateStatus('completed') also saves the velocity (no path closes a sprint without it)", async () => {
      await sprintRepository.updateStatus('s1', 'completed');
      expect(flat(mockQuery.mock.calls[0][0])).toContain('SET s.velocity_actual = (');
    });

    it('re-opening a closed sprint clears the saved figure so the next close saves a fresh one', async () => {
      await sprintRepository.updateStatus('s1', 'active');
      const [sql, params] = mockQuery.mock.calls[0];
      expect(flat(sql)).toBe('UPDATE sprints SET status = ?, velocity_actual = NULL WHERE id = ?');
      expect(params).toEqual(['active', 's1']);
    });
  });

  describe('getVelocityHistory', () => {
    it("is scoped to the project's closed sprints and prefers the saved figure over a live sum", async () => {
      mockQuery.mockResolvedValueOnce([
        { ...sprintRow(), completed_points: 13 },
        { ...sprintRow({ id: 's2', name: 'Sprint 2', velocity_commitment: null }), completed_points: 0 },
      ]);
      const history = await sprintRepository.getVelocityHistory('p1');
      const [sql, params] = mockQuery.mock.calls[0];
      const q = flat(sql);
      expect(q).toContain('WHERE s.project_id = ?');
      expect(q).toContain("s.status = 'completed'");
      expect(params).toEqual(['p1']);
      // a task reopened after the close cannot change a past sprint: the saved figure wins
      expect(q).toContain("COALESCE(s.velocity_actual, SUM(CASE WHEN t.status = 'completed' THEN st.story_points ELSE 0 END), 0)");
      expect(history).toEqual([
        { name: 'Sprint 1', velocity: 13, commitment: 20 },
        { name: 'Sprint 2', velocity: 0, commitment: 0 },
      ]);
    });
  });
});

describe('T082 migration — safe to re-run, touches only closed sprints', () => {
  const sql = readFileSync(join(__dirname, '../../database/tenant-migrations/T082_sprint_velocity_actual.sql'), 'utf-8');
  const body = flat(sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n'));

  it('adds the column idempotently', () => {
    expect(body).toContain('ALTER TABLE sprints ADD COLUMN IF NOT EXISTS velocity_actual INT NULL;');
  });

  it('backfills only closed sprints that have no saved figure, from the same points source', () => {
    expect(body).toContain("WHERE s.status = 'completed' AND s.velocity_actual IS NULL;");
    expect(body).toContain("COALESCE(SUM(st.story_points), 0)");
    expect(body).toContain("WHERE st.sprint_id = s.id AND t.status = 'completed'");
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockCalculateCriticalPath = vi.fn();
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: (...args: any[]) => mockCalculateCriticalPath(...args),
  },
}));

const mockFindTasksByScheduleId = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: (...args: any[]) => mockFindTasksByScheduleId(...args),
  },
}));

import { NetworkDiagramService, NetworkDiagramData } from '../../services/NetworkDiagramService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeCPMTask(taskId: string, opts: {
  name?: string;
  duration?: number;
  ES?: number;
  EF?: number;
  LS?: number;
  LF?: number;
  totalFloat?: number;
  freeFloat?: number;
  isCritical?: boolean;
} = {}) {
  return {
    taskId,
    name: opts.name ?? `Task ${taskId}`,
    duration: opts.duration ?? 5,
    ES: opts.ES ?? 0,
    EF: opts.EF ?? 5,
    LS: opts.LS ?? 0,
    LF: opts.LF ?? 5,
    totalFloat: opts.totalFloat ?? 0,
    freeFloat: opts.freeFloat ?? 0,
    isCritical: opts.isCritical ?? false,
  };
}

function makeTask(id: string, deps: { dependencyId: string; dependencyType?: string; lagDays?: number }[] = []) {
  return {
    id,
    scheduleId: 'sch-1',
    name: `Task ${id}`,
    status: 'pending' as const,
    priority: 'medium' as const,
    taskType: 'task' as const,
    dependencies: deps.map(d => ({
      dependencyId: d.dependencyId,
      dependencyType: d.dependencyType ?? 'FS',
      lagDays: d.lagDays ?? 0,
    })),
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('NetworkDiagramService', () => {
  let service: NetworkDiagramService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NetworkDiagramService();
  });

  // ── Empty / no-task scenarios ──────────────────────────────────────

  describe('empty diagram', () => {
    it('returns empty result when critical path has no tasks', async () => {
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: [],
        tasks: [],
        projectDuration: 0,
      });
      mockFindTasksByScheduleId.mockResolvedValue([]);

      const result = await service.getNetworkDiagram('sch-1');

      expect(result).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
    });

    it('calls criticalPathService and scheduleService with the scheduleId', async () => {
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: [],
        tasks: [],
        projectDuration: 0,
      });
      mockFindTasksByScheduleId.mockResolvedValue([]);

      await service.getNetworkDiagram('sch-42');

      expect(mockCalculateCriticalPath).toHaveBeenCalledWith('sch-42');
      expect(mockFindTasksByScheduleId).toHaveBeenCalledWith('sch-42');
    });
  });

  // ── Single task ────────────────────────────────────────────────────

  describe('single task', () => {
    it('returns one node at (0,0) with correct dimensions', async () => {
      const cpmTask = makeCPMTask('t1', { isCritical: true, ES: 0, EF: 5, LS: 0, LF: 5, duration: 5, name: 'Only Task' });
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: [cpmTask],
        projectDuration: 5,
      });
      mockFindTasksByScheduleId.mockResolvedValue([makeTask('t1')]);

      const result = await service.getNetworkDiagram('sch-1');

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);

      const node = result.nodes[0];
      expect(node.taskId).toBe('t1');
      expect(node.name).toBe('Only Task');
      expect(node.x).toBe(0);
      expect(node.y).toBe(0);
      expect(node.width).toBe(200);
      expect(node.height).toBe(80);
      expect(node.isCritical).toBe(true);
      expect(node.ES).toBe(0);
      expect(node.EF).toBe(5);
      expect(node.LS).toBe(0);
      expect(node.LF).toBe(5);
      expect(node.totalFloat).toBe(0);
      expect(node.duration).toBe(5);
    });

    it('calculates correct diagram dimensions for single node', async () => {
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: [makeCPMTask('t1', { isCritical: true })],
        projectDuration: 5,
      });
      mockFindTasksByScheduleId.mockResolvedValue([makeTask('t1')]);

      const result = await service.getNetworkDiagram('sch-1');

      // width = (maxLayer + 1) * (200 + 60) = 1 * 260 = 260
      expect(result.width).toBe(260);
      // height = maxNodesInLayer * (80 + 40) = 1 * 120 = 120
      expect(result.height).toBe(120);
    });
  });

  // ── Linear chain (A -> B -> C) ─────────────────────────────────────

  describe('linear chain', () => {
    it('assigns tasks to successive layers', async () => {
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true, ES: 0, EF: 5 }),
        makeCPMTask('b', { isCritical: true, ES: 5, EF: 10 }),
        makeCPMTask('c', { isCritical: true, ES: 10, EF: 15 }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b', 'c'],
        tasks: cpmTasks,
        projectDuration: 15,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
        makeTask('c', [{ dependencyId: 'b' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      expect(result.nodes).toHaveLength(3);

      const nodeA = result.nodes.find(n => n.taskId === 'a')!;
      const nodeB = result.nodes.find(n => n.taskId === 'b')!;
      const nodeC = result.nodes.find(n => n.taskId === 'c')!;

      // Layer 0, 1, 2 → x = 0, 260, 520
      expect(nodeA.x).toBe(0);
      expect(nodeB.x).toBe(260);
      expect(nodeC.x).toBe(520);

      // All at y=0 (one per layer)
      expect(nodeA.y).toBe(0);
      expect(nodeB.y).toBe(0);
      expect(nodeC.y).toBe(0);
    });

    it('creates edges between dependent tasks', async () => {
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true }),
        makeCPMTask('b', { isCritical: true }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      expect(result.edges).toHaveLength(1);
      const edge = result.edges[0];
      expect(edge.fromId).toBe('a');
      expect(edge.toId).toBe('b');
      expect(edge.isCritical).toBe(true);
    });

    it('calculates correct edge coordinates', async () => {
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true }),
        makeCPMTask('b', { isCritical: true }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');
      const edge = result.edges[0];

      // from: right edge of node A → x=0+200=200, y=0+80/2=40
      expect(edge.fromX).toBe(200);
      expect(edge.fromY).toBe(40);
      // to: left edge of node B → x=260, y=0+80/2=40
      expect(edge.toX).toBe(260);
      expect(edge.toY).toBe(40);
    });

    it('calculates width and height for a 3-layer chain', async () => {
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true }),
        makeCPMTask('b', { isCritical: true }),
        makeCPMTask('c', { isCritical: true }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b', 'c'],
        tasks: cpmTasks,
        projectDuration: 15,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
        makeTask('c', [{ dependencyId: 'b' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      // width = (2 + 1) * 260 = 780
      expect(result.width).toBe(780);
      // height = 1 * 120 = 120 (max 1 node per layer)
      expect(result.height).toBe(120);
    });
  });

  // ── Parallel tasks (same layer) ────────────────────────────────────

  describe('parallel tasks in the same layer', () => {
    it('stacks parallel tasks vertically within the same layer', async () => {
      // A -> B, A -> C (B and C are parallel in layer 1)
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true, ES: 0 }),
        makeCPMTask('b', { isCritical: true, ES: 5 }),
        makeCPMTask('c', { isCritical: false, ES: 5, totalFloat: 3 }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
        makeTask('c', [{ dependencyId: 'a' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      const nodeB = result.nodes.find(n => n.taskId === 'b')!;
      const nodeC = result.nodes.find(n => n.taskId === 'c')!;

      // Both in layer 1 → same x
      expect(nodeB.x).toBe(260);
      expect(nodeC.x).toBe(260);

      // Critical task (b) sorted first → y=0, non-critical (c) → y=120
      expect(nodeB.y).toBe(0);
      expect(nodeC.y).toBe(120);
    });

    it('calculates height based on max nodes per layer', async () => {
      // A -> B, A -> C, A -> D (3 nodes in layer 1)
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true, ES: 0 }),
        makeCPMTask('b', { isCritical: true, ES: 5 }),
        makeCPMTask('c', { isCritical: false, ES: 5, totalFloat: 2 }),
        makeCPMTask('d', { isCritical: false, ES: 5, totalFloat: 4 }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
        makeTask('c', [{ dependencyId: 'a' }]),
        makeTask('d', [{ dependencyId: 'a' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      // maxNodesInLayer = 3, height = 3 * 120 = 360
      expect(result.height).toBe(360);
    });
  });

  // ── Edge criticality ───────────────────────────────────────────────

  describe('edge criticality', () => {
    it('marks edge as critical only when both endpoints are on critical path', async () => {
      // A (critical) -> B (critical), A (critical) -> C (non-critical)
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true }),
        makeCPMTask('b', { isCritical: true }),
        makeCPMTask('c', { isCritical: false, totalFloat: 3 }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
        makeTask('c', [{ dependencyId: 'a' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      const edgeAB = result.edges.find(e => e.fromId === 'a' && e.toId === 'b')!;
      const edgeAC = result.edges.find(e => e.fromId === 'a' && e.toId === 'c')!;

      expect(edgeAB.isCritical).toBe(true);
      expect(edgeAC.isCritical).toBe(false);
    });

    it('marks edge as non-critical when from-node is not on critical path', async () => {
      // X (non-critical) -> Y (critical)
      const cpmTasks = [
        makeCPMTask('x', { isCritical: false, totalFloat: 5 }),
        makeCPMTask('y', { isCritical: true }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['y'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('x'),
        makeTask('y', [{ dependencyId: 'x' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      const edge = result.edges[0];
      expect(edge.isCritical).toBe(false);
    });
  });

  // ── Layer sorting ──────────────────────────────────────────────────

  describe('layer sorting', () => {
    it('sorts critical tasks before non-critical within same layer', async () => {
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true, ES: 0 }),
        makeCPMTask('nc1', { isCritical: false, ES: 5, totalFloat: 2 }),
        makeCPMTask('crit1', { isCritical: true, ES: 5 }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'crit1'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('nc1', [{ dependencyId: 'a' }]),
        makeTask('crit1', [{ dependencyId: 'a' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      const critNode = result.nodes.find(n => n.taskId === 'crit1')!;
      const ncNode = result.nodes.find(n => n.taskId === 'nc1')!;

      // Critical first → lower y
      expect(critNode.y).toBeLessThan(ncNode.y);
    });

    it('sorts by ES within same criticality', async () => {
      const cpmTasks = [
        makeCPMTask('root', { isCritical: false, ES: 0 }),
        makeCPMTask('late', { isCritical: false, ES: 10, totalFloat: 2 }),
        makeCPMTask('early', { isCritical: false, ES: 5, totalFloat: 3 }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: [],
        tasks: cpmTasks,
        projectDuration: 15,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('root'),
        makeTask('late', [{ dependencyId: 'root' }]),
        makeTask('early', [{ dependencyId: 'root' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      const earlyNode = result.nodes.find(n => n.taskId === 'early')!;
      const lateNode = result.nodes.find(n => n.taskId === 'late')!;

      // Earlier ES → lower y
      expect(earlyNode.y).toBeLessThan(lateNode.y);
    });
  });

  // ── Diamond dependency (A -> B, A -> C, B -> D, C -> D) ───────────

  describe('diamond dependency pattern', () => {
    it('handles converging dependencies correctly', async () => {
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true, ES: 0, EF: 5 }),
        makeCPMTask('b', { isCritical: true, ES: 5, EF: 10 }),
        makeCPMTask('c', { isCritical: false, ES: 5, EF: 8, totalFloat: 2 }),
        makeCPMTask('d', { isCritical: true, ES: 10, EF: 15 }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b', 'd'],
        tasks: cpmTasks,
        projectDuration: 15,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a'),
        makeTask('b', [{ dependencyId: 'a' }]),
        makeTask('c', [{ dependencyId: 'a' }]),
        makeTask('d', [{ dependencyId: 'b' }, { dependencyId: 'c' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      expect(result.nodes).toHaveLength(4);

      // D should be in layer 2 (max of layer(b)+1=2, layer(c)+1=2)
      const nodeA = result.nodes.find(n => n.taskId === 'a')!;
      const nodeD = result.nodes.find(n => n.taskId === 'd')!;
      expect(nodeA.x).toBe(0);       // layer 0
      expect(nodeD.x).toBe(520);     // layer 2

      // D should have 2 incoming edges
      const edgesToD = result.edges.filter(e => e.toId === 'd');
      expect(edgesToD).toHaveLength(2);
    });
  });

  // ── Dependencies referencing non-existent tasks ────────────────────

  describe('edge cases', () => {
    it('ignores dependencies referencing tasks not in the task list', async () => {
      const cpmTasks = [
        makeCPMTask('t1', { isCritical: true }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: cpmTasks,
        projectDuration: 5,
      });
      // Task t1 depends on 'ghost' which is not in the task list
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', [{ dependencyId: 'ghost' }]),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });

    it('handles tasks in scheduleService but not in CPM results (skipped in nodes)', async () => {
      // CPM only has t1, but scheduleService returns t1 and t2
      const cpmTasks = [
        makeCPMTask('t1', { isCritical: true }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['t1'],
        tasks: cpmTasks,
        projectDuration: 5,
      });
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1'),
        makeTask('t2'),
      ]);

      const result = await service.getNetworkDiagram('sch-1');

      // t2 has no CPM data, so it gets skipped by the `if (!cpm) continue` check
      // But t2 IS assigned a layer (layer 0, since no predecessors)
      // The node creation skips it because cpmMap.get('t2') is undefined
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].taskId).toBe('t1');
    });

    it('handles circular dependency references gracefully (visited guard)', async () => {
      // Simulate tasks that have circular dependency references
      const cpmTasks = [
        makeCPMTask('a', { isCritical: true }),
        makeCPMTask('b', { isCritical: true }),
      ];
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: ['a', 'b'],
        tasks: cpmTasks,
        projectDuration: 10,
      });
      // a depends on b, b depends on a (circular)
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('a', [{ dependencyId: 'b' }]),
        makeTask('b', [{ dependencyId: 'a' }]),
      ]);

      // Should not throw / infinite loop thanks to the visited guard
      const result = await service.getNetworkDiagram('sch-1');

      expect(result.nodes).toHaveLength(2);
    });
  });

  // ── Error propagation ─────────────────────────────────────────────

  describe('error handling', () => {
    it('propagates error when criticalPathService fails', async () => {
      mockCalculateCriticalPath.mockRejectedValue(new Error('CP failed'));
      mockFindTasksByScheduleId.mockResolvedValue([]);

      await expect(service.getNetworkDiagram('sch-1')).rejects.toThrow('CP failed');
    });

    it('propagates error when scheduleService fails', async () => {
      mockCalculateCriticalPath.mockResolvedValue({
        criticalPathTaskIds: [],
        tasks: [],
        projectDuration: 0,
      });
      mockFindTasksByScheduleId.mockRejectedValue(new Error('Schedule not found'));

      await expect(service.getNetworkDiagram('sch-1')).rejects.toThrow('Schedule not found');
    });
  });
});

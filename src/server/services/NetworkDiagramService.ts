import { criticalPathService, CriticalPathResult, CPMTaskResult } from './CriticalPathService';
import { scheduleService, Task } from './ScheduleService';

export interface NetworkNode {
  taskId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isCritical: boolean;
  ES: number;
  EF: number;
  LS: number;
  LF: number;
  totalFloat: number;
  duration: number;
}

export interface NetworkEdge {
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isCritical: boolean;
}

export interface NetworkDiagramData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  width: number;
  height: number;
}

export class NetworkDiagramService {
  async getNetworkDiagram(scheduleId: string): Promise<NetworkDiagramData> {
    const cpResult = await criticalPathService.calculateCriticalPath(scheduleId);
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);

    if (cpResult.tasks.length === 0) {
      return { nodes: [], edges: [], width: 0, height: 0 };
    }

    // Build dependency map
    const taskMap = new Map<string, Task>();
    const predecessors = new Map<string, string[]>();
    const successors = new Map<string, string[]>();
    for (const t of tasks) {
      taskMap.set(t.id, t);
      if (!predecessors.has(t.id)) predecessors.set(t.id, []);
      if (!successors.has(t.id)) successors.set(t.id, []);
    }
    for (const t of tasks) {
      for (const dep of t.dependencies) {
        if (taskMap.has(dep.dependencyId)) {
          successors.get(dep.dependencyId)!.push(t.id);
          predecessors.get(t.id)!.push(dep.dependencyId);
        }
      }
    }

    // Map CPM results by task ID
    const cpmMap = new Map<string, CPMTaskResult>();
    for (const cpm of cpResult.tasks) {
      cpmMap.set(cpm.taskId, cpm);
    }

    // Layer assignment based on ES values (Sugiyama-style)
    const nodeWidth = 200;
    const nodeHeight = 80;
    const hGap = 60;
    const vGap = 40;

    // Assign layers by topological depth (longest path from start)
    const layerMap = new Map<string, number>();
    function assignLayer(taskId: string, visited = new Set<string>()): number {
      if (layerMap.has(taskId)) return layerMap.get(taskId)!;
      if (visited.has(taskId)) return 0;
      visited.add(taskId);
      const preds = predecessors.get(taskId) || [];
      let layer = 0;
      for (const pred of preds) {
        layer = Math.max(layer, assignLayer(pred, visited) + 1);
      }
      layerMap.set(taskId, layer);
      return layer;
    }

    for (const cpm of cpResult.tasks) {
      assignLayer(cpm.taskId);
    }

    // Group by layers
    const layers = new Map<number, string[]>();
    for (const [taskId, layer] of layerMap) {
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer)!.push(taskId);
    }

    // Sort within layers: critical tasks first, then by ES
    for (const [, ids] of layers) {
      // eslint-disable-next-line no-restricted-syntax -- small: sorts each layer's own tasks once
      ids.sort((a, b) => {
        const ca = cpmMap.get(a);
        const cb = cpmMap.get(b);
        if (ca?.isCritical && !cb?.isCritical) return -1;
        if (!ca?.isCritical && cb?.isCritical) return 1;
        return (ca?.ES || 0) - (cb?.ES || 0);
      });
    }

    // Assign coordinates
    const maxLayer = Math.max(...layerMap.values(), 0);
    const nodes: NetworkNode[] = [];

    for (let layer = 0; layer <= maxLayer; layer++) {
      const ids = layers.get(layer) || [];
      for (let i = 0; i < ids.length; i++) {
        const taskId = ids[i];
        const cpm = cpmMap.get(taskId);
        if (!cpm) continue;

        const x = layer * (nodeWidth + hGap);
        const y = i * (nodeHeight + vGap);

        nodes.push({
          taskId,
          name: cpm.name,
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
          isCritical: cpm.isCritical,
          ES: cpm.ES,
          EF: cpm.EF,
          LS: cpm.LS,
          LF: cpm.LF,
          totalFloat: cpm.totalFloat,
          duration: cpm.duration,
        });
      }
    }

    // Create edges
    const nodeMap = new Map(nodes.map(n => [n.taskId, n]));
    const edges: NetworkEdge[] = [];
    const criticalSet = new Set(cpResult.criticalPathTaskIds);

    for (const t of tasks) {
      for (const dep of t.dependencies) {
        if (nodeMap.has(t.id) && nodeMap.has(dep.dependencyId)) {
          const from = nodeMap.get(dep.dependencyId)!;
          const to = nodeMap.get(t.id)!;
          edges.push({
            fromId: dep.dependencyId,
            toId: t.id,
            fromX: from.x + from.width,
            fromY: from.y + from.height / 2,
            toX: to.x,
            toY: to.y + to.height / 2,
            isCritical: criticalSet.has(dep.dependencyId) && criticalSet.has(t.id),
          });
        }
      }
    }

    // Calculate total dimensions
    const width = (maxLayer + 1) * (nodeWidth + hGap);
    const maxNodesInLayer = Math.max(...[...layers.values()].map(ids => ids.length), 1);
    const height = maxNodesInLayer * (nodeHeight + vGap);

    return { nodes, edges, width, height };
  }
}

export const networkDiagramService = new NetworkDiagramService();

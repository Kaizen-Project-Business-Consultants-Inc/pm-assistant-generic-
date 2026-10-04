/**
 * Typing or pasting a Predecessors cell (Gantt grid and Table view both use this).
 *
 * The cell holds fixed row numbers with an optional link type and lag, separated by commas:
 * "3", "3SS", "3FS+2d", "4, 7FF-1d". A blank cell removes every predecessor. Whatever the
 * route (typed, pasted), the result is the same `dependencies` update, so History/Undo and
 * the re-flow behave the same way.
 */

export interface ParsedPredecessor {
  taskId: string;
  type: string;
  lag: number;
}

export type PredecessorParse = { deps: ParsedPredecessor[] } | { error: string };

export type PredecessorEditResult =
  | { ok: true; patch: { dependencies: Array<{ dependencyId: string; dependencyType: string; lagDays: number }> } }
  | { ok: false; message: string };

export const MAX_PREDECESSORS = 20;

export function parsePredecessorText(
  input: string,
  currentTaskId: string,
  rowNumToTaskId: Map<number, string>,
): PredecessorParse {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return { deps: [] };

  const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
  const deps: ParsedPredecessor[] = [];

  for (const part of parts) {
    const match = part.match(/^(\d+)\s*(FS|FF|SS|SF)?\s*([+-]\d+d?)?$/i);
    if (!match) return { error: `Invalid format: "${part}". Use: row# or row#FS or row#SS+2d` };

    const rowNum = parseInt(match[1], 10);
    const type = (match[2] || 'FS').toUpperCase();
    const lagStr = match[3];
    const lag = lagStr ? parseInt(lagStr.replace(/d$/i, ''), 10) : 0;

    const targetTaskId = rowNumToTaskId.get(rowNum);
    if (!targetTaskId) return { error: `Row ${rowNum} not found` };
    if (targetTaskId === currentTaskId) return { error: 'Cannot reference self' };
    if (deps.some(d => d.taskId === targetTaskId)) return { error: `Duplicate: row ${rowNum}` };

    deps.push({ taskId: targetTaskId, type, lag });
  }

  if (deps.length > MAX_PREDECESSORS) return { error: `Max ${MAX_PREDECESSORS} predecessors` };
  return { deps };
}

/** The task update a typed or pasted Predecessors value turns into (or why it can't). */
export function planPredecessorEdit(
  input: string,
  currentTaskId: string,
  rowNumToTaskId: Map<number, string>,
): PredecessorEditResult {
  const parsed = parsePredecessorText(input, currentTaskId, rowNumToTaskId);
  if ('error' in parsed) return { ok: false, message: parsed.error };
  return {
    ok: true,
    patch: {
      dependencies: parsed.deps.map(d => ({ dependencyId: d.taskId, dependencyType: d.type, lagDays: d.lag })),
    },
  };
}

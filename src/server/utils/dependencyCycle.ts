/**
 * Find a loop in a set of task links. An edge `{ from, to }` means "to depends on from"
 * (from must happen first). Returns the tasks on the first loop found, in order, or null.
 *
 * Used to check a whole batch of new links against the schedule's existing ones at once —
 * checking links one by one against the database misses loops that only close when two
 * links in the same batch are combined.
 */
export function findDependencyCycle(edges: Array<{ from: string; to: string }>): string[] | null {
  const next = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (!next.has(from)) next.set(from, []);
    next.get(from)!.push(to);
  }

  const DONE = 2, ON_PATH = 1;
  const state = new Map<string, number>();
  const path: string[] = [];

  // Iterative DFS — a long chain of tasks must not blow the stack
  for (const start of next.keys()) {
    if (state.get(start) === DONE) continue;
    const stack: Array<{ node: string; i: number }> = [{ node: start, i: 0 }];
    state.set(start, ON_PATH);
    path.push(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const children = next.get(top.node) ?? [];
      if (top.i < children.length) {
        const child = children[top.i++];
        const s = state.get(child);
        if (s === ON_PATH) return [...path.slice(path.indexOf(child)), child];
        if (s !== DONE) {
          state.set(child, ON_PATH);
          path.push(child);
          stack.push({ node: child, i: 0 });
        }
      } else {
        state.set(top.node, DONE);
        path.pop();
        stack.pop();
      }
    }
  }
  return null;
}

/**
 * What a workflow run was about, in words (Workflows → Executions). The list used to show
 * `task 3f2a…` — the raw id. The server now sends the task's or project's name with each run
 * (null when it has since been deleted). Audit 2, 2026-10-11.
 */
interface WorkflowRunTargetInput {
  entityType?: string | null;
  entityName?: string | null;
}

export function describeRunTarget(run: WorkflowRunTargetInput): string {
  const type = run.entityType ?? '';
  if (type !== 'task' && type !== 'project') return type && type !== 'unknown' ? `a ${type}` : '';
  if (run.entityName) return `${type} “${run.entityName}”`;
  return `a ${type} that no longer exists`;
}

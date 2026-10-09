import type { FastifyReply } from 'fastify';

/**
 * A live project already has that name (T052: names are unique among live projects; archived
 * ones free theirs). Thrown by ProjectService on create and rename, so EVERY way of making a
 * project — the form, a template, an intake submission, Claude — gives the same plain message
 * instead of a raw database error (2026-10-07: templates answered 500 with the SQL text, and the
 * create screen showed "Failed to create project").
 */
export class DuplicateProjectNameError extends Error {
  readonly statusCode = 409;
  readonly code = 'DUPLICATE_PROJECT_NAME';
  constructor(public readonly projectName: string, public readonly existingProjectId: string | null) {
    super(`A project called "${projectName}" already exists. Open it, or archive it first if you are replacing it.`);
    this.name = 'DuplicateProjectNameError';
  }
}

/** Is this database error a clash on the live-project-name index? */
export function isDuplicateNameDbError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  return e?.code === 'ER_DUP_ENTRY' && String(e?.message ?? '').includes('idx_projects_live_name');
}

/** Is this database error a clash on the project code? (two projects created at the same moment) */
export function isDuplicateCodeDbError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  return e?.code === 'ER_DUP_ENTRY' && String(e?.message ?? '').includes('idx_projects_code');
}

/**
 * Answer 409 for a duplicate name. `canOpen` says whether this person may open the existing
 * project — only then does the reply carry its id (for an "Open it" link). Returns true when it
 * answered; the caller then `return reply`. (It returned the reply itself until 2026-10-09 — but a
 * reply is thenable, so `await` turned it into undefined and the caller sent a second answer.)
 */
export async function duplicateProjectNameReply(
  err: unknown,
  reply: FastifyReply,
  canOpen: (projectId: string) => Promise<boolean>,
): Promise<boolean> {
  if (!(err instanceof DuplicateProjectNameError)) return false;
  const id = err.existingProjectId && (await canOpen(err.existingProjectId).catch(() => false)) ? err.existingProjectId : null;
  reply.status(409).send({
    error: 'Duplicate project name',
    message: err.message,
    field: 'name',
    ...(id ? { existingProjectId: id } : {}),
  });
  return true;
}

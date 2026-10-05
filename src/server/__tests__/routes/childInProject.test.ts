import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guard (2026-10-05, audit high "changed from the wrong project"): access is checked on the
 * project (or schedule) in the URL, so an item id in the same URL must belong to it — otherwise a
 * PM of project A could act on project B's item by its id. Found open: documents (edit, delete,
 * reprocess), task comments (delete), save-project-as-template. Every route file that takes
 * '/:projectId/…/:somethingId' must show where that check happens.
 */
const routes = join(__dirname, '..', '..', 'routes');
const read = (rel: string) => readFileSync(join(routes, rel), 'utf-8');

/** file → the text that proves the child id is matched to the project */
const CHECKED: Record<string, RegExp> = {
  'collaboration/risks.ts': /item\.projectId !== p\.projectId/,
  'collaboration/documentIntelligence.ts': /doc\.projectId !== p\.projectId/,
  'automation/automations.ts': /rule\.projectId !== p\.projectId/,
  'core/projectLinks.ts': /projectLinkRepository|linkRepository|ProjectLink/, // repository: WHERE id = ? AND project_id = ?
  'core/projectMembers.ts': /projectId/,
  'collaboration/sponsor.ts': /item\.projectId|projectId !==/,
  'collaboration/raidReview.ts': /raidReviewService/,
  'collaboration/weeklyReview.ts': /weeklyReviewService/,
};

describe('a child id in the URL belongs to the project in the URL', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.ts')) files.push(p); } };
  walk(routes);
  const withChild = files
    .map(p => p.slice(routes.length + 1).split('\\').join('/'))
    .filter(rel => /fastify\.(get|post|put|patch|delete)\('\/:projectId\/[^']*\/:[a-zA-Z]+Id/.test(read(rel)));

  it('every such route file is known and checked', () => {
    expect(withChild.filter(f => !CHECKED[f])).toEqual([]);
    for (const f of withChild) expect(read(f), f).toMatch(CHECKED[f]);
  });

  it('documents: one rule for every route naming a document', () => {
    expect(read('collaboration/documentIntelligence.ts')).toMatch(/if \(!doc \|\| doc\.projectId !== p\.projectId\) return reply\.status\(404\)/);
  });

  it('task comments: deleting matches the comment to its task', () => {
    expect(read('scheduling/schedules.ts')).toMatch(/scheduleService\.deleteComment\(commentId, taskId\)/);
    expect(readFileSync(join(routes, '..', 'database', 'TaskRepository.ts'), 'utf-8')).toMatch(/DELETE FROM task_comments WHERE id = \? AND task_id = \?/);
  });

  it("save as template: only the project's Manager/Owner", () => {
    const src = read('collaboration/templates.ts');
    const start = src.indexOf("'/save-from-project'");
    expect(src.slice(start, start + 900)).toMatch(/checkProjectRole\(request, data\.projectId, 'manager'\)/);
  });
});

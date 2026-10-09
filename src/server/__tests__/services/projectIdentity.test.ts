import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Project identity (2026-10-07, finishing "part 6" of the 2026-09-19 plan):
 * - a code (PRJ-n) is given automatically; two projects made at the same moment no longer clash;
 * - a name a live project already has gives ONE plain message on every way of making a project
 *   (form, template, intake, Claude) — templates answered 500 with the database's text, and the
 *   create screen hid every reason behind "Failed to create project";
 * - the "Open it" link only carries a project the person may open.
 */
const db = vi.hoisted(() => ({ inserts: 0, failCodeTimes: 0, failName: false, codes: [] as string[] }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: async (sql: string, params: any[]) => {
      if (sql.includes('SELECT project_code FROM projects')) return [{ project_code: 'PRJ-007' }];
      if (sql.includes('WHERE live_name = ?')) return [{ id: 'existing-1' }];
      if (sql.startsWith('INSERT INTO projects')) {
        db.inserts++;
        db.codes.push(params[2]);
        if (db.failName) throw Object.assign(new Error("Duplicate entry 'X' for key 'idx_projects_live_name'"), { code: 'ER_DUP_ENTRY' });
        if (db.failCodeTimes-- > 0) throw Object.assign(new Error("Duplicate entry 'PRJ-008' for key 'idx_projects_code'"), { code: 'ER_DUP_ENTRY' });
        return { affectedRows: 1 };
      }
      if (sql.includes('FROM projects WHERE id')) return [{ id: 'new', name: 'X', project_code: 'PRJ-008', status: 'planning' }];
      return [];
    },
    queryControlPlane: async () => [],
  },
}));

import { projectRepository } from '../../database/ProjectRepository';
import { DuplicateProjectNameError, duplicateProjectNameReply } from '../../utils/duplicateProject';

const reply = () => {
  const r: any = { code: 0, body: null };
  r.status = (c: number) => { r.code = c; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  return r;
};

describe('project codes', () => {
  beforeEach(() => { db.inserts = 0; db.failCodeTimes = 0; db.failName = false; db.codes = []; });

  it('a code clash (two made at once) just takes another try', async () => {
    db.failCodeTimes = 2;
    const p = await projectRepository.create({ name: 'X', userId: 'u1' } as any);
    expect(db.inserts).toBe(3);
    expect(p.id).toBeTruthy();
  });

  it('a name clash is not retried — it goes up to the service', async () => {
    db.failName = true;
    await expect(projectRepository.create({ name: 'X', userId: 'u1' } as any)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    expect(db.inserts).toBe(1);
    expect(await projectRepository.findLiveIdByName('X')).toBe('existing-1');
  });
});

describe('a duplicate name answers one plain 409', () => {
  it('with an Open-it link only for someone who may open the existing project', async () => {
    const err = new DuplicateProjectNameError('Website', 'existing-1');
    expect(err.message).toBe('A project called "Website" already exists. Open it, or archive it first if you are replacing it.');
    const allowed = reply();
    expect(await duplicateProjectNameReply(err, allowed, async () => true)).toBe(true);
    expect(allowed.code).toBe(409);
    expect(allowed.body).toMatchObject({ field: 'name', existingProjectId: 'existing-1' });
    const notAllowed = reply();
    expect(await duplicateProjectNameReply(err, notAllowed, async () => false)).toBe(true);
    expect(notAllowed.code).toBe(409);
    expect(notAllowed.body.existingProjectId).toBeUndefined();
  });

  it('other errors are left alone', async () => {
    expect(await duplicateProjectNameReply(new Error('boom'), reply(), async () => true)).toBe(false);
  });

  it('every way of making a project uses it, and the create screen shows the message', () => {
    const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf-8');
    for (const f of [['routes', 'core', 'projects.ts'], ['routes', 'collaboration', 'templates.ts'], ['routes', 'collaboration', 'intakeForms.ts'], ['routes', 'ai', 'aiChat.ts']]) {
      expect(src(...f), f.join('/')).toMatch(/duplicateProjectNameReply\(/);
    }
    const svc = src('services', 'ProjectService.ts');
    expect(svc.match(/throw new DuplicateProjectNameError\(/g)?.length).toBe(2); // create + rename
    const picker = readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'components', 'templates', 'TemplatePicker.tsx'), 'utf-8');
    expect(picker).toMatch(/showCreateError\(err, 'Failed to create project/);
    expect(picker).toMatch(/Open it/);
    // the reply's tidy-up keeps the id the link needs (it was stripped, so the link never showed)
    expect(src('plugins.ts')).toMatch(/normalized\.existingProjectId = body\.existingProjectId/);
  });
});

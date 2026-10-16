import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));

// Each company's database, as the real one is: queries run against the signed-in company's own
// database (the request's tenant context), never another's.
const dbs = new Map<string, Map<string, any>>();
const db = () => {
  const name = getTenantContext()?.dbName ?? 'none';
  if (!dbs.has(name)) dbs.set(name, new Map());
  return dbs.get(name)!;
};
vi.mock('../../database/CustomTemplateRepository', () => ({
  customTemplateRepository: {
    list: async () => [...db().values()],
    find: async (id: string) => db().get(id) ?? null,
    insert: async (t: any) => { db().set(t.id, t); },
    replace: async (t: any) => { db().set(t.id, t); },
    remove: async (id: string) => db().delete(id),
    countUse: async () => {},
  },
}));

import { TemplateService } from '../../services/TemplateService';
import { runWithTenantContext, getTenantContext } from '../../middleware/requestContext';

/**
 * A template a company saves is that company's own (2026-10-15) and survives a restart (2026-10-16):
 * it is kept in the company's own database (T092), not in the server's memory. Another company
 * can't see, change, delete or use it; built-in templates stay visible to everyone.
 */
describe('custom templates belong to the company that saved them', () => {
  const asA = <T>(fn: () => Promise<T>) => runWithTenantContext('pmassist_t_a', 'org-a', fn);
  const asB = <T>(fn: () => Promise<T>) => runWithTenantContext('pmassist_t_b', 'org-b', fn);
  const custom = {
    name: 'Acme bank loan system rollout', description: 'Saved from a client project', projectType: 'it', category: 'web_development',
    isBuiltIn: false, createdBy: 'u-a', estimatedDurationDays: 30, tags: [],
    tasks: [{ refId: 't1', name: 'Build', description: '', estimatedDays: 5, priority: 'medium', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['backend'], isSummary: false, placeholderRole: 'Backend Developer' }],
  } as any;

  it('only the saving company sees, changes or deletes it; everyone still sees the built-ins', async () => {
    const mine = await asA(() => new TemplateService().create(custom));
    // a fresh service (as after a restart) still finds it: it is in the company's database
    const service = new TemplateService();
    expect((await asA(() => service.findAll())).map(t => t.id)).toContain(mine.id);
    expect(await asA(() => service.findById(mine.id))).not.toBeNull();
    // what a template is served with (the placeholder role) is never stored
    expect(dbs.get('pmassist_t_a')!.get(mine.id).tasks[0].placeholderRole).toBeUndefined();

    const theirs = await asB(() => service.findAll());
    expect(theirs.map(t => t.id)).not.toContain(mine.id);
    expect(theirs.some(t => t.id === 'tpl-it-webapp')).toBe(true);
    expect(await asB(() => service.findById(mine.id))).toBeNull();
    expect(await asB(() => service.update(mine.id, { name: 'Hijacked' }))).toBeNull();
    expect(await asB(() => service.delete(mine.id))).toBe(false);
    await expect(asB(() => service.applyTemplate({ templateId: mine.id, projectName: 'X', startDate: '2026-11-02', priority: 'medium', userId: 'u-b' })))
      .rejects.toThrow('Template not found');

    expect((await asA(() => service.update(mine.id, { name: 'Renamed' })))?.name).toBe('Renamed');
    expect((await asA(() => service.findById(mine.id)))?.name).toBe('Renamed');
    expect(await asA(() => service.delete(mine.id))).toBe(true);
    expect(await asA(() => service.findById(mine.id))).toBeNull();
  });

  it('built-in templates can never be changed or deleted', async () => {
    const service = new TemplateService();
    expect(await asA(() => service.update('tpl-it-webapp', { name: 'Hacked' }))).toBeNull();
    expect(await asA(() => service.delete('tpl-it-webapp'))).toBe(false);
    expect((await asA(() => service.findById('tpl-it-webapp')))?.name).toBe('Web Application Development');
  });
});

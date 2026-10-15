import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));

import { TemplateService } from '../../services/TemplateService';
import { runWithTenantContext } from '../../middleware/requestContext';

/**
 * 2026-10-15: a template a company saves is that company's own. Custom templates were kept in one
 * list for every company — another company could see, edit or delete them, and they can carry
 * the first company's clients' details. Built-in templates stay visible to everyone.
 */
describe('custom templates belong to the company that saved them', () => {
  const service = new TemplateService();
  const asA = <T>(fn: () => Promise<T>) => runWithTenantContext('pmassist_t_a', 'org-a', fn);
  const asB = <T>(fn: () => Promise<T>) => runWithTenantContext('pmassist_t_b', 'org-b', fn);
  const custom = {
    name: 'Acme bank loan system rollout', description: 'Saved from a client project', projectType: 'it', category: 'web_development',
    isBuiltIn: false, createdBy: 'u-a', estimatedDurationDays: 30, tags: [], tasks: [],
  } as any;

  it('only the saving company sees, changes or deletes it; everyone still sees the built-ins', async () => {
    const mine = await asA(() => service.create(custom));
    expect((await asA(() => service.findAll())).map(t => t.id)).toContain(mine.id);
    expect(await asA(() => service.findById(mine.id))).not.toBeNull();

    const theirs = await asB(() => service.findAll());
    expect(theirs.map(t => t.id)).not.toContain(mine.id);
    expect(theirs.some(t => t.id === 'tpl-it-webapp')).toBe(true);
    expect(await asB(() => service.findById(mine.id))).toBeNull();
    expect(await asB(() => service.update(mine.id, { name: 'Hijacked' }))).toBeNull();
    expect(await asB(() => service.delete(mine.id))).toBe(false);
    await expect(asB(() => service.applyTemplate({ templateId: mine.id, projectName: 'X', startDate: '2026-11-02', priority: 'medium', userId: 'u-b' })))
      .rejects.toThrow('Template not found');

    expect((await asA(() => service.findById(mine.id)))?.name).toBe('Acme bank loan system rollout');
    expect(await asA(() => service.delete(mine.id))).toBe(true);
  });
});

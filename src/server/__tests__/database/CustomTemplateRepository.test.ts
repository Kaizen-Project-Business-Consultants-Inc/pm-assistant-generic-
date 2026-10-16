import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../database/connection', () => ({ databaseService: { query: (...a: any[]) => query(...a) } }));

import { customTemplateRepository } from '../../database/CustomTemplateRepository';

const template = {
  id: 'tpl-abc', name: 'Our office move', description: 'Saved from a project', projectType: 'other', category: 'office',
  isBuiltIn: false, createdBy: 'u1', estimatedDurationDays: 20, tags: [], usageCount: 7, tasks: [],
} as any;

describe("a company's saved templates are kept in its database (T092)", () => {
  beforeEach(() => query.mockReset());

  it('stores the whole template as JSON (not its usage count, which has its own column)', async () => {
    query.mockResolvedValue([]);
    await customTemplateRepository.insert(template);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO custom_templates/);
    expect(params[0]).toBe('tpl-abc');
    expect(params[1]).toBe('Our office move');
    const body = JSON.parse(params[2]);
    expect(body.name).toBe('Our office move');
    expect(body).not.toHaveProperty('usageCount');
    expect(body).not.toHaveProperty('id');
    expect(params[3]).toBe('u1');
  });

  it('reads it back whole, as a custom template with its usage count (JSON column as text or object)', async () => {
    query.mockResolvedValueOnce([{ id: 'tpl-abc', body: JSON.stringify({ ...template, id: undefined, usageCount: undefined }), usage_count: 3 }]);
    const found = await customTemplateRepository.find('tpl-abc');
    expect(found).toMatchObject({ id: 'tpl-abc', name: 'Our office move', isBuiltIn: false, usageCount: 3 });
    query.mockResolvedValueOnce([{ id: 'tpl-x', body: { ...template, name: 'Parsed already' }, usage_count: 0 }]);
    expect((await customTemplateRepository.list())[0]).toMatchObject({ id: 'tpl-x', name: 'Parsed already', usageCount: 0 });
    query.mockResolvedValueOnce([]);
    expect(await customTemplateRepository.find('nope')).toBeNull();
  });

  it('delete says whether anything was removed', async () => {
    query.mockResolvedValueOnce({ affectedRows: 1 });
    expect(await customTemplateRepository.remove('tpl-abc')).toBe(true);
    query.mockResolvedValueOnce({ affectedRows: 0 });
    expect(await customTemplateRepository.remove('tpl-abc')).toBe(false);
  });
});

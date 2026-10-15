import { test, expect } from '@playwright/test';
import { STAGING_USER, STAGING_OUTSIDER } from './staging-helpers';
import { signedIn, api } from './qa-data';

/**
 * A saved template is the saving company's own (2026-10-15): another company can't list, open,
 * change, delete or use it. Built-in templates stay visible to everyone. The template made here
 * is deleted at the end. (Custom templates are held in the app's memory: this relies on staging
 * running one app process, as it does — the single pm-app service.)
 */
test("another company can't see or touch a company's saved template", async ({ browser }) => {
  const pm = await signedIn(browser, STAGING_USER);
  const other = await signedIn(browser, STAGING_OUTSIDER);
  const name = `QA private template ${Date.now().toString(36)}`;
  const { template } = await api(pm, 'post', '/api/v1/templates', {
    name, description: 'Saved by QA Staging Co', projectType: 'it', category: 'web_development', estimatedDurationDays: 10,
    tasks: [{ refId: 't1', name: 'Client-specific task', estimatedDays: 2 }],
  });
  try {
    const mine = await api(pm, 'get', '/api/v1/templates?limit=200');
    expect((mine.data ?? mine.templates).map((t: any) => t.id)).toContain(template.id);

    const theirs = await api(other, 'get', '/api/v1/templates?limit=200');
    const theirIds = (theirs.data ?? theirs.templates).map((t: any) => t.id);
    expect(theirIds).not.toContain(template.id);
    expect(theirIds).toContain('tpl-it-webapp'); // built-ins for everyone
    expect((await other.request.get(`/api/v1/templates/${template.id}`)).status()).toBe(404);
    expect((await other.request.put(`/api/v1/templates/${template.id}`, { data: { name: 'Hijacked' } })).status()).toBe(404);
    expect((await other.request.delete(`/api/v1/templates/${template.id}`)).status()).toBe(404);
    const use = await other.request.post('/api/v1/templates/apply', { data: { templateId: template.id, projectName: `QA should not exist ${Date.now()}`, startDate: '2026-11-02' } });
    expect(use.status()).toBe(404);
    expect((await api(pm, 'get', `/api/v1/templates/${template.id}`)).template.name).toBe(name);
  } finally {
    await pm.request.delete(`/api/v1/templates/${template.id}`);
    await pm.close();
    await other.close();
  }
});

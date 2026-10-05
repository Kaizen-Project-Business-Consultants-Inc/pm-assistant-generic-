import { test, expect } from '@playwright/test';
import { STAGING_USER, STAGING_URL } from './staging-helpers';
import { signedIn } from './qa-data';

/**
 * A key (API key or Claude connection) never does more than its owner's role, and anyone can
 * revoke their own key (2026-10-05, audit critical #2). Against real staging as the QA PM.
 */
test('a PM key reads and writes, never admin; the PM revokes it and it stops working', async ({ browser }) => {
  const pm = await signedIn(browser, STAGING_USER);

  // a PM can't make a key with the admin right
  const tooMuch = await pm.request.post('/api/v1/api-keys', { data: { name: 'e2e too much', scopes: ['read', 'write', 'admin'] } });
  expect(tooMuch.status()).toBe(403);

  const made = await pm.request.post('/api/v1/api-keys', { data: { name: `e2e key ${Date.now().toString(36)}`, scopes: ['read', 'write'] } });
  expect(made.status(), await made.text()).toBe(201);
  const body = await made.json();
  const raw: string = body.key ?? body.apiKey?.key ?? body.rawKey;
  const id: string = body.apiKey?.id ?? body.id;
  expect(raw).toMatch(/^kpm_/);

  const ctx = await browser.newContext({ baseURL: STAGING_URL, storageState: { cookies: [], origins: [] } });
  const asKey = (url: string) => ctx.request.get(url, { headers: { Authorization: `Bearer ${raw}` } });
  expect((await asKey('/api/v1/projects')).status()).toBe(200);
  for (const url of ['/api/v1/admin/stats', '/api/v1/admin/tenants', '/api/v1/feedback']) {
    expect([401, 403], url).toContain((await asKey(url)).status());
  }

  // revoking your own key works (it used to need the admin right) …
  const revoked = await pm.request.delete(`/api/v1/api-keys/${id}`);
  expect(revoked.status()).toBe(200);
  // … and the key stops working
  expect((await asKey('/api/v1/projects')).status()).toBe(401);
  await ctx.close();
  await pm.close();
});

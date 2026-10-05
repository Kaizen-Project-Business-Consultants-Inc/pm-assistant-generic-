/** The AI is asked only when a person asks (2026-10-05): opening Team/Time tabs and typing in the risk form make no AI call; the Suggest button makes one. */
import { test, expect } from '@playwright/test';
import { STAGING_USER } from './staging-helpers';
import { signedIn, api } from './qa-data';

test('no AI call unless asked', async ({ browser }) => {
  const pm = await signedIn(browser, STAGING_USER);
  const r: any = await api(pm, 'get', '/api/v1/projects');
  const p = (r.projects ?? r.data?.projects ?? r.data ?? r).find((x: any) => !x.isDemo);
  const calls: string[] = [];
  pm.on('request', q => { const u = q.url(); if (/mitigations|narrative=1|rebalance-suggestions/.test(u)) calls.push(u); });
  // Team tab and Time tab: open, wait
  for (const tab of ['team', 'time']) { await pm.goto(`/project/${p.id}?tab=${tab}`); await pm.waitForTimeout(4000); }
  console.log('after Team + Time tabs:', calls.length);
  expect(calls).toHaveLength(0);
  // Risk form: type a long title + description
  await pm.goto(`/project/${p.id}?tab=raid`);
  await pm.getByRole('button', { name: 'Risk', exact: true }).click();
  const title = pm.getByRole('dialog').getByRole('textbox').first();
  await title.waitFor({ timeout: 15000 });
  await title.pressSequentially('Vendor delivery may slip past the integration window', { delay: 20 });
  await pm.waitForTimeout(2500);
  console.log('after typing in risk form:', calls.length);
  expect(calls).toHaveLength(0);
  const btn = pm.getByRole('button', { name: 'Suggest mitigations from past lessons' });
  await expect(btn).toBeVisible();
  await btn.click();
  await pm.waitForTimeout(3000);
  console.log('after pressing Suggest:', calls.length);
  expect(calls.filter(c => /mitigations/.test(c))).toHaveLength(1);
});

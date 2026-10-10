import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WEBHOOK_EVENTS } from '../../constants/webhookEvents';

/**
 * Settings → Webhooks lets people pick which events to receive. It offered only 8 of the events
 * the server sends (audit 2, 2026-10-10). The server's list (src/server/constants/webhookEvents.ts)
 * is the only names `webhookService.dispatch` accepts (type-checked), so matching it means the
 * screen offers every event that can be sent and nothing that never is.
 */
describe('webhook events offered in Settings', () => {
  it("are exactly the server's list", () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'constants', 'webhookEvents.ts'), 'utf8');
    const list = src.slice(src.indexOf('WEBHOOK_EVENTS = ['), src.indexOf('] as const'));
    const server = [...list.matchAll(/'([a-z_.]+)'/g)].map(m => m[1]);
    expect(server.length).toBeGreaterThan(10);
    expect([...WEBHOOK_EVENTS].sort()).toEqual([...server].sort());
  });

  it('the server sends no event outside its list (every dispatch names a listed event or a typed variable)', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'services', 'WebhookService.ts'), 'utf8');
    expect(src).toMatch(/async dispatch\(event: WebhookEvent,/);
  });
});

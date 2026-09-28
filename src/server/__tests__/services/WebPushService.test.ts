import { describe, it, expect, vi } from 'vitest';

vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
vi.mock('../../config', () => ({ config: { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@y.z' } }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../middleware/requestContext', () => ({ getTenantContext: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { webPushService } from '../../services/WebPushService';
import { databaseService } from '../../database/connection';
import { getTenantContext } from '../../middleware/requestContext';

describe('WebPushService.sendPush', () => {
  it('does nothing without an organisation (the shared database has no push table)', async () => {
    (getTenantContext as any).mockReturnValue(undefined);
    (webPushService as any).configured = true;
    await webPushService.sendPush('u1', { title: 't', body: 'b' });
    expect(databaseService.query).not.toHaveBeenCalled();
  });

  it('looks up the user’s subscriptions inside an organisation', async () => {
    (getTenantContext as any).mockReturnValue({ dbName: 'pmassist_t_a', orgId: 'o1' });
    (webPushService as any).configured = true;
    await webPushService.sendPush('u1', { title: 't', body: 'b' });
    expect(databaseService.query).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { APP_URL: 'https://example.test', MICROSOFT_CLIENT_ID: 'cid', MICROSOFT_CLIENT_SECRET: 'secret' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockUpdateIntegration = vi.fn().mockResolvedValue(undefined);
vi.mock('../../database/IntegrationRepository', () => ({
  integrationRepository: { updateIntegration: mockUpdateIntegration },
  parseConfig: (raw: any) => (typeof raw === 'string' ? JSON.parse(raw) : raw || {}),
}));

import { TeamsAdapter, canPostToTeams, TeamsConfig } from '../../services/integrations/TeamsAdapter';

function graphOk(body: Record<string, unknown>) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function graphFail(status: number, body = 'nope') {
  return { ok: false, status, text: async () => body } as unknown as Response;
}

describe('TeamsAdapter', () => {
  let adapter: TeamsAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new TeamsAdapter();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockUpdateIntegration.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('buildOAuthUrl', () => {
    it('builds a Microsoft login URL carrying the requested Graph scopes', () => {
      const url = adapter.buildOAuthUrl('state123');
      expect(url).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      expect(url).toContain('client_id=cid');
      expect(url).toContain('state=state123');
      expect(decodeURIComponent(url)).toContain('ChannelMessage.Send');
    });
  });

  describe('canPostToTeams', () => {
    it('requires an access token, a team and a channel — a partial connection cannot post', () => {
      expect(canPostToTeams({})).toBe(false);
      expect(canPostToTeams({ accessToken: 'a' })).toBe(false);
      expect(canPostToTeams({ accessToken: 'a', teamId: 't1' })).toBe(false);
      expect(canPostToTeams({ accessToken: 'a', teamId: 't1', channelId: 'c1' })).toBe(true);
    });
  });

  describe('exchangeCode', () => {
    it('exchanges an auth code for a token pair', async () => {
      fetchMock.mockResolvedValue(graphOk({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }));
      const result = await adapter.exchangeCode('code123');
      expect(result.access_token).toBe('at');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
      expect((init as any).body).toContain('grant_type=authorization_code');
    });

    it('throws with the status code when the exchange fails', async () => {
      fetchMock.mockResolvedValue(graphFail(400, 'invalid_grant'));
      await expect(adapter.exchangeCode('bad')).rejects.toThrow('Token exchange failed: 400');
    });
  });

  describe('ensureFreshToken', () => {
    it('reuses a still-valid token without calling Microsoft again', async () => {
      const cfg: TeamsConfig = { accessToken: 'live', refreshToken: 'rt', expiresAt: Date.now() + 5 * 60_000 };
      const token = await adapter.ensureFreshToken('integ-1', cfg);
      expect(token).toBe('live');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes and persists a new pair when the token has expired', async () => {
      fetchMock.mockResolvedValue(graphOk({ access_token: 'fresh', refresh_token: 'rt2', expires_in: 3600 }));
      const cfg: TeamsConfig = { accessToken: 'stale', refreshToken: 'rt', expiresAt: Date.now() - 1000 };

      const token = await adapter.ensureFreshToken('integ-1', cfg);

      expect(token).toBe('fresh');
      expect(mockUpdateIntegration).toHaveBeenCalledWith('integ-1', expect.objectContaining({
        config: expect.objectContaining({ accessToken: 'fresh', refreshToken: 'rt2' }),
      }));
    });

    it('returns null rather than throwing when refresh fails, so a dead connection fails a delivery, not the caller', async () => {
      fetchMock.mockResolvedValue(graphFail(401, 'invalid_grant'));
      const cfg: TeamsConfig = { accessToken: 'stale', refreshToken: 'rt', expiresAt: Date.now() - 1000 };

      const token = await adapter.ensureFreshToken('integ-1', cfg);

      expect(token).toBeNull();
    });

    it('returns null when there is no refresh token to fall back on', async () => {
      const token = await adapter.ensureFreshToken('integ-1', {});
      expect(token).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('deliver', () => {
    it('posts an Adaptive Card to the configured team/channel', async () => {
      fetchMock.mockResolvedValue(graphOk({ id: 'msg1' }));
      const cfg: TeamsConfig = { accessToken: 'live', teamId: 'T1', channelId: 'C1', expiresAt: Date.now() + 5 * 60_000 };

      const result = await adapter.deliver('integ-1', cfg, { text: 'hi', card: { type: 'AdaptiveCard' } });

      expect(result.success).toBe(true);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/teams/T1/channels/C1/messages');
    });

    it('fails without attempting a post when no channel is configured', async () => {
      const result = await adapter.deliver('integ-1', {}, { text: 'hi' });
      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports the connection as expired rather than posting with a dead token', async () => {
      const cfg: TeamsConfig = { accessToken: 'stale', teamId: 'T1', channelId: 'C1', expiresAt: Date.now() - 1000 };
      // No refreshToken, so ensureFreshToken can't recover.
      const result = await adapter.deliver('integ-1', cfg, { text: 'hi' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('expired');
    });
  });

  describe('buildEventCards', () => {
    it('builds a card for a completed task', () => {
      const msg = adapter.buildEventCards('task.completed', { task: { name: 'Ship it', assigneeName: 'Alex' } });
      expect(msg?.text).toContain('Ship it');
    });

    it('builds a card for a new risk, linking back to the project', () => {
      const msg = adapter.buildEventCards('risk.created', {
        risk: { title: 'Vendor delay', severity: 'high', ownerName: 'Sam' },
        projectId: 'p1', projectName: 'Big Launch',
      });
      expect(msg?.text).toContain('Vendor delay');
      expect(JSON.stringify(msg?.card)).toContain('p1');
    });

    it('builds a card for a generic notification', () => {
      const msg = adapter.buildEventCards('notification', { notification: { title: 'Heads up', message: 'Something happened' } });
      expect(msg?.text).toBe('Heads up');
    });

    it('returns null for an event type it does not know', () => {
      expect(adapter.buildEventCards('something.unknown', {})).toBeNull();
    });

    it('returns null when the referenced entity is missing from the payload', () => {
      expect(adapter.buildEventCards('task.completed', {})).toBeNull();
    });
  });
});

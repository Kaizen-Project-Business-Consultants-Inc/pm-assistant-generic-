import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { APP_URL: 'https://example.test', SLACK_CLIENT_ID: 'cid', SLACK_CLIENT_SECRET: 'secret' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { SlackAdapter, canPostAsBot, SlackConfig } from '../../services/integrations/SlackAdapter';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/xxx';

function slackApi(body: Record<string, unknown>) {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe('Slack connection', () => {
  let adapter: SlackAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new SlackAdapter();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('choosing how to deliver', () => {
    it('posts as the bot when the customer has picked a channel', async () => {
      fetchMock.mockResolvedValue(slackApi({ ok: true }));
      const config: SlackConfig = { webhookUrl: WEBHOOK, botToken: 'xoxb-1', channelId: 'C123', channel: '#delivery' };

      const result = await adapter.deliver(config, { text: 'hello' });

      expect(result.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://slack.com/api/chat.postMessage');
      // The picked channel is what a webhook cannot honour — that is the whole
      // reason this path exists.
      expect(JSON.parse((init as any).body).channel).toBe('C123');
    });

    it('falls back to the webhook when there is no workspace token', async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);
      const config: SlackConfig = { webhookUrl: WEBHOOK, channel: '#legacy' };

      const result = await adapter.deliver(config, { text: 'hello' });

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK);
    });

    it('knows a token without a channel cannot post as the bot', () => {
      expect(canPostAsBot({ webhookUrl: WEBHOOK, botToken: 'xoxb-1' })).toBe(false);
      expect(canPostAsBot({ webhookUrl: WEBHOOK, channel: '#x' })).toBe(false);
      expect(canPostAsBot({ webhookUrl: WEBHOOK, botToken: 'xoxb-1', channel: '#x' })).toBe(true);
    });
  });

  describe('when the app is not in the channel', () => {
    it('joins the channel and posts, rather than asking the customer to', async () => {
      fetchMock
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce(slackApi({ ok: true }))  // conversations.join
        .mockResolvedValueOnce(slackApi({ ok: true })); // retried post

      const result = await adapter.postWithBotToken('xoxb-1', 'C123', [], 'hello');

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[1][0]).toBe('https://slack.com/api/conversations.join');
    });

    it('explains what to do when it still cannot post', async () => {
      fetchMock
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'missing_scope' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }));

      const result = await adapter.postWithBotToken('xoxb-1', '#private-one', [], 'hello');

      expect(result.success).toBe(false);
      // A project manager cannot act on "not_in_channel".
      expect(result.message).toContain('/invite @Kovarti');
      expect(result.message).not.toBe('not_in_channel');
    });

    it('translates an expired install into something actionable', async () => {
      fetchMock.mockResolvedValue(slackApi({ ok: false, error: 'invalid_auth' }));

      const result = await adapter.postWithBotToken('xoxb-1', 'C123', [], 'hello');

      expect(result.message).toMatch(/install again/i);
    });
  });

  describe('testing the connection', () => {
    it('tests the path real notifications actually take', async () => {
      fetchMock.mockResolvedValue(slackApi({ ok: true }));

      const result = await adapter.testConnection({
        webhookUrl: WEBHOOK, botToken: 'xoxb-1', channelId: 'C123', channel: '#delivery',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('#delivery');
      expect(fetchMock.mock.calls[0][0]).toBe('https://slack.com/api/chat.postMessage');
    });

    it('reports failure when Slack rejects the post', async () => {
      fetchMock.mockResolvedValue(slackApi({ ok: false, error: 'is_archived' }));

      const result = await adapter.testConnection({
        webhookUrl: WEBHOOK, botToken: 'xoxb-1', channelId: 'C123', channel: '#old',
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/archived/i);
    });

    it('asks for a channel instead of failing on a missing webhook', async () => {
      const result = await adapter.testConnection({ webhookUrl: '', botToken: 'xoxb-1' });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/choose a channel/i);
    });
  });

  it('asks Slack for permission to join a channel it is pointed at', () => {
    // Without channels:join the picker can offer a channel we then cannot post to.
    expect(adapter.buildOAuthUrl('state')).toContain('channels%3Ajoin');
  });
});

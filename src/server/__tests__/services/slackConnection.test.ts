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

    it('does not treat the install channel as a channel the customer chose', () => {
      // An OAuth install records the webhook's channel. The bot is not
      // necessarily a member of it, so posting as the bot would fail where the
      // webhook succeeds. Only an explicit pick (channelId) switches paths.
      expect(canPostAsBot({ webhookUrl: WEBHOOK, botToken: 'xoxb-1' })).toBe(false);
      expect(canPostAsBot({ webhookUrl: WEBHOOK, botToken: 'xoxb-1', channel: '#install-channel' })).toBe(false);
      expect(canPostAsBot({ webhookUrl: WEBHOOK, channelId: 'C1' })).toBe(false);
      expect(canPostAsBot({ webhookUrl: WEBHOOK, botToken: 'xoxb-1', channelId: 'C1' })).toBe(true);
    });

    it('never drops a notification when the chosen channel refuses it', async () => {
      fetchMock
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'missing_scope' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce({ ok: true } as Response); // webhook

      const result = await adapter.deliver(
        { webhookUrl: WEBHOOK, botToken: 'xoxb-1', channelId: 'C123', channel: '#delivery' },
        { text: 'hello' },
      );

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[3][0]).toBe(WEBHOOK);
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

    it('tells an older install to reconnect, since it cannot be granted the right', async () => {
      fetchMock
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'missing_scope' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }));

      const result = await adapter.postWithBotToken('xoxb-1', 'C0BL123', [], 'hello', '#new-channel');

      expect(result.success).toBe(false);
      // A project manager cannot act on "not_in_channel", and naming the raw
      // channel id tells them nothing either.
      expect(result.message).toMatch(/connect Slack again/i);
      expect(result.message).toContain('#new-channel');
      expect(result.message).not.toContain('C0BL123');
    });

    it('asks for an invitation when the channel is simply private', async () => {
      fetchMock
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'channel_not_found' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }));

      const result = await adapter.postWithBotToken('xoxb-1', 'C1', [], 'hello', '#private-one');

      expect(result.message).toContain('/invite @Kovarti');
      expect(result.message).toContain('#private-one');
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
        webhookUrl: '', botToken: 'xoxb-1', channelId: 'C123', channel: '#old',
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/archived/i);
    });

    it('does not show a green tick when the chosen channel silently fell back', async () => {
      fetchMock
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'missing_scope' }))
        .mockResolvedValueOnce(slackApi({ ok: false, error: 'not_in_channel' }))
        .mockResolvedValueOnce({ ok: true } as Response); // webhook took it

      const result = await adapter.testConnection({
        webhookUrl: WEBHOOK, botToken: 'xoxb-1', channelId: 'C123', channel: '#delivery',
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/still going to the channel/i);
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

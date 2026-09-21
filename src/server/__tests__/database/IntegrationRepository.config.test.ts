import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]), transaction: vi.fn() },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { IntegrationRepository } from '../../database/IntegrationRepository';

/**
 * A Slack install stores credentials the edit form never shows: the workspace
 * bot token, the team details. Saving the form used to replace the whole config
 * blob, so ticking an event filter quietly destroyed the connection — and the
 * form reads sensitive values back masked, so it wrote "http****" over a real
 * webhook URL. These tests pin the merge behaviour that prevents both.
 */
describe('IntegrationRepository — saving settings', () => {
  let repo: IntegrationRepository;
  let written: Record<string, any>;

  const storedConfig = {
    botToken: 'xoxb-real-token',
    teamId: 'T123',
    teamName: 'Acme',
    botUserId: 'U999',
    webhookUrl: 'https://hooks.slack.com/services/T/B/secret',
    channel: '#delivery',
    notifyEvents: ['risk.created'],
  };

  beforeEach(() => {
    repo = new IntegrationRepository();
    written = {};
    vi.spyOn(repo as any, 'findRawById').mockResolvedValue({
      id: 'i1', config: JSON.stringify(storedConfig),
    });
    vi.spyOn(repo as any, 'findById').mockResolvedValue({ id: 'i1' });
    vi.spyOn(repo as any, 'queryRaw').mockImplementation(async (_sql: string, params: any[]) => {
      const configParam = params.find((p) => typeof p === 'string' && p.startsWith('{'));
      if (configParam) written = JSON.parse(configParam);
      return [];
    });
  });

  it('keeps credentials the form never showed', async () => {
    await repo.updateIntegration('i1', { config: { notifyEvents: ['task.completed'] } });

    expect(written.botToken).toBe('xoxb-real-token');
    expect(written.teamId).toBe('T123');
    expect(written.botUserId).toBe('U999');
  });

  it('never lets a masked value overwrite the real one', async () => {
    await repo.updateIntegration('i1', { config: { webhookUrl: 'http****', channel: '#other' } });

    expect(written.webhookUrl).toBe(storedConfig.webhookUrl);
    expect(written.channel).toBe('#other');
  });

  it('applies the change that was actually made', async () => {
    await repo.updateIntegration('i1', {
      config: { channelId: 'C555', channel: '#new-home' },
    });

    expect(written.channelId).toBe('C555');
    expect(written.channel).toBe('#new-home');
  });

  it('survives the masked form of every secret it hands out', async () => {
    // Whatever the listing masks is what the form will send back, so the two
    // have to stay in step — a new masked field must not become a new way to
    // destroy a credential.
    await repo.updateIntegration('i1', {
      config: { botToken: 'xoxb****', webhookUrl: 'http****', token: 'abcd****' },
    });

    expect(written.botToken).toBe('xoxb-real-token');
    expect(written.webhookUrl).toBe(storedConfig.webhookUrl);
  });

  it('lets every event filter be cleared', async () => {
    // Unchecking the last box has to mean "all events", not "leave it as it was".
    await repo.updateIntegration('i1', { config: { notifyEvents: [] } });

    expect(written.notifyEvents).toEqual([]);
  });
});

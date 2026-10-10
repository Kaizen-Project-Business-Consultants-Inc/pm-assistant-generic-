import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * An automation's send_email must not become a mail relay (2026-10-10): at most 20 people, and the
 * automation's owner must still be on a plan and keep to the free trial's allowance. A refusal fails
 * the step with the reason (shown in the run history) and sends nothing.
 */
const email = vi.hoisted(() => ({ sendNotificationEmail: vi.fn(async () => {}) }));
vi.mock('../../../services/EmailService', () => ({ emailService: email }));
vi.mock('../../../services/UserService', () => ({ userService: { findById: vi.fn(async () => null) } }));
const sendCheck = vi.hoisted(() => ({ checkBackgroundSend: vi.fn() }));
vi.mock('../../../utils/trialEmail', () => sendCheck);
vi.mock('../../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { executeAction } from '../../../services/automation/actionExecutors';

const event = { userId: 'trigger-user', projectId: 'p1' } as any;
const context = { event, entity: {}, _aiBillTo: 'owner-1' } as any;
const addresses = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@x.com`);

beforeEach(() => {
  email.sendNotificationEmail.mockClear();
  sendCheck.checkBackgroundSend.mockReset().mockResolvedValue({ ok: true });
});

describe('automation send_email limits', () => {
  it('sends to each person, checked against the automation owner (not whoever triggered it)', async () => {
    await executeAction('send_email', { to: addresses(3), subject: 'S', body: 'B' }, context, event);
    expect(sendCheck.checkBackgroundSend).toHaveBeenCalledWith('owner-1', 3);
    expect(email.sendNotificationEmail).toHaveBeenCalledTimes(3);
  });

  it('refuses more than 20 people on any plan', async () => {
    await expect(executeAction('send_email', { to: addresses(21), subject: 'S', body: 'B' }, context, event)).rejects.toThrow(/at most 20 people/);
    expect(email.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('refuses with the reason when the owner\'s plan has ended or the trial allowance is used', async () => {
    sendCheck.checkBackgroundSend.mockResolvedValueOnce({ ok: false, stop: false, reason: 'On the free trial you can send up to 5 emails a day.' });
    await expect(executeAction('send_email', { to: addresses(2), subject: 'S', body: 'B' }, context, event)).rejects.toThrow(/5 emails a day/);
    expect(email.sendNotificationEmail).not.toHaveBeenCalled();
  });
});

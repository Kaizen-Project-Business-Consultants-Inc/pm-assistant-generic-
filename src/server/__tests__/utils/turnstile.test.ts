import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cfg = vi.hoisted(() => ({ config: { TURNSTILE_SECRET_KEY: '' } }));
vi.mock('../../config', () => cfg);
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { verifyTurnstile, checkTurnstileSecret, turnstileActive } from '../../utils/turnstile';

describe('the registration CAPTCHA', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    cfg.config.TURNSTILE_SECRET_KEY = 'secret';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is skipped entirely when no key is configured', async () => {
    // A server without keys must keep registering people. Refusing every signup
    // is a worse failure than allowing a few bots.
    cfg.config.TURNSTILE_SECRET_KEY = '';

    await expect(verifyTurnstile(undefined, '1.2.3.4')).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a signup with no token once a key is configured', async () => {
    await expect(verifyTurnstile(undefined, '1.2.3.4')).resolves.toBe(false);
  });

  it('accepts a challenge Cloudflare confirms', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true }) });

    await expect(verifyTurnstile('tok', '1.2.3.4')).resolves.toBe(true);
  });

  it('refuses a challenge Cloudflare rejects', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });

    await expect(verifyTurnstile('tok', '1.2.3.4')).resolves.toBe(false);
  });

  it('lets people sign up when Cloudflare itself is unreachable', async () => {
    // Their outage must not become ours. Rate limiting and email verification
    // still stand behind this.
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(verifyTurnstile('tok', '1.2.3.4')).resolves.toBe(true);
  });

  it('sends the secret and the visitor address, not the token alone', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true }) });

    await verifyTurnstile('tok', '9.9.9.9');

    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain('secret=secret');
    expect(body).toContain('response=tok');
    expect(body).toContain('remoteip=9.9.9.9');
  });

  describe('the startup check', () => {
    it('confirms a good secret — Cloudflare judged the token, so the secret got through', async () => {
      fetchMock.mockResolvedValue({ json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });

      await expect(checkTurnstileSecret()).resolves.toBe(true);
      expect(turnstileActive()).toBe(true);
    });

    it('switches the challenge OFF when Cloudflare rejects the secret', async () => {
      // A wrong secret does not weaken the challenge, it closes the front door:
      // every signup rejected, no warning until someone tries. Exactly what
      // happened on staging when the keys went in the wrong way round.
      fetchMock.mockResolvedValue({ json: async () => ({ success: false, 'error-codes': ['invalid-input-secret'] }) });

      await expect(checkTurnstileSecret()).resolves.toBe(false);
      expect(turnstileActive()).toBe(false);
      // And signups must go through rather than being turned away.
      await expect(verifyTurnstile(undefined, '1.2.3.4')).resolves.toBe(true);
    });

    it('leaves the challenge on when Cloudflare cannot be reached at startup', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));

      await expect(checkTurnstileSecret()).resolves.toBe(true);
      expect(turnstileActive()).toBe(true);
    });

    it('has nothing to check when no secret is configured', async () => {
      cfg.config.TURNSTILE_SECRET_KEY = '';

      await expect(checkTurnstileSecret()).resolves.toBe(true);
      expect(turnstileActive()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
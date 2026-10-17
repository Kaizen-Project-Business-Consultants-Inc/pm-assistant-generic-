import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

/**
 * Cloudflare's own errors reach the page (found on staging 2026-10-17: error 110200, the hostname
 * missing from the widget, left "Checking you are a person…" showing for ever).
 */
vi.mock('../../services/api', () => ({ apiService: { getTurnstileSiteKey: vi.fn(async () => 'site-key') } }));

import { TurnstileWidget } from '../../components/auth/TurnstileWidget';

describe('TurnstileWidget', () => {
  afterEach(() => { cleanup(); delete (window as { turnstile?: unknown }).turnstile; });

  it("Cloudflare's error-callback clears the token and reports the box unavailable", async () => {
    let opts: Record<string, () => void> = {};
    window.turnstile = { render: vi.fn((_el, o) => { opts = o as typeof opts; return 'w1'; }), remove: vi.fn() };
    const onToken = vi.fn();
    const onUnavailable = vi.fn();
    render(<TurnstileWidget onToken={onToken} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(window.turnstile!.render).toHaveBeenCalled());
    opts['error-callback']();
    expect(onToken).toHaveBeenLastCalledWith(undefined);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});

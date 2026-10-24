import { describe, it, expect } from 'vitest';
import { analyticsEnabled, clarityAllowedOn } from '../../components/CookieConsentBanner';

describe('Clarity session replay records public pages only (2026-10-23)', () => {
  it('marketing pages are recorded; the app and unknown paths are not', () => {
    for (const p of ['/', '/pricing', '/pricing/', '/features', '/about', '/roadmap', '/terms', '/privacy']) {
      expect(clarityAllowedOn(p)).toBe(true);
    }
    for (const p of ['/dashboard', '/projects/123', '/settings', '/portal/abc', '/login', '/register']) {
      expect(clarityAllowedOn(p)).toBe(false);
    }
  });
});

describe('Google Analytics runs on the live site only (2026-10-02)', () => {
  it('kovarti.com counts; staging, localhost and anything else do not', () => {
    expect(analyticsEnabled('kovarti.com')).toBe(true);
    expect(analyticsEnabled('www.kovarti.com')).toBe(true);
    expect(analyticsEnabled('pm.kpbc.ca')).toBe(false);
    expect(analyticsEnabled('localhost')).toBe(false);
    expect(analyticsEnabled('kovarti.com.evil.example')).toBe(false);
  });
});

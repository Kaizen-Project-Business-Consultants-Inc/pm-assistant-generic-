import { describe, it, expect } from 'vitest';
import { analyticsEnabled } from '../../components/CookieConsentBanner';

describe('Google Analytics runs on the live site only (2026-10-02)', () => {
  it('kovarti.com counts; staging, localhost and anything else do not', () => {
    expect(analyticsEnabled('kovarti.com')).toBe(true);
    expect(analyticsEnabled('www.kovarti.com')).toBe(true);
    expect(analyticsEnabled('pm.kpbc.ca')).toBe(false);
    expect(analyticsEnabled('localhost')).toBe(false);
    expect(analyticsEnabled('kovarti.com.evil.example')).toBe(false);
  });
});

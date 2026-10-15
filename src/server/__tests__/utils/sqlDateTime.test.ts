import { describe, it, expect, vi } from 'vitest';
import { sqlDateTime, isReadableMoment } from '../../utils/sqlDateTime';

/** MariaDB DATETIME refuses ISO strings in strict mode (lessons, meetings, integration sync — 2026-10) */
describe('sqlDateTime', () => {
  it('turns an ISO moment into YYYY-MM-DD HH:MM:SS (UTC)', () => {
    expect(sqlDateTime('2026-10-14T01:31:06.703Z')).toBe('2026-10-14 01:31:06');
    expect(sqlDateTime('2026-10-14T09:31:06+08:00')).toBe('2026-10-14 01:31:06');
    expect(sqlDateTime(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02 03:04:05');
  });
  it('nothing means now', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T06:00:00Z'));
    try { expect(sqlDateTime()).toBe('2026-10-15 06:00:00'); } finally { vi.useRealTimers(); }
  });
  it('something unreadable is refused, never saved as another moment', () => {
    expect(() => sqlDateTime('next Tuesday')).toThrow(/Not a date/);
    expect(isReadableMoment('next Tuesday')).toBe(false);
    expect(isReadableMoment('2026-10-15T14:00:00Z')).toBe(true);
  });
});

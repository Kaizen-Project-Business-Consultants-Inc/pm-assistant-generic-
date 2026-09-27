import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { notificationLink } from '../../utils/notificationLink';

// The server's table, so the app and the emails can never disagree
const cases: Array<{ in: any; out: string | null }> = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '..', 'server', '__tests__', 'fixtures', 'notificationLinks.json'), 'utf-8'),
);

describe('notificationLink (bell, Notifications page, dashboard feeds)', () => {
  for (const c of cases) {
    it(`${c.in.linkType ?? '(none)'} ${JSON.stringify(c.in)} → ${c.out}`, () => {
      expect(notificationLink(c.in)).toBe(c.out);
    });
  }
});

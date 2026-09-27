import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { notificationPath } from '../../utils/notificationLink';

// Same table as the client test (src/client/src/__tests__/utils/notificationLink.test.ts)
const cases: Array<{ in: any; out: string | null }> = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'notificationLinks.json'), 'utf-8'),
);

describe('notificationPath (email "View Details" button)', () => {
  for (const c of cases) {
    it(`${c.in.linkType ?? '(none)'} ${JSON.stringify(c.in)} → ${c.out}`, () => {
      expect(notificationPath(c.in)).toBe(c.out);
    });
  }

  it('never builds the old /<type>s/<id> addresses', () => {
    for (const c of cases) expect(notificationPath(c.in) ?? '').not.toMatch(/^\/(tasks|raids|proposals|projects)\//);
  });
});

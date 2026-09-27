import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { notificationLink, alertAsNotification } from '../../utils/notificationLink';

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

describe('alertAsNotification (proactive alerts in the bell)', () => {
  it('keeps the alert text and makes "Overdue: <task>" open the task row', () => {
    const n = alertAsNotification({ description: 'Task "Gate 1" is 58 days overdue.', taskId: 't1', scheduleId: 's1' });
    expect(n.message).toBe('Task "Gate 1" is 58 days overdue.');
    expect(notificationLink({ ...n, projectId: 'p1' })).toBe('/project/p1?tab=schedule&schedule=s1&task=t1');
  });

  it('leaves project-level alerts (budget) pointing at the project', () => {
    const n = alertAsNotification({ description: 'Budget 92% used' });
    expect(n.linkType).toBeUndefined();
    expect(notificationLink({ ...n, projectId: 'p1' })).toBe('/project/p1');
  });
});

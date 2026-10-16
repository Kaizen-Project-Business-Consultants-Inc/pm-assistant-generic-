import { describe, it, expect } from 'vitest';
import { roleLabel } from '../../constants/branding';
import { WEBHOOK_EVENTS, webhookEventLabel } from '../../constants/webhookEvents';
import { formatMomentDay } from '../../utils/dateUtils';

describe('words, not code words (U2/U9)', () => {
  it('a login role code reads as words; a role someone typed is left as typed', () => {
    expect(roleLabel('team_member')).toBe('Team Member');
    expect(roleLabel('project_manager')).toBe('Project Manager');
    expect(roleLabel('pmo')).toBe('PMO');
    expect(roleLabel('qa')).toBe('QA');
    expect(roleLabel('ba')).toBe('Business Analyst');
    expect(roleLabel('devops')).toBe('DevOps');
    expect(roleLabel('site_engineer')).toBe('Site Engineer');
    expect(roleLabel('QA / Tester')).toBe('QA / Tester');
    expect(roleLabel('Structural Engineer')).toBe('Structural Engineer');
    expect(roleLabel(null)).toBe('');
  });

  it('every webhook event has plain words', () => {
    for (const e of WEBHOOK_EVENTS) expect(webhookEventLabel(e), e).not.toBe(e);
    expect(webhookEventLabel('change_request.approved')).toBe('A change request is approved');
    expect(webhookEventLabel('something.new')).toBe('something.new');
  });

  it("a moment the server sends without a zone is read as UTC, then shown on the viewer's own day", () => {
    // the tests run in UTC; the parse must not treat the text as local time
    expect(formatMomentDay('2026-10-15 23:30:00')).toBe(new Date(Date.UTC(2026, 9, 15, 23, 30)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    expect(formatMomentDay('2026-10-15T10:00:00Z')).toBe('Oct 15, 2026');
    expect(formatMomentDay('not a date')).toBe('');
    expect(formatMomentDay(null)).toBe('');
  });
});

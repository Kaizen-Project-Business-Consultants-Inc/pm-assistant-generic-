import { describe, it, expect } from 'vitest';
import { buildScheduleReviewDocx, type ScheduleReviewDocInput } from '../../utils/scheduleReviewDocxBuilder';

/**
 * This document leaves the product: a consultant attaches it to a proposal, or
 * sends it to a sponsor arguing about a plan. It has to stand on its own with no
 * access to the app, so these tests are about what a stranger can understand
 * from it — not about formatting.
 */
function input(over: Partial<ScheduleReviewDocInput> = {}): ScheduleReviewDocInput {
  return {
    projectName: 'Loan Origination Replacement',
    scheduleName: 'Baseline v2',
    score: 38,
    band: 'tracking_sheet',
    counts: { critical: 2, high: 3, medium: 1, low: 0, info: 0 },
    leafTaskCount: 48,
    findings: [
      { ruleId: 'R01', rule: 'Missing predecessor', severity: 'critical', taskIds: ['t1', 't2'], message: '19 tasks have nothing scheduled before them, so nothing tells you what slips when they slip.', pointsDeducted: 12 },
      { ruleId: 'R10', rule: 'No owner', severity: 'medium', taskIds: ['t3'], message: '7 tasks have no owner.', pointsDeducted: 4 },
    ],
    skippedRules: [
      { ruleId: 'R14', rule: 'Negative float', reason: 'needs_logic' },
    ],
    rulesVersion: '1.1',
    reviewedAt: '2026-09-21T10:00:00.000Z',
    preparedBy: 'Kaizen Project Consultants',
    ...over,
  };
}

/** Word files are zips; the text lives in word/document.xml. */
async function textOf(buf: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml.replace(/<[^>]+>/g, '');
}

describe('the schedule review as a document', () => {
  it('produces a real Word file, not just bytes', async () => {
    const buf = await buildScheduleReviewDocx(input());

    // PK.. — a zip, which is what .docx is. A corrupt file that "downloads
    // fine" is the failure a consultant would discover in front of a client.
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.length).toBeGreaterThan(2000);
  });

  it('names the project, the score and the verdict', async () => {
    const body = await textOf(await buildScheduleReviewDocx(input()));

    expect(body).toContain('Loan Origination Replacement');
    expect(body).toContain('38');
    expect(body).toContain('Tracking sheet');
  });

  it('says what the assessment is before giving a number', async () => {
    // A score from the person pitching for the work is easy to dismiss; the
    // basis for it is the whole argument.
    const body = await textOf(await buildScheduleReviewDocx(input()));

    expect(body).toContain('DCMA');
    expect(body).toMatch(/recognised scheduling practice/i);
    expect(body.indexOf('DCMA')).toBeLessThan(body.indexOf('Tracking sheet'));
  });

  it('explains the verdict in words a client can act on', async () => {
    const body = await textOf(await buildScheduleReviewDocx(input()));

    expect(body).toMatch(/list of work rather than a schedule/i);
  });

  it('carries the findings as consequences, not rule codes', async () => {
    const body = await textOf(await buildScheduleReviewDocx(input()));

    expect(body).toContain('nothing tells you what slips when they slip');
    // Internal identifiers mean nothing outside the product.
    expect(body).not.toContain('R01');
    expect(body).not.toContain('ruleId');
  });

  it('declares what it could not check', async () => {
    // A report that admits its limits is harder to argue with than one that
    // implies it examined everything.
    const body = await textOf(await buildScheduleReviewDocx(input()));

    expect(body).toContain('Negative float');
    expect(body).toMatch(/could not be assessed/i);
  });

  it('attributes the work to the consultancy', async () => {
    const body = await textOf(await buildScheduleReviewDocx(input()));
    expect(body).toContain('Kaizen Project Consultants');
  });

  it('reads sensibly for a schedule with nothing wrong', async () => {
    const body = await textOf(await buildScheduleReviewDocx(input({
      score: 92,
      band: 'fit_for_control',
      counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
      skippedRules: [],
    })));

    expect(body).toMatch(/No issues were found/i);
    expect(body).toMatch(/can be managed from/i);
  });

  it('works when the consultancy is unknown', async () => {
    const buf = await buildScheduleReviewDocx(input({ preparedBy: null, scheduleName: null }));
    const body = await textOf(buf);

    expect(body).toContain('Loan Origination Replacement');
    expect(body).not.toContain('Prepared by');
  });
});

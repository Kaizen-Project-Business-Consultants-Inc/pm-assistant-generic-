import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reportTimeline, timelineSvg, layoutTimelineStrip } from '../../utils/timelineStrip';
import { renderStatusReportHtml, type StructuredStatusReport } from '../../utils/statusReportRenderer';
import { timelineForEmail, TIMELINE_CID } from '../../utils/reportTimelineImage';
import { buildStatusReportDocx } from '../../utils/statusReportDocxBuilder';

/**
 * Status reports carry the schedule's Timeline strip (2026-10-07): on screen and in the PDF/HTML
 * downloads as an SVG, in email and Word as a picture.
 */
const tasks = [
  { id: 'p1', name: 'Discovery', startDate: '2026-06-01', endDate: '2026-07-10' },
  { id: 't1', name: 'Interviews', startDate: '2026-06-01', endDate: '2026-06-20', parentTaskId: 'p1' },
  { id: 'p2', name: 'Build <API>', startDate: '2026-07-13', endDate: '2026-09-30' },
  { id: 't2', name: 'Endpoints', startDate: '2026-07-13', endDate: '2026-09-30', parentTaskId: 'p2' },
  { id: 'm1', name: 'Go live', startDate: '2026-09-30', endDate: '2026-09-30', isMilestone: true },
];

const baseReport = (extra: Partial<StructuredStatusReport> = {}): StructuredStatusReport => ({
  reportNumber: 'SR-001', reportingPeriod: 'x', preparedBy: 'PM', executiveSummary: 'ok', areas: [], milestones: [],
  achievements: [], plannedActivities: [], managementAttention: [], changeControl: [], projectName: 'P', reportDate: 'today',
  aiPowered: false, ...extra,
});

describe('the report keeps a small timeline', () => {
  it('phases and milestones as calendar dates', () => {
    const t = reportTimeline(tasks, 'P')!;
    expect(t.start).toBe('2026-06-01');
    expect(t.end).toBe('2026-09-30');
    expect(t.phases.map(p => p.name)).toEqual(['Discovery', 'Build <API>']);
    expect(t.milestones).toEqual([{ names: ['Go live'], date: '2026-09-30' }]);
  });

  it('nothing dated → no timeline', () => {
    expect(reportTimeline([{ id: 'a', name: 'x' }], 'P')).toBeNull();
  });
});

describe('the SVG', () => {
  it('draws the phases, the milestone and today, and escapes names', () => {
    const { svg } = timelineSvg(reportTimeline(tasks, 'P')!, '2026-08-01');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('Build &lt;API&gt;');
    expect(svg).not.toContain('<API>');
    expect(svg).toContain('stroke="#dc2626"'); // today line
    expect(svg).not.toMatch(/<script|on\w+=/i);
  });

  it('bad data posted back for re-rendering gives no strip, not a crash', () => {
    expect(timelineSvg({ start: 'x', end: 'y', phases: [], milestones: [], lanes: 1 }).svg).toBe('');
    expect(() => timelineSvg({ start: '2026-01-01', end: '2026-02-01', lanes: '9' as any, phases: [{ name: 1 as any, start: 'bad', end: 'bad', lane: 'x' as any }], milestones: [{ names: 'no' as any, date: 'z' }] })).not.toThrow();
  });
});

describe('where the timeline shows', () => {
  it('on screen: after the milestones, between markers', () => {
    const html = renderStatusReportHtml(baseReport({ timeline: reportTimeline(tasks, 'P'), timelineToday: '2026-08-01' }));
    expect(html).toContain('SCHEDULE TIMELINE');
    expect(html.indexOf('MILESTONE STATUS')).toBeLessThan(html.indexOf('SCHEDULE TIMELINE'));
    expect(html).toMatch(/<!--kv-timeline--><svg[\s\S]*<\/svg><!--\/kv-timeline-->/);
  });

  it('older reports without a timeline look as before', () => {
    expect(renderStatusReportHtml(baseReport())).not.toContain('SCHEDULE TIMELINE');
  });

  it('in email the SVG becomes an embedded picture', async () => {
    const html = renderStatusReportHtml(baseReport({ timeline: reportTimeline(tasks, 'P') }));
    const out = await timelineForEmail(html);
    expect(out.html).not.toContain('<svg');
    expect(out.html).toContain(`src="cid:${TIMELINE_CID}"`);
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0]).toMatchObject({ contentId: TIMELINE_CID, contentType: 'image/png' });
    expect(Buffer.from(out.attachments[0].content, 'base64').subarray(1, 4).toString()).toBe('PNG');
  }, 30_000);

  it('in Word as a picture', async () => {
    const buf = await buildStatusReportDocx(baseReport({ timeline: reportTimeline(tasks, 'P') }));
    const withoutTimeline = await buildStatusReportDocx(baseReport());
    expect(buf.length).toBeGreaterThan(withoutTimeline.length + 1000); // the PNG is inside
    expect(buf.includes(Buffer.from('word/media/'))).toBe(true);
  }, 30_000);
});

describe('one layout for the Gantt strip and the report', () => {
  it('layoutTimelineStrip and placeLabels are the same code in client and server', () => {
    const client = readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'components', 'schedule', 'gantt', 'timelineStrip.ts'), 'utf-8');
    const server = readFileSync(join(__dirname, '..', '..', 'utils', 'timelineStrip.ts'), 'utf-8');
    const fn = (src: string, name: string) => {
      const i = src.indexOf(`export function ${name}(`);
      const j = src.indexOf('\n}\n', i);
      return src.slice(i, j).replace(/\r/g, '');
    };
    for (const name of ['layoutTimelineStrip', 'placeLabels']) expect(fn(server, name), name).toBe(fn(client, name));
    expect(layoutTimelineStrip(tasks, 'P')!.phases).toHaveLength(2);
  });
});

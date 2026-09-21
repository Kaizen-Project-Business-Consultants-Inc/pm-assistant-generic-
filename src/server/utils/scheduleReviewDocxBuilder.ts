/**
 * Builds a Word (.docx) version of a Schedule Review.
 *
 * This document leaves the product. A consultant attaches it to a proposal, or
 * sends it to a sponsor who is arguing about a plan — so it has to stand on its
 * own with no access to the app and no prior explanation. That drives three
 * things the on-screen panel does not need:
 *
 *  - it says what the assessment IS before it says what the score is, because a
 *    number from the person pitching for the work is easy to dismiss;
 *  - every finding is written as a consequence ("nothing tells you what slips
 *    when this task slips"), not as a rule name;
 *  - it states plainly what was NOT assessed. A report that declares its limits
 *    is harder to argue with than one that implies it checked everything.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, WidthType, AlignmentType, BorderStyle,
  ShadingType, TableLayoutType, convertInchesToTwip,
} from 'docx';
import type { Band, Severity, Finding, SkippedRule } from '../services/scheduleReview/rules';

const NAVY = '283480';
const WHITE = 'FFFFFF';
const BODY_TEXT = '1F2937';
const GRAY = '6B7280';
const BORDER_COLOR = 'D1D5DB';
const LABEL_BG = 'EAECF6';

const GREEN = '15803D';
const AMBER = 'B45309';
const RED = 'B91C1C';

const BAND_COLOR: Record<Band, string> = {
  fit_for_control: GREEN,
  controllable: GREEN,
  needs_work: AMBER,
  tracking_sheet: RED,
};

/**
 * What the band means to somebody who has never seen this product. The on-screen
 * labels ("Tracking sheet") are shorthand for people who already know what the
 * review does; a client reading a PDF does not.
 */
const BAND_VERDICT: Record<Band, string> = {
  fit_for_control:
    'This plan can be managed from. Dependencies are in place, ownership is clear, and a delay to one item will show its effect on the rest.',
  controllable:
    'This plan is usable, with gaps worth closing. Most of the structure needed to manage delivery is present.',
  needs_work:
    'This plan is not yet something you can manage from. Enough structure is missing that a slip in one place will not reliably show up anywhere else.',
  tracking_sheet:
    'This is a list of work rather than a schedule. It records what is intended, but it cannot tell you the effect of a delay, or what has to happen before what.',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'For information',
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: RED,
  high: RED,
  medium: AMBER,
  low: GRAY,
  info: GRAY,
};

const SKIP_REASON: Record<SkippedRule['reason'], string> = {
  covered_by_R03: 'not assessed separately — the schedule has no dependencies at all, which is reported above',
  needs_logic: 'could not be assessed — it requires dependencies between tasks, and this schedule has none',
  no_data: 'could not be assessed — the schedule does not carry the information this check needs',
};

const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
} as const;

function text(value: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text: value,
    bold: opts.bold,
    size: opts.size ?? 22,
    color: opts.color ?? BODY_TEXT,
    font: 'Calibri',
  });
}

function para(value: string, opts: { bold?: boolean; size?: number; color?: string; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    children: [text(value, opts)],
    spacing: { after: opts.after ?? 120 },
    alignment: opts.align,
  });
}

function heading(value: string): Paragraph {
  return new Paragraph({
    children: [text(value, { bold: true, size: 26, color: NAVY })],
    spacing: { before: 320, after: 140 },
  });
}

function cell(children: Paragraph[], opts: { width?: number; shading?: string } = {}): TableCell {
  return new TableCell({
    children,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    borders: THIN_BORDER,
    shading: opts.shading ? { type: ShadingType.CLEAR, fill: opts.shading, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });
}

export interface ScheduleReviewDocInput {
  projectName: string;
  scheduleName?: string | null;
  score: number;
  band: Band;
  counts: Record<Severity, number>;
  leafTaskCount: number;
  findings: Finding[];
  skippedRules: SkippedRule[];
  rulesVersion: string;
  reviewedAt: string;
  /** The consultancy, when known — this is their document, not ours. */
  preparedBy?: string | null;
}

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export async function buildScheduleReviewDocx(input: ScheduleReviewDocInput): Promise<Buffer> {
  const children: Paragraph[] | (Paragraph | Table)[] = [];
  const reviewedOn = new Date(input.reviewedAt).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // --- Title -------------------------------------------------------------
  children.push(new Paragraph({
    children: [text('Schedule Review', { bold: true, size: 40, color: NAVY })],
    spacing: { after: 60 },
  }));
  children.push(para(input.projectName, { bold: true, size: 28 }));
  if (input.scheduleName) children.push(para(input.scheduleName, { color: GRAY }));
  children.push(para(
    `Reviewed ${reviewedOn}${input.preparedBy ? ` · Prepared by ${input.preparedBy}` : ''}`,
    { color: GRAY, size: 20, after: 280 },
  ));

  // --- What this is, before the number ----------------------------------
  // Credibility first. A score presented without its basis reads as an opinion.
  children.push(heading('What this assessment is'));
  children.push(para(
    `This schedule was assessed against ${countRules(input)} checks drawn from recognised scheduling practice, ` +
    'including the DCMA 14-point assessment used on major government and defence programmes. ' +
    'The checks are applied mechanically: the same schedule always produces the same score, and no judgement ' +
    'about the project, its team or its subject matter is involved.',
  ));
  children.push(para(
    `The assessment covered ${input.leafTaskCount} ${input.leafTaskCount === 1 ? 'item' : 'items'} of work.`,
    { after: 200 },
  ));

  // --- Score -------------------------------------------------------------
  children.push(heading('Result'));
  children.push(new Paragraph({
    children: [
      text(`${input.score}`, { bold: true, size: 72, color: BAND_COLOR[input.band] }),
      text(' / 100    ', { size: 32, color: GRAY }),
      text(bandLabel(input.band), { bold: true, size: 28, color: BAND_COLOR[input.band] }),
    ],
    spacing: { after: 140 },
  }));
  children.push(para(BAND_VERDICT[input.band], { after: 240 }));

  // --- Counts ------------------------------------------------------------
  const present = SEVERITY_ORDER.filter(s => (input.counts[s] ?? 0) > 0);
  if (present.length > 0) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          children: present.map(s => cell(
            [para(SEVERITY_LABEL[s], { bold: true, size: 20, color: NAVY, after: 0, align: AlignmentType.CENTER })],
            { width: 100 / present.length, shading: LABEL_BG },
          )),
        }),
        new TableRow({
          children: present.map(s => cell(
            [para(String(input.counts[s]), { bold: true, size: 32, color: SEVERITY_COLOR[s], after: 0, align: AlignmentType.CENTER })],
            { width: 100 / present.length },
          )),
        }),
      ],
    }) as any);
    children.push(para('', { after: 120 }) as any);
  }

  // --- Findings ----------------------------------------------------------
  if (input.findings.length === 0) {
    children.push(heading('Findings'));
    children.push(para('No issues were found. Every check that could be applied to this schedule passed.'));
  } else {
    children.push(heading('What was found'));
    children.push(para(
      'Findings are ordered by how much they affect your ability to manage delivery. ' +
      'Each one names the practice that was not met and what it costs you in practice.',
      { color: GRAY, size: 20, after: 200 },
    ));

    for (const severity of SEVERITY_ORDER) {
      const group = input.findings.filter(f => f.severity === severity);
      if (group.length === 0) continue;

      children.push(new Paragraph({
        children: [text(`${SEVERITY_LABEL[severity]} (${group.length})`, { bold: true, size: 24, color: SEVERITY_COLOR[severity] })],
        spacing: { before: 240, after: 100 },
      }));

      for (const finding of group) {
        children.push(new Paragraph({
          children: [
            text(`${finding.rule}. `, { bold: true }),
            text(finding.message),
          ],
          bullet: { level: 0 },
          spacing: { after: 80 },
        }));
      }
    }
  }

  // --- Limits ------------------------------------------------------------
  // Declaring what was not checked is what separates an assessment from a claim.
  if (input.skippedRules.length > 0) {
    children.push(heading('What this assessment could not cover'));
    children.push(para(
      'These checks were not applied. They are listed so that the score is not read as a clean bill of health on points it never examined.',
      { color: GRAY, size: 20, after: 140 },
    ));
    for (const skipped of input.skippedRules) {
      children.push(new Paragraph({
        children: [
          text(`${skipped.rule} — `, { bold: true }),
          text(SKIP_REASON[skipped.reason] ?? 'not assessed'),
        ],
        bullet: { level: 0 },
        spacing: { after: 80 },
      }));
    }
  }

  // --- Method ------------------------------------------------------------
  children.push(heading('Method'));
  children.push(para(
    'Each check carries a weight reflecting how much it affects control of delivery. Findings are pooled per check ' +
    'and scaled by the proportion of work affected, so one missing owner does not count the same as fifty. ' +
    'The score is what remains out of 100 once those deductions are applied.',
  ));
  children.push(para(
    `Assessment ruleset version ${input.rulesVersion}. Produced with Kovarti PM.`,
    { color: GRAY, size: 18, after: 0 },
  ));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.75),
            bottom: convertInchesToTwip(0.75),
            left: convertInchesToTwip(0.75),
            right: convertInchesToTwip(0.75),
          },
        },
      },
      children: children as any,
    }],
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, color: BODY_TEXT } },
      },
    },
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

function bandLabel(band: Band): string {
  return {
    fit_for_control: 'Fit for control',
    controllable: 'Controllable',
    needs_work: 'Needs work',
    tracking_sheet: 'Tracking sheet',
  }[band];
}

/** Checks applied = those that produced findings plus those that passed silently. */
function countRules(input: ScheduleReviewDocInput): number {
  return 28 - input.skippedRules.length;
}

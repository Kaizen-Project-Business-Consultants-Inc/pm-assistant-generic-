/**
 * Builds a professional Word (.docx) document from structured status report data.
 * Uses the `docx` package for full control over styling, colors, and layout.
 * Matches the DBJ_LMS_Status_Report.docx template.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, WidthType, AlignmentType, BorderStyle,
  ShadingType, HeadingLevel, TableLayoutType,
  convertInchesToTwip,
} from 'docx';
import type { StructuredStatusReport } from './statusReportRenderer';

// ---------------------------------------------------------------------------
// DBJ Template colours (hex without #)
// ---------------------------------------------------------------------------
const NAVY = '283480';
const LABEL_BG = 'EAECF6';
const GREEN_BG = 'A8D5A2';
const AMBER_BG = 'FFD966';
const RED_BG = 'FF9B9B';
const WHITE = 'FFFFFF';
const BODY_TEXT = '1F2937';
const GRAY = '6B7280';
const BORDER_COLOR = 'D1D5DB';

const RAG_COLORS: Record<string, string> = {
  green: GREEN_BG,
  amber: AMBER_BG,
  red: RED_BG,
};

const TREND_ARROWS: Record<string, string> = {
  improving: '\u2191',
  stable: '\u2192',
  declining: '\u2193',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
} as const;

const NAVY_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
  left: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
  right: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
} as const;

function headerCell(text: string, widthPct?: number): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: WHITE, size: 22, font: 'Calibri' })],
      spacing: { before: 40, after: 40 },
    })],
    shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
    borders: NAVY_BORDER,
    ...(widthPct ? { width: { size: widthPct, type: WidthType.PERCENTAGE } } : {}),
  });
}

function dataCell(text: string, opts?: { bold?: boolean; bg?: string; center?: boolean; widthPct?: number; italic?: boolean; color?: string }): TableCell {
  const { bold, bg, center, widthPct, italic, color } = opts || {};
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: bold || false,
        italics: italic || false,
        color: color || BODY_TEXT,
        size: 22,
        font: 'Calibri',
      })],
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 40, after: 40 },
    })],
    borders: THIN_BORDER,
    ...(bg ? { shading: { type: ShadingType.SOLID, color: bg, fill: bg } } : {}),
    ...(widthPct ? { width: { size: widthPct, type: WidthType.PERCENTAGE } } : {}),
  });
}

function ragCell(status: string, widthPct?: number): TableCell {
  const letter = status === 'green' ? 'G' : status === 'amber' ? 'A' : 'R';
  const bg = RAG_COLORS[status] || AMBER_BG;
  return dataCell(letter, { bold: true, bg, center: true, widthPct });
}

function sectionHeading(num: number, title: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({
      text: `${num}. ${title}`,
      bold: true,
      color: NAVY,
      size: 28,
      font: 'Calibri',
    })],
    spacing: { before: 360, after: 120 },
    keepNext: true,
  });
}

function bulletItem(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, color: BODY_TEXT, size: 22, font: 'Calibri' })],
    bullet: { level: 0 },
    spacing: { before: 40, after: 40 },
  });
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
export async function buildStatusReportDocx(report: StructuredStatusReport): Promise<Buffer> {
  const {
    reportNumber, reportingPeriod, preparedBy, executiveSummary, areas,
    milestones, achievements, plannedActivities, managementAttention,
    changeControl, projectName, reportDate, aiPowered,
  } = report;

  const children: (Paragraph | Table)[] = [];

  // --- Title banner ---
  children.push(new Table({
    rows: [new TableRow({
      children: [new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({
              text: 'PROJECT STATUS REPORT',
              bold: true,
              color: WHITE,
              size: 36,
              font: 'Calibri',
            })],
            spacing: { before: 160, after: 0 },
          }),
          new Paragraph({
            children: [new TextRun({
              text: projectName,
              color: WHITE,
              size: 22,
              font: 'Calibri',
            })],
            spacing: { before: 60, after: 160 },
          }),
        ],
        shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
        borders: NAVY_BORDER,
        width: { size: 100, type: WidthType.PERCENTAGE },
      })],
    })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    indent: { size: 0, type: WidthType.DXA },
  }));

  // Spacer between banner and metadata
  children.push(new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }));

  // --- Metadata grid ---
  const metaRow = (label1: string, val1: string, label2: string, val2: string) =>
    new TableRow({
      children: [
        dataCell(label1, { bold: true, bg: LABEL_BG, widthPct: 18 }),
        dataCell(val1, { widthPct: 32 }),
        dataCell(label2, { bold: true, bg: LABEL_BG, widthPct: 18 }),
        dataCell(val2, { widthPct: 32 }),
      ],
    });

  children.push(new Table({
    rows: [
      metaRow('Report No.', reportNumber, 'Reporting Period', reportingPeriod),
      metaRow('Date Issued', reportDate, 'Prepared By', preparedBy),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    indent: { size: 0, type: WidthType.DXA },
  }));

  // --- 1. Executive Summary ---
  children.push(sectionHeading(1, 'EXECUTIVE SUMMARY'));
  children.push(new Paragraph({
    children: [new TextRun({ text: executiveSummary, color: BODY_TEXT, size: 24, font: 'Calibri' })],
    spacing: { before: 0, after: 120 },
  }));

  // --- 2. Overall Status (RAG Table) ---
  children.push(sectionHeading(2, 'OVERALL STATUS'));

  const ragHeaderRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      headerCell('Dimension', 30),
      headerCell('This Period', 10),
      headerCell('Last Period', 10),
      headerCell('Trend', 8),
      headerCell('Commentary', 42),
    ],
  });

  const ragDataRows = areas.map(area => {
    const trend = area.trend || 'stable';
    const trendArrow = TREND_ARROWS[trend] || '\u2192';
    const isOverall = area.name === 'Overall Status';
    const prevCell = area.previousStatus
      ? ragCell(area.previousStatus, 10)
      : dataCell('\u2014', { center: true, widthPct: 10 });

    return new TableRow({
      children: [
        dataCell(area.name, { bold: isOverall, bg: isOverall ? LABEL_BG : undefined, widthPct: 30 }),
        ragCell(area.status, 10),
        prevCell,
        dataCell(trendArrow, { bold: true, center: true, widthPct: 8 }),
        dataCell(area.comments, { widthPct: 42 }),
      ],
    });
  });

  children.push(new Table({
    rows: [ragHeaderRow, ...ragDataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    indent: { size: 0, type: WidthType.DXA },
  }));

  // RAG Legend
  children.push(new Table({
    rows: [new TableRow({
      children: [
        dataCell('G', { bold: true, bg: GREEN_BG, center: true }),
        dataCell('On track \u2014 no intervention required'),
        dataCell('A', { bold: true, bg: AMBER_BG, center: true }),
        dataCell('At risk \u2014 recoverable within the team'),
        dataCell('R', { bold: true, bg: RED_BG, center: true }),
        dataCell('Off track \u2014 management action needed'),
      ],
    })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    indent: { size: 0, type: WidthType.DXA },
  }));

  // --- 3. Milestone Status ---
  children.push(sectionHeading(3, 'MILESTONE STATUS'));

  const msHeaderRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      headerCell('M#', 6),
      headerCell('Milestone Deliverable', 34),
      headerCell('Sched. Week', 12),
      headerCell('Due Date', 12),
      headerCell('Status', 12),
      headerCell('Comments', 24),
    ],
  });

  const msDataRows = milestones.length > 0
    ? milestones.map(m => new TableRow({
        children: [
          dataCell(m.ref, { center: true, widthPct: 6 }),
          dataCell(m.name, { widthPct: 34 }),
          dataCell(m.schedWeek, { center: true, widthPct: 12 }),
          dataCell(m.dueDate, { widthPct: 12 }),
          dataCell(m.status, { widthPct: 12 }),
          dataCell(m.comments, { widthPct: 24 }),
        ],
      }))
    : [new TableRow({
        children: [new TableCell({
          children: [new Paragraph({
            children: [new TextRun({
              text: 'No milestones defined \u2014 mark tasks as milestones in the schedule to populate this section.',
              italics: true, color: GRAY, size: 22, font: 'Calibri',
            })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 40 },
          })],
          borders: THIN_BORDER,
          columnSpan: 6,
        })],
      })];

  children.push(new Table({
    rows: [msHeaderRow, ...msDataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    indent: { size: 0, type: WidthType.DXA },
  }));

  children.push(new Paragraph({
    children: [new TextRun({
      text: 'A milestone is Complete only on formal acceptance. Submission alone does not close it.',
      italics: true, color: GRAY, size: 20, font: 'Calibri',
    })],
    spacing: { before: 60, after: 0 },
  }));

  // --- 5. Achievements This Period ---
  if (achievements.length > 0) {
    children.push(sectionHeading(5, 'ACHIEVEMENTS THIS PERIOD'));
    achievements.forEach(a => children.push(bulletItem(a)));
  }

  // --- 6. Planned Activities — Next Period ---
  if (plannedActivities.length > 0) {
    children.push(sectionHeading(6, 'PLANNED ACTIVITIES \u2014 NEXT PERIOD'));
    plannedActivities.forEach(a => children.push(bulletItem(a)));
  }

  // --- 7. For Management Attention ---
  if (managementAttention.length > 0) {
    children.push(sectionHeading(7, 'FOR MANAGEMENT ATTENTION'));
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'Matters requiring a management decision or intervention. Each carries a named owner, a date needed, and the stated consequence of delay.',
        color: GRAY, size: 22, font: 'Calibri',
      })],
      spacing: { before: 0, after: 120 },
    }));

    const mgmtHeaderRow = new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        headerCell('Ref', 8),
        headerCell('Matter Requiring Attention', 32),
        headerCell('Raised', 10),
        headerCell('Owner', 12),
        headerCell('Date Needed', 12),
        headerCell('Impact if Delayed', 26),
      ],
    });

    const mgmtDataRows = managementAttention.map(item => new TableRow({
      children: [
        dataCell(item.ref, { widthPct: 8 }),
        dataCell(item.matter, { widthPct: 32 }),
        dataCell(item.raised, { widthPct: 10 }),
        dataCell(item.owner, { widthPct: 12 }),
        dataCell(item.dateNeeded, { widthPct: 12 }),
        dataCell(item.impactIfDelayed, { widthPct: 26 }),
      ],
    }));

    children.push(new Table({
      rows: [mgmtHeaderRow, ...mgmtDataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      indent: { size: 0, type: WidthType.DXA },
    }));
  }

  // --- 8. Change Control ---
  if (changeControl.length > 0) {
    children.push(sectionHeading(8, 'CHANGE CONTROL'));
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'Requests that alter scope, schedule, or cost.',
        color: GRAY, size: 22, font: 'Calibri',
      })],
      spacing: { before: 0, after: 120 },
    }));

    const ccHeaderRow = new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        headerCell('CR Ref', 10),
        headerCell('Description', 40),
        headerCell('Status', 16),
        headerCell('Schedule Impact', 17),
        headerCell('Cost Impact', 17),
      ],
    });

    const ccDataRows = changeControl.map(cr => new TableRow({
      children: [
        dataCell(cr.ref, { widthPct: 10 }),
        dataCell(cr.description, { widthPct: 40 }),
        dataCell(cr.status, { widthPct: 16 }),
        dataCell(cr.scheduleImpact, { widthPct: 17 }),
        dataCell(cr.costImpact, { widthPct: 17 }),
      ],
    }));

    children.push(new Table({
      rows: [ccHeaderRow, ...ccDataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      indent: { size: 0, type: WidthType.DXA },
    }));
  }

  // --- Footer ---
  children.push(new Paragraph({
    children: [new TextRun({
      text: `${aiPowered ? 'AI-Generated Report' : 'Template Report (AI unavailable)'} \u2014 Kovarti PM Assistant`,
      color: '9CA3AF',
      size: 18,
      font: 'Calibri',
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 360, after: 0 },
  }));

  // --- Build document ---
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
      children,
    }],
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: BODY_TEXT },
        },
      },
    },
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

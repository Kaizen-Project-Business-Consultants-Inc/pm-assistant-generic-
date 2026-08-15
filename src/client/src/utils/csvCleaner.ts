/**
 * Smart CSV cleaner for Excel/CSV imports.
 *
 * Many real-world spreadsheets have title rows, section headers, and footers
 * that break CSV importers expecting headers on row 1. This utility:
 *
 * 1. Auto-detects the real header row (looks for rows with multiple
 *    column-like terms such as "name", "date", "task", "start", etc.)
 * 2. Strips preamble rows above the detected header
 * 3. Strips non-data rows (section headers where only 1-2 columns have content,
 *    empty rows, and footer text)
 * 4. Returns clean CSV ready for the import API
 */

// Terms that commonly appear in header rows of schedule spreadsheets
const HEADER_TERMS = [
  'name', 'task', 'activity', 'activities', 'title', 'phase',
  'status', 'priority',
  'start', 'end', 'due', 'date', 'deadline',
  'assigned', 'owner', 'resource', 'assignee',
  'description', 'deliverable', 'deliverables', 'notes',
  'progress', 'duration', 'hours', 'days',
  'dependency', 'predecessor',
];

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function scoreAsHeaderRow(cells: string[]): number {
  let matches = 0;
  for (const cell of cells) {
    const lower = cell.toLowerCase().replace(/[^a-z]/g, ' ');
    const words = lower.split(/\s+/);
    for (const word of words) {
      if (HEADER_TERMS.includes(word)) {
        matches++;
        break; // count at most one match per cell
      }
    }
  }
  return matches;
}

function isDataRow(cells: string[], columnCount: number): boolean {
  // A data row should have content in at least 3 columns (or >40% of columns)
  const nonEmpty = cells.filter(c => c.length > 0).length;
  const threshold = Math.max(3, Math.ceil(columnCount * 0.4));
  return nonEmpty >= threshold;
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Fix common UTF-8 mojibake from Windows-1252 encoded files. */
function fixMojibake(text: string): string {
  return text
    .replace(/\u00E2\u0080\u0094/g, '\u2014')  // â€" → — (em dash)
    .replace(/\u00E2\u0080\u0093/g, '\u2013')  // â€" → – (en dash)
    .replace(/\u00E2\u0080\u0099/g, '\u2019')  // â€™ → ' (right single quote)
    .replace(/\u00E2\u0080\u0098/g, '\u2018')  // â€˜ → ' (left single quote)
    .replace(/\u00E2\u0080\u009C/g, '\u201C')  // â€œ → " (left double quote)
    .replace(/\u00E2\u0080\u009D/g, '\u201D')  // â€ → " (right double quote)
    .replace(/\u00E2\u0080\u00A2/g, '\u2022')  // â€¢ → • (bullet)
    .replace(/\u00E2\u0080\u00A6/g, '\u2026')  // â€¦ → … (ellipsis)
    .replace(/\u00C2\u00B7/g, '\u00B7')         // Â· → · (middle dot)
    .replace(/\u00C2\u00A0/g, ' ');             // Â  → (non-breaking space)
}

/**
 * Convert an XLSX sheet to CSV, collapsing multi-line cell values into single
 * lines. XLSX.utils.sheet_to_csv preserves newlines inside cells, which breaks
 * line-based CSV parsers. This function uses sheet_to_json (which keeps cell
 * values intact) and re-serialises to clean single-line CSV.
 */
export function sheetToCsv(XLSX: any, sheet: any): string {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  return rows.map(row =>
    (row as unknown[]).map(c => {
      if (c == null) return '';
      const s = String(c).replace(/[\r\n]+/g, ' ').trim();
      return escapeCsvCell(s);
    }).join(',')
  ).join('\n');
}

export function cleanCsvForImport(rawCsv: string): string {
  const lines = fixMojibake(rawCsv).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return rawCsv;

  // Find the best header row (highest score, at least 3 matches)
  let headerIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cells = splitCsvLine(lines[i]);
    const score = scoreAsHeaderRow(cells);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = i;
    }
  }

  // If no good header found (score < 2), assume row 0 is the header
  if (bestScore < 2) {
    headerIndex = 0;
  }

  const headerCells = splitCsvLine(lines[headerIndex]);
  const columnCount = headerCells.length;

  // Build clean CSV: header + data rows only
  const cleanLines: string[] = [headerCells.map(escapeCsvCell).join(',')];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (isDataRow(cells, columnCount)) {
      // Pad or trim to match header column count
      const row = headerCells.map((_, idx) => escapeCsvCell(cells[idx] || ''));
      cleanLines.push(row.join(','));
    }
  }

  return cleanLines.join('\n');
}

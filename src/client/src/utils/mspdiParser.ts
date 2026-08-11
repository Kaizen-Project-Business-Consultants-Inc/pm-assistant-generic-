/**
 * Client-side parser for Microsoft Project XML (MSPDI) files.
 * Extracts tasks, hierarchy, dependencies, and durations from .xml exports.
 */

export interface MspdiTask {
  uid: number;
  name: string;
  wbs?: string;
  outlineLevel: number;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  duration?: number;  // days
  percentComplete?: number;
  predecessors: string; // e.g. "3FS+2d"
}

interface RawPredecessor {
  predecessorUID: number;
  type: number; // 0=FF, 1=FS, 2=SF, 3=SS
  lagDays: number;
}

const DEP_TYPE_MAP: Record<number, string> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };

function getElementText(parent: Element, tagName: string): string | null {
  // Search in all namespaces
  const el = parent.getElementsByTagName(tagName)[0]
    || parent.querySelector(tagName);
  return el?.textContent?.trim() || null;
}

/**
 * Parse ISO 8601 duration (PT8H0M0S or P5D) to days.
 */
function parseDuration(dur: string | null): number | undefined {
  if (!dur) return undefined;

  // P{n}D format
  const dayMatch = dur.match(/P(\d+)D/);
  if (dayMatch) return parseInt(dayMatch[1]);

  // PT{h}H{m}M{s}S format — convert hours to days (8h = 1 day)
  const hourMatch = dur.match(/PT(\d+)H/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    return Math.max(1, Math.round(hours / 8));
  }

  return undefined;
}

function parseDate(dateStr: string | null): string | undefined {
  if (!dateStr) return undefined;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

function parseLagDuration(dur: string | null): number {
  if (!dur) return 0;
  // PT{n}H0M0S → days (n/8), or PT0H{n}M0S → days
  const hourMatch = dur.match(/PT(\d+)H/);
  if (hourMatch) return Math.round(parseInt(hourMatch[1]) / 8);
  const dayMatch = dur.match(/P(\d+)D/);
  if (dayMatch) return parseInt(dayMatch[1]);
  return 0;
}

export function parseMspdi(xmlString: string): MspdiTask[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML: ' + (parseError.textContent?.slice(0, 200) || 'parse error'));
  }

  // Find all Task elements (handle namespace)
  const taskElements = doc.getElementsByTagName('Task');
  if (taskElements.length === 0) {
    throw new Error('No <Task> elements found in XML');
  }

  const tasks: MspdiTask[] = [];

  for (let i = 0; i < taskElements.length; i++) {
    const el = taskElements[i];

    const uid = parseInt(getElementText(el, 'UID') || '0');
    if (uid === 0) continue; // Skip project summary (UID=0)

    const name = getElementText(el, 'Name');
    if (!name) continue;

    const outlineLevel = parseInt(getElementText(el, 'OutlineLevel') || '1');
    const startDate = parseDate(getElementText(el, 'Start'));
    const endDate = parseDate(getElementText(el, 'Finish'));
    const duration = parseDuration(getElementText(el, 'Duration'));
    const percentComplete = parseInt(getElementText(el, 'PercentComplete') || '0');
    const wbs = getElementText(el, 'WBS') || undefined;

    // Parse predecessors
    const predElements = el.getElementsByTagName('PredecessorLink');
    const preds: RawPredecessor[] = [];
    for (let j = 0; j < predElements.length; j++) {
      const pred = predElements[j];
      const predUID = parseInt(getElementText(pred, 'PredecessorUID') || '0');
      const type = parseInt(getElementText(pred, 'Type') || '1');
      const lagDays = parseLagDuration(getElementText(pred, 'LinkLag') || getElementText(pred, 'LagDuration'));
      if (predUID > 0) {
        preds.push({ predecessorUID: predUID, type, lagDays });
      }
    }

    // Build predecessor string in "3FS+2d" format
    const predecessorStr = preds
      .map(p => {
        const depType = DEP_TYPE_MAP[p.type] || 'FS';
        const lag = p.lagDays > 0 ? `+${p.lagDays}d` : p.lagDays < 0 ? `${p.lagDays}d` : '';
        return `${p.predecessorUID}${depType}${lag}`;
      })
      .join(',');

    tasks.push({
      uid,
      name,
      wbs,
      outlineLevel,
      startDate,
      endDate,
      duration,
      percentComplete,
      predecessors: predecessorStr,
    });
  }

  return tasks;
}

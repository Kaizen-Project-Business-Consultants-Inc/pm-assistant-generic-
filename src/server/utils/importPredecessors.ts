/**
 * Predecessor parsing and resolution for schedule imports.
 *
 * Import files express dependencies as tokens like "3FS+2d", "5", "1.2SS" or a
 * task name. This module turns those tokens into structured refs (pure parse)
 * and resolves them against the tasks that were just imported (pure lookup).
 * Kept free of DB/service calls so it can be unit-tested in isolation.
 */

export type DepType = 'FS' | 'FF' | 'SS' | 'SF';

export interface ParsedPredecessor {
  /** The original token, verbatim, for error reporting. */
  raw: string;
  /** The reference portion: a number, a WBS code, or a task name. */
  ref: string;
  refKind: 'number' | 'wbs' | 'name';
  type: DepType;
  lagDays: number;
}

export interface PredecessorLookups {
  /** Row number or MS Project UID (as a string) → task id. */
  byRef?: Map<string, string>;
  /** WBS code (e.g. "1.2") → task id. */
  byWbs?: Map<string, string>;
  /** Lower-cased task name → task id. */
  byName?: Map<string, string>;
}

export interface ResolvedPredecessor {
  taskId: string;
  type: DepType;
  lagDays: number;
}

/** A single row may not declare more predecessors than this; extras are reported. */
export const MAX_PREDECESSORS_PER_ROW = 20;

const DEP_TYPES: DepType[] = ['FS', 'FF', 'SS', 'SF'];

/** Numeric or dotted-WBS ref, optional dep type, optional signed lag in days. */
const NUMERIC_TOKEN = /^(\d+(?:\.\d+)*)(FS|FF|SS|SF)?(?:([+-]\d+)\s*d?)?$/i;

/**
 * Parse a raw predecessor string ("3FS+2d,5SS" or "Design, 7") into structured
 * tokens. Never throws; unrecognised fragments are dropped.
 */
export function parsePredecessorTokens(raw: string | null | undefined): ParsedPredecessor[] {
  if (!raw || !raw.trim()) return [];

  const out: ParsedPredecessor[] = [];
  const fragments = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);

  for (const frag of fragments) {
    const compact = frag.replace(/\s+/g, '');
    const m = compact.match(NUMERIC_TOKEN);
    if (m) {
      const ref = m[1];
      const type = (m[2]?.toUpperCase() as DepType) || 'FS';
      const lagDays = m[3] ? parseInt(m[3], 10) : 0;
      out.push({
        raw: frag,
        ref,
        refKind: ref.includes('.') ? 'wbs' : 'number',
        type: DEP_TYPES.includes(type) ? type : 'FS',
        lagDays: Number.isFinite(lagDays) ? lagDays : 0,
      });
    } else {
      // A task-name reference. Names rarely carry a dep type or lag, so keep the
      // whole fragment as the name and default to finish-to-start, no lag.
      out.push({ raw: frag, ref: frag, refKind: 'name', type: 'FS', lagDays: 0 });
    }
  }

  return out;
}

/**
 * Resolve a parsed predecessor to a task id using the supplied lookups.
 * Order: numeric ref (row/uid, then WBS) → WBS → exact name. Returns null when
 * the reference cannot be matched.
 */
export function resolvePredecessor(
  p: ParsedPredecessor,
  lookups: PredecessorLookups,
): ResolvedPredecessor | null {
  let taskId: string | undefined;

  if (p.refKind === 'number') {
    taskId = lookups.byRef?.get(p.ref) ?? lookups.byWbs?.get(p.ref);
  } else if (p.refKind === 'wbs') {
    taskId = lookups.byWbs?.get(p.ref);
  } else {
    taskId = lookups.byName?.get(p.ref.toLowerCase());
  }

  if (!taskId) return null;
  return { taskId, type: p.type, lagDays: p.lagDays };
}

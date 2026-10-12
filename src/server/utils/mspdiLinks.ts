/**
 * Microsoft Project XML (MSPDI) link types — `<PredecessorLink><Type>`: 0 = FF, 1 = FS, 2 = SF,
 * 3 = SS (Microsoft's schema). The export had SS and SF the wrong way round (2 = SS, 3 = SF), so
 * every start-to-start link opened in MS Project as start-to-finish and back (2026-10-12). The
 * import (client utils/mspdiParser.ts) reads the same numbers; a round-trip test keeps them together.
 */
export const MSPDI_LINK_TYPE: Readonly<Record<'FF' | 'FS' | 'SF' | 'SS', number>> = { FF: 0, FS: 1, SF: 2, SS: 3 };

/** MSPDI lag is in tenths of a minute; with LagFormat 7 (days) a working day is 8 hours */
const TENTHS_OF_A_MINUTE_PER_DAY = 8 * 60 * 10;

/** One `<PredecessorLink>` element (an unknown type is written as FS, MS Project's default) */
export function mspdiPredecessorLink(predecessorUid: number, dependencyType: string | null | undefined, lagDays: number | null | undefined): string {
  const type = MSPDI_LINK_TYPE[(dependencyType || 'FS').toUpperCase() as keyof typeof MSPDI_LINK_TYPE] ?? MSPDI_LINK_TYPE.FS;
  const lag = (lagDays || 0) * TENTHS_OF_A_MINUTE_PER_DAY;
  return `<PredecessorLink><PredecessorUID>${predecessorUid}</PredecessorUID><Type>${type}</Type><LinkLag>${lag}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`;
}

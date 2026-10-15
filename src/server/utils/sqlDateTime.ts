/**
 * A moment as MariaDB's DATETIME wants it: 'YYYY-MM-DD HH:MM:SS' in UTC. An ISO string
 * ('2026-10-14T01:31:06.703Z') is refused in strict mode ("Incorrect datetime value") — the
 * lessons-learned, meeting and integration-sync writes failed that way (2026-10). Accepts an ISO
 * string or a Date; nothing means now. Something unreadable throws (callers check input first —
 * see isReadableMoment), so a bad date is never saved silently as another moment.
 */
export function sqlDateTime(value?: string | Date | null): string {
  const d = value == null ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Not a date: ${String(value).slice(0, 40)}`);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** For input checks: can this string be read as a moment? */
export function isReadableMoment(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

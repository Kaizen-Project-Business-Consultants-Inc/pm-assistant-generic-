/**
 * A role as people read it (UAT U2, Batch F): a person made from a login carries the login's role
 * code ("team_member", "project_manager"), which showed as code words on Resources. Code-like
 * values become words ("Team member"); anything a person typed ("QA / Tester") is left alone.
 */
export function roleLabel(role: string | null | undefined): string {
  const r = (role ?? '').trim();
  // only all-lowercase codes with underscores between words; anything else was typed by a person
  if (!/^[a-z_]+$/.test(r) || r.startsWith('_') || r.endsWith('_')) return r;
  const words = r.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

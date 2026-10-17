/**
 * Whether a RAID item has an owner: a login (ownerId), a person without one (ownerResourceId) or
 * a typed name (ownerName). One rule for the create check, the RAID Review and the weekly review
 * (the weekly review ignored typed names and called those risks "no owner", 2026-10-17).
 */
export function hasRaidOwner(d: { ownerId?: string | null; ownerResourceId?: string | null; ownerName?: string | null }): boolean {
  const filled = (v: unknown) => v != null && String(v).trim() !== '';
  return filled(d.ownerId) || filled(d.ownerResourceId) || filled(d.ownerName);
}

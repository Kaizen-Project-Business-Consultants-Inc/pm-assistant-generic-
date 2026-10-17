/** A whole amount in the project's currency, e.g. "$100,000" or "JMD 1,500,000" (falls back to $ for an unknown code) */
export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount.toLocaleString()}`;
  }
}

/** A US-dollar cost to the cent, e.g. "$37.27"; a tiny non-zero cost shows "< $0.01" rather than a misleading "$0.00" */
export function formatUsdCost(amount: number): string {
  const n = Number(amount) || 0;
  if (n > 0 && n < 0.005) return '< $0.01';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

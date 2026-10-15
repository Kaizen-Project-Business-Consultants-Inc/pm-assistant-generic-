/** A whole amount in the project's currency, e.g. "$100,000" or "JMD 1,500,000" (falls back to $ for an unknown code) */
export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount.toLocaleString()}`;
  }
}

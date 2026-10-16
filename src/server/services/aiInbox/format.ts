/** A calendar day as people write it in a suggestion: "24 Nov" (with the year when it isn't this year's) */
export function formatDay(ymd: string | null | undefined, today = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
  if (!m) return String(ymd ?? '');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
  return Number(m[1]) === today.getUTCFullYear() ? day : `${day} ${m[1]}`;
}

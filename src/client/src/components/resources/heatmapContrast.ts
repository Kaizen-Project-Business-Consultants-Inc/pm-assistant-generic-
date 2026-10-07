/**
 * WCAG 2.x contrast maths for the heatmaps (Workload heatmap, Utilization heatmap).
 * Pure functions — used by the contrast test to prove every cell's text and border
 * stay readable on its (unchanged) fill colour in light and dark mode.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

/** Parse `#rgb`, `#rrggbb`, `rgb(…)` or `rgba(…)`. */
export function parseColor(input: string): Rgba {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (!/^[0-9a-f]{6}$/.test(hex)) throw new Error(`Bad colour: ${input}`);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (!m) throw new Error(`Bad colour: ${input}`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) throw new Error(`Bad colour: ${input}`);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

/** Paint a (possibly translucent) colour over an opaque backdrop. */
export function composite(top: Rgba, backdrop: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + backdrop.r * (1 - a),
    g: top.g * a + backdrop.g * (1 - a),
    b: top.b * a + backdrop.b * (1 - a),
    a: 1,
  };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque colour. */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * WCAG contrast ratio (1–21) between two colours. A translucent foreground is first
 * painted over the background; the background must be opaque.
 */
export function contrastRatio(foreground: string | Rgba, background: string | Rgba): number {
  const bg = typeof background === 'string' ? parseColor(background) : background;
  const fgRaw = typeof foreground === 'string' ? parseColor(foreground) : foreground;
  const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

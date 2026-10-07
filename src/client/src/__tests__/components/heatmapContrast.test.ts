/**
 * Heatmap readability guard (Workload heatmap + time-tracking Utilization heatmap).
 *
 * Resolves each level's Tailwind classes to the colours the browser actually paints —
 * Tailwind's palette, our tailwind.config.js overrides (gray = stone), and the app's
 * dark-mode remap (postcss-dark-mode.cjs, `!important`, wins over `dark:` classes) —
 * then asserts text ≥ 4.5:1 on its fill and empty-cell borders ≥ 3:1 on the card.
 * Also pins the fills, which the user chose and must not change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import tailwindColors from 'tailwindcss/colors';
// @ts-expect-error -- plain-JS build config, no type declarations (read here for its colour overrides)
import tailwindConfig from '../../../tailwind.config.js';
// @ts-expect-error -- plain-JS PostCSS plugin, no type declarations (read here for its dark-mode remap)
import darkRemapPlugin from '../../../postcss-dark-mode.cjs';
import { contrastRatio, composite, parseColor, type Rgba } from '../../components/resources/heatmapContrast';
import { WORKLOAD_HEAT_LEVELS, WORKLOAD_AVG_TEXT, getHeatColor } from '../../components/resources/workloadHeatColors';
import { UTIL_HEAT_LEVELS, UTIL_SUMMARY_TEXT, getUtilColor } from '../../components/timetracking/utilizationHeatColors';

type Mode = 'light' | 'dark';
type Prop = 'bg' | 'text' | 'border';

// ── Build the colour resolver ─────────────────────────────────────────────────
const palette: Record<string, Record<string, string>> = {};
for (const name of ['green', 'yellow', 'red', 'amber']) {
  palette[name] = (tailwindColors as unknown as Record<string, Record<string, string>>)[name];
}
const extend = (tailwindConfig as { theme: { extend: { colors: Record<string, Record<string, string>> } } }).theme.extend.colors;
palette.gray = extend.gray;
palette.neutral = extend.neutral;
const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000' };

// text-gray-400 is a CSS variable (index.css), different per mode
const indexCss = readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
const varMatches = [...indexCss.matchAll(/--text-gray-400:\s*(\d+)\s+(\d+)\s+(\d+)/g)];
const textGray400 = {
  light: `rgb(${varMatches[0][1]}, ${varMatches[0][2]}, ${varMatches[0][3]})`,
  dark: `rgb(${varMatches[1][1]}, ${varMatches[1][2]}, ${varMatches[1][3]})`,
};

// Dark remap rules: ".dark .bg-gray-50" → #111827 etc.
const remap = new Map<string, string>(); // `${prop}:${class}` → colour
{
  const rules: { selector: string; nodes: { prop: string; value: string }[] }[] = [];
  (darkRemapPlugin as () => { Once: (root: unknown) => void })().Once({ append: (r: never) => rules.push(r) });
  const propOf: Record<string, Prop> = { 'background-color': 'bg', color: 'text', 'border-color': 'border' };
  for (const r of rules) {
    const m = r.selector.match(/^\.dark \.([a-z0-9-]+)$/);
    const decl = r.nodes[0];
    if (m && propOf[decl.prop]) remap.set(`${propOf[decl.prop]}:${m[1]}`, decl.value);
  }
}

const PREFIX: Record<Prop, string> = { bg: 'bg', text: 'text', border: 'border' };

function classColour(token: string, prop: Prop, mode: Mode): string | null {
  const p = PREFIX[prop];
  const arb = token.match(new RegExp(`^${p}-\\[(#[0-9a-fA-F]{3,6})\\]$`));
  if (arb) return arb[1];
  const m = token.match(new RegExp(`^${p}-([a-z]+)(?:-(\\d+))?(?:/(\\d+))?$`));
  if (!m) return null;
  const [, name, shade, alpha] = m;
  let hex: string | undefined;
  if (!shade) hex = NAMED[name];
  else if (prop === 'text' && name === 'gray' && shade === '400') hex = textGray400[mode];
  else hex = palette[name]?.[shade];
  if (!hex) return null;
  if (!alpha) return hex;
  const c = parseColor(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(alpha) / 100})`;
}

/** The colour the browser paints for `prop` on an element with these classes. */
function resolve(classes: string, prop: Prop, mode: Mode): Rgba {
  const tokens = classes.split(/\s+/).filter(Boolean);
  if (mode === 'dark') {
    for (const t of tokens) {
      const r = remap.get(`${prop}:${t}`);
      if (r) return parseColor(r);
    }
    for (const t of tokens) {
      if (!t.startsWith('dark:')) continue;
      const c = classColour(t.slice(5), prop, mode);
      if (c) return parseColor(c);
    }
  }
  for (const t of tokens) {
    if (t.includes(':')) continue;
    const c = classColour(t, prop, mode);
    if (c) return parseColor(c);
  }
  throw new Error(`No ${prop} colour in "${classes}" (${mode})`);
}

// Both heatmaps sit on a `bg-white dark:bg-gray-800` card.
const CARD = 'bg-white dark:bg-gray-800';
// Utilization summary cards
const SUMMARY_CARD = 'bg-gray-50 dark:bg-gray-700/50';

const MODES: Mode[] = ['light', 'dark'];
const hex = (c: Rgba) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('contrastRatio (pure)', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    // order does not matter
    expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(contrastRatio('#767676', '#ffffff'), 10);
  });
  it('paints translucent colours over the backdrop first', () => {
    expect(contrastRatio('rgba(0, 0, 0, 0)', '#ffffff')).toBeCloseTo(1, 5);
    expect(hex(composite(parseColor('rgba(0, 0, 0, 0.5)'), parseColor('#ffffff')))).toBe('#808080');
  });
  it('parses #rgb, #rrggbb, rgb() and rgba()', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor('rgba(1, 2, 3, 0.4)')).toEqual({ r: 1, g: 2, b: 3, a: 0.4 });
    expect(() => parseColor('teal')).toThrow();
  });
});

describe('resolver sanity — matches what the browser computed (2026-10-07 local render)', () => {
  it.each([
    [WORKLOAD_HEAT_LEVELS.none.bg, 'bg', 'dark', '#111827'],
    [WORKLOAD_HEAT_LEVELS.none.bg, 'bg', 'light', '#fafaf9'],
    [CARD, 'bg', 'dark', '#1f2937'],
    [UTIL_HEAT_LEVELS.none.bg, 'bg', 'dark', '#1f2937'],
    ['text-gray-700 dark:text-gray-200', 'text', 'dark', '#d1d5db'],
    ['text-green-600 dark:text-green-400', 'text', 'dark', '#4ade80'],
  ] as [string, Prop, Mode, string][])('%s %s (%s) → %s', (classes, prop, mode, expected) => {
    expect(hex(resolve(classes, prop, mode))).toBe(expected);
  });
});

describe('heatmap fills are unchanged (the user chose them)', () => {
  it('Workload heatmap', () => {
    expect([0, 30, 65, 90, 120].map((u) => getHeatColor(u).bg)).toEqual([
      'bg-gray-50 dark:bg-gray-800',
      'bg-green-50 dark:bg-green-900/30',
      'bg-green-100 dark:bg-green-900/40',
      'bg-yellow-100 dark:bg-yellow-900/40',
      'bg-red-100 dark:bg-red-900/40',
    ]);
  });
  it('Utilization heatmap', () => {
    expect([0, 10, 50, 90, 130].map((u) => getUtilColor(u).bg)).toEqual([
      'bg-gray-100 dark:bg-gray-700',
      'bg-red-200 dark:bg-red-900/40',
      'bg-amber-200 dark:bg-amber-900/40',
      'bg-green-300 dark:bg-green-800/60',
      'bg-red-400 dark:bg-red-700/60',
    ]);
  });
});

const heatmaps = [
  ['Workload', WORKLOAD_HEAT_LEVELS],
  ['Utilization', UTIL_HEAT_LEVELS],
] as const;

describe.each(heatmaps)('%s heatmap — every level reads at WCAG AA', (_name, levels) => {
  for (const mode of MODES) {
    for (const [key, level] of Object.entries(levels)) {
      it(`${mode} · ${level.label} (${key}): text ≥ 4.5:1 on the fill`, () => {
        const card = resolve(CARD, 'bg', mode);
        const fill = composite(resolve(level.bg, 'bg', mode), card);
        const ratio = contrastRatio(resolve(level.text, 'text', mode), fill);
        expect(ratio, `${level.text} on ${hex(fill)} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      });
      if ('border' in level && level.border) {
        const border = level.border;
        it(`${mode} · ${level.label} (${key}): border ≥ 3:1 on the card`, () => {
          const card = resolve(CARD, 'bg', mode);
          const ratio = contrastRatio(resolve(border, 'border', mode), card);
          expect(ratio, `${border} on ${hex(card)} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

describe('no faded text in the heatmaps', () => {
  // Opacity blends text into its fill — the Workload "%" line was opacity-70 (2.2:1 on the
  // light-green fill) and weekend dates opacity-50 (2.2:1). The colour checks above can't see
  // opacity, so keep it out of the markup (decorative icons excepted).
  it.each([
    ['resources/WorkloadHeatmap.tsx'],
    ['timetracking/UtilizationHeatmap.tsx'],
  ])('%s', (file) => {
    const src = readFileSync(path.resolve(__dirname, '../../components', file), 'utf8');
    const faded = src.split('\n').filter((l) => /\bopacity-\d+/.test(l) && !/<Grid3X3\b/.test(l));
    expect(faded).toEqual([]);
  });
});

describe('figures next to the heatmaps read at WCAG AA', () => {
  for (const mode of MODES) {
    for (const [key, classes] of Object.entries(WORKLOAD_AVG_TEXT)) {
      it(`${mode} · Workload Avg column (${key})`, () => {
        expect(contrastRatio(resolve(classes, 'text', mode), resolve(CARD, 'bg', mode))).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [key, classes] of Object.entries(UTIL_SUMMARY_TEXT)) {
      it(`${mode} · Utilization summary card (${key})`, () => {
        const bg = composite(resolve(SUMMARY_CARD, 'bg', mode), resolve(CARD, 'bg', mode));
        expect(contrastRatio(resolve(classes, 'text', mode), bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${mode} · Utilization weekend date header (text-gray-400)`, () => {
      expect(contrastRatio(resolve('text-gray-400', 'text', mode), resolve(CARD, 'bg', mode))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * Byte-for-byte DOM fixtures for the "nothing moved" refactor tests (ganttChartDom,
 * scheduleTabDom). A test renders a screen, takes container.innerHTML and compares it with an
 * HTML file captured on the commit before the refactor.
 *
 * Those test files start with `// @vitest-environment happy-dom`, so they render in the same DOM
 * under the root vitest config (happy-dom for every client test) and under src/client's own config
 * (jsdom by default). jsdom serialises inline styles differently (hex colours become rgb(), border
 * shorthands are expanded, sub-pixel floats keep every digit), so a fixture captured in one could
 * never match the other; pinning the environment keeps the comparison exact instead of loosening it.
 * happy-dom is a root devDependency; from src/client it resolves through the root node_modules.
 */
import { expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * React useId() values (":r0:", ":r1a:", …) come from a counter that runs across every render in
 * the file, so running one test on its own (-t) would shift them. They are renumbered in order of
 * first appearance (":id1:", ":id2:", …) before saving or comparing — the same element still gets
 * the same number, and a label still points at its own field. Added 2026-10-06 with the
 * accessible-name batch, which links labels to fields with useId().
 */
export function normaliseReactIds(html: string): string {
  const seen = new Map<string, string>();
  return html.replace(/:r[0-9a-z]+:/g, id => {
    if (!seen.has(id)) seen.set(id, `:id${seen.size + 1}:`);
    return seen.get(id)!;
  });
}

/** Compare `html` with fixture `<dir>/<name>.html`, or (write) save it as that fixture. */
export function expectSameDom(dir: string, name: string, rawHtml: string, write: boolean) {
  const html = normaliseReactIds(rawHtml);
  const file = join(dir, `${name}.html`);
  if (write) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, html, 'utf8');
    return;
  }
  // fixtures are stored with LF; a Windows checkout (core.autocrlf) may hand them back with CRLF
  const expected = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  // byte-identical; on a mismatch, report the first differing offset for a readable failure
  if (html !== expected) {
    let i = 0;
    while (i < html.length && html[i] === expected[i]) i++;
    expect({ at: i, got: html.slice(Math.max(0, i - 120), i + 120) })
      .toEqual({ at: i, got: expected.slice(Math.max(0, i - 120), i + 120) });
  }
  expect(html).toBe(expected);
}

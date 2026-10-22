import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { jsonShapeInstruction } from '../../services/claudeService';
import { AIScenarioResultSchema } from '../../schemas/phase5Schemas';

/**
 * Every AI answer checked against a schema is first shown that schema (U73, 2026-10-21). What-If's
 * prompt said "match the schema" without one; the AI guessed the field names, both tries failed
 * (~1 min, paid twice) and the user always got the rules-only answer.
 *
 * Guard: every schema the AI answers to can be written out for the prompt — a schema that can't
 * would silently go back to the AI guessing.
 */
describe('the AI is shown the JSON shape it must return', () => {
  it("What-If's shape names the fields it was guessing wrong", () => {
    const text = jsonShapeInstruction(AIScenarioResultSchema);
    for (const field of ['scheduleImpact', 'originalDays', 'projectedDays', 'budgetImpact', 'currentWorkers', 'currentRiskScore', 'affectedTasks', 'taskName', 'severity']) {
      expect(text).toContain(`"${field}"`);
    }
    expect(text).toContain('"high"'); // allowed values too
  });

  it('every schema in schemas/ can be written out', async () => {
    const dir = join(__dirname, '..', '..', 'schemas');
    const empty: string[] = [];
    let count = 0;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const mod = await import(join(dir, file));
      for (const [name, value] of Object.entries(mod)) {
        if (!(value instanceof z.ZodType)) continue;
        count++;
        // written out AND says something: an object schema names its fields (a blank `{}` tells the AI nothing)
        const text = jsonShapeInstruction(value);
        const json = text ? JSON.parse(text.slice(text.indexOf('{'))) : {};
        if (!text || (value instanceof z.ZodObject && !Object.keys(json.properties ?? {}).length)) empty.push(`${file}: ${name}`);
      }
    }
    expect(count).toBeGreaterThan(20);
    expect(empty).toEqual([]);
  });

  it('guard (U79): a file that asks the AI for JSON lets completeWithJsonSchema read it (fences stripped, shape checked)', () => {
    // Portfolio Intelligence, anomaly detection, AI accuracy and the strategic risk scan did
    // JSON.parse(complete().content): a ```json-fenced reply threw and the paid answer was thrown
    // away every run. Files listed here still parse a JSON reply themselves (they strip fences by
    // hand, so they work): move them to completeWithJsonSchema, then take them off. The list only shrinks.
    const STILL_PARSE_THEMSELVES = new Set([
      'routes/scheduling/import.ts',
      'services/ProjectStatusReportService.ts',
    ]);
    const root = join(__dirname, '..', '..');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? (e.name === '__tests__' ? [] : files(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
    const offenders = files(root)
      .filter(f => !f.endsWith('claudeService.ts'))
      .map(f => ({ rel: f.slice(root.length + 1).replace(/\\/g, '/'), src: readFileSync(f, 'utf8') }))
      .filter(({ src }) => /\bJSON\.parse\(/.test(src) && (/responseFormat:\s*'json'/.test(src) || /JSON\.parse\(\s*\w+\.content\b/.test(src)))
      .map(({ rel }) => rel);
    expect(offenders.filter(f => !STILL_PARSE_THEMSELVES.has(f))).toEqual([]);
    // a file fixed later must come off the list
    expect([...STILL_PARSE_THEMSELVES].filter(f => !offenders.includes(f))).toEqual([]);
  });
});

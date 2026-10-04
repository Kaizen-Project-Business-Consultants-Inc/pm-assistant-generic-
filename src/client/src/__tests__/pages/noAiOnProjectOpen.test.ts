import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guard (Oct 2026): opening a project used to prefetch the EVM AI predictions — one AI call per
 * project open (up to 3 when it failed). They are asked for only by the Performance panel, once,
 * with no automatic retry.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf-8');

describe('no AI call just for opening a project', () => {
  it('the project page does not fetch EVM AI predictions', () => {
    expect(read('pages/ProjectDetailPage.tsx')).not.toMatch(/getEVMAIPredictions|evmForecastAI/);
  });

  it('the Performance panel asks once, without retries', () => {
    const src = read('components/evm/PerformancePanel.tsx');
    const q = src.slice(src.indexOf("queryKey: ['evmForecastAI'"), src.indexOf("queryKey: ['evmForecastAI'") + 400);
    expect(q).toMatch(/retry: false/);
  });
});

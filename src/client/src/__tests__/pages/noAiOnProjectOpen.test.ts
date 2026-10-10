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

  // audit 2026-10-10 M1: AI only when asked — not on opening the sub-tab or the AI Predictions tab
  it('the Performance panel asks the AI only after its Ask AI button', () => {
    const src = read('components/evm/PerformancePanel.tsx');
    const q = src.slice(src.indexOf("queryKey: ['evmForecastAI'"), src.indexOf("queryKey: ['evmForecastAI'") + 400);
    expect(q).toMatch(/enabled: askAI &&/);
    expect(src).toMatch(/onClick=\{\(\) => setAskAI\(true\)\}/);
  });

  it('the AI Predictions tab opens without asking the AI for risk, weather and budget', () => {
    const src = read('pages/ProjectDetailPage/AIInsightsTab.tsx');
    expect(src).toMatch(/const \[askAI, setAskAI\] = useState\(false\)/);
    for (const call of ['getProjectRisks', 'getProjectWeather', 'getProjectBudget']) {
      expect(src).not.toMatch(new RegExp(`${call}\\(projectId\\)`)); // every call passes the ai flag
    }
    expect(src).toMatch(/usePrediction\('budget', projectId, false\)/); // the S-curve's EVM figures never ask the AI
    for (const kind of ['risk', 'weather', 'budget']) expect(src).toMatch(new RegExp(`usePrediction\\('${kind}', projectId, askAI\\)`));
  });

  it('the banner says which source each prediction shows', async () => {
    const { sourceSentence } = await import('../../pages/ProjectDetailPage/AIInsightsTab');
    expect(sourceSentence({}, true)).toMatch(/worked out from your plan by rules/);
    const t = '2026-10-10T14:32:00';
    const mixed = sourceSentence({ risk: t, budget: t }, true);
    expect(mixed).toMatch(/Risk: AI answer from .*Budget: AI answer from/);
    expect(mixed).toMatch(/Weather: worked out by rules/);
    expect(sourceSentence({ risk: t, weather: t, budget: t }, true)).not.toMatch(/rules/);
  });
});

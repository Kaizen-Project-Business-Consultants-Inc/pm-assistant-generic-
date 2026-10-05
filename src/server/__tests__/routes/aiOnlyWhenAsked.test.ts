import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guard (2026-10-05, audit high "AI calls without anyone asking"): three screens called the AI by
 * themselves — the risk form on every keystroke, the Time tab's weekly summary on every open (even
 * collapsed, even with no hours), and the Team/Resources forecast whenever someone was
 * over-booked. Now each asks only when a person clicks/opens it. Same idea as
 * client __tests__/pages/noAiOnProjectOpen.test.ts (EVM).
 */
const server = join(__dirname, '..', '..');
const client = join(server, '..', 'client', 'src');
const read = (p: string) => readFileSync(p, 'utf-8');

describe('the AI is asked only when a person asks', () => {
  it('risk form: mitigation ideas only after "Suggest mitigations"', () => {
    const src = read(join(client, 'components', 'risks', 'RiskFormModal.tsx'));
    const q = src.slice(src.indexOf("queryKey: ['risk-mitigations'"), src.indexOf("queryKey: ['risk-mitigations'") + 400);
    expect(q).toMatch(/enabled: !!mitigationAsk/);
    expect(q).toMatch(/retry: false/);
    expect(src).toMatch(/Suggest mitigations from past lessons/);
  });

  it('Time tab: the written summary only when the panel is opened', () => {
    const panel = read(join(client, 'components', 'project', 'WeeklyReviewPanel.tsx'));
    expect(panel).toMatch(/getWeeklyReview\(projectId, weekStart, true\)/);
    expect(panel).toMatch(/enabled: expanded &&/);
    const svc = read(join(server, 'services', 'TimeAnomalyService.ts'));
    expect(svc).toMatch(/if \(opts\.withNarrative && totalHours > 0\)/);
    // the Friday pack never asks for it
    expect(read(join(server, 'services', 'scheduling', 'weeklyReviewPackJob.ts'))).not.toMatch(/withNarrative: true/);
  });

  it('Team tab / Resources: the forecast never asks; the PM button does', () => {
    const svc = read(join(server, 'services', 'ResourceOptimizerService.ts'));
    expect(svc).toMatch(/if \(opts\.withAI && config\.AI_ENABLED/);
    const route = read(join(server, 'routes', 'resources', 'resourceOptimizer.ts'));
    const get = route.slice(route.indexOf("fastify.get('/:projectId/forecast'"));
    expect(get.slice(0, 1200)).not.toMatch(/withAI/);
    expect(route).toMatch(/'\/:projectId\/rebalance-suggestions'[\s\S]{0,200}requireProjectAccess\('manager'\)/);
    expect(read(join(client, 'pages', 'ProjectDetailPage', 'TeamTab.tsx'))).toMatch(/isProjectPM && forecast\.bottlenecks/);
  });
});

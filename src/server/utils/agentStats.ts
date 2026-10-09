/**
 * Merging the admin agent counts read from each company's own database (agent memory moved there
 * on 2026-10-09). Counts only — never the notes themselves. Dates arrive as 'YYYY-MM-DD HH:MM:SS'
 * strings (the pool uses dateStrings: true), so plain string comparison orders them.
 */

interface AgentRunRow { agent_id: string; runs: number | string; unique_projects?: number | string; first_run?: string | null; last_run?: string | null }
interface AgentRunTotal { agent_id: string; runs: number; unique_projects: number; first_run: string | null; last_run: string | null }

/** Per agent: runs and projects added up (project ids differ between companies), earliest first run, latest last run; most runs first */
export function mergeAgentRuns(perCompany: AgentRunRow[][]): AgentRunTotal[] {
  const byAgent = new Map<string, AgentRunTotal>();
  for (const r of perCompany.flat()) {
    const acc = byAgent.get(r.agent_id) ?? { agent_id: r.agent_id, runs: 0, unique_projects: 0, first_run: null, last_run: null };
    acc.runs += Number(r.runs) || 0;
    acc.unique_projects += Number(r.unique_projects) || 0;
    if (r.first_run && (!acc.first_run || String(r.first_run) < acc.first_run)) acc.first_run = String(r.first_run);
    if (r.last_run && (!acc.last_run || String(r.last_run) > acc.last_run)) acc.last_run = String(r.last_run);
    byAgent.set(r.agent_id, acc);
  }
  return [...byAgent.values()].sort((x, y) => y.runs - x.runs);
}

/** Agent-after-agent pairs: added up across companies BEFORE the "seen at least twice" cut, top 20 */
export function mergeAgentPairs(perCompany: Array<Array<{ first_agent: string; second_agent: string; frequency: number | string }>>): Array<{ first_agent: string; second_agent: string; frequency: number }> {
  const byPair = new Map<string, { first_agent: string; second_agent: string; frequency: number }>();
  for (const r of perCompany.flat()) {
    const key = JSON.stringify([r.first_agent, r.second_agent]);
    const acc = byPair.get(key) ?? { first_agent: r.first_agent, second_agent: r.second_agent, frequency: 0 };
    acc.frequency += Number(r.frequency) || 0;
    byPair.set(key, acc);
  }
  return [...byPair.values()].filter(p => p.frequency >= 2).sort((x, y) => y.frequency - x.frequency).slice(0, 20);
}

/** Runs per day added up across companies, in date order */
export function mergeDailyRuns(perCompany: Array<Array<{ day: string; runs: number | string }>>): Array<{ day: string; runs: number }> {
  const byDay = new Map<string, number>();
  for (const r of perCompany.flat()) byDay.set(String(r.day), (byDay.get(String(r.day)) ?? 0) + (Number(r.runs) || 0));
  return [...byDay.entries()].map(([day, runs]) => ({ day, runs })).sort((x, y) => x.day.localeCompare(y.day));
}

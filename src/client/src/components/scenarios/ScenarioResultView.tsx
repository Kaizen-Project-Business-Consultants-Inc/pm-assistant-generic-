import type { ReactNode } from 'react';
import { Clock, DollarSign, Users, Shield, AlertTriangle, Lightbulb } from 'lucide-react';

/** A What-If result as the server returns it (schemas/phase5Schemas.ts AIScenarioResultSchema) */
export interface ScenarioResult {
  scheduleImpact: { originalDays: number; projectedDays: number; changePct: number; explanation: string };
  budgetImpact: { originalBudget: number; projectedBudget: number; changePct: number; explanation: string };
  resourceImpact: { currentWorkers: number; projectedWorkers: number; explanation: string };
  riskImpact: { currentRiskScore: number; projectedRiskScore: number; newRisks: string[]; explanation: string };
  affectedTasks: Array<{ taskName: string; impact: string; severity: 'low' | 'medium' | 'high' }>;
  recommendations: string[];
  confidence: number;
}

export function impactColor(changePct: number): string {
  if (changePct > 5) return 'text-red-600 dark:text-red-400';
  if (changePct < -5) return 'text-green-600 dark:text-green-400';
  return 'text-gray-700 dark:text-gray-200';
}

function severityBadge(severity: string) {
  const colors: Record<string, string> = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    low: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  };
  return colors[severity] || colors.low;
}

const SEVERITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

/** The one line under each result saying how the rules-only estimate was worked out */
const HOW = {
  schedule: "The plan's working days, changed by your days and scope settings. Not a re-plan of the Gantt.",
  budget: 'Your budget % applied to the project budget; a scope change adds cost too.',
  resources: 'People assigned to tasks in this plan, plus your Resources +/-. It does not move dates or cost.',
  risk: 'Fixed factors for this type of project: less time or money raises it, more time lowers it.',
};

/**
 * What a What-If run found, as cards: before → after for schedule, budget, resources and risk, then
 * new risks, affected tasks and recommendations (U78, approved mock
 * https://claude.ai/artifact/D94EMU7a1MfJDvcQPMjeGk). Shared by the project's What-If tab and the
 * Scenario Modeling page — the tab used to print the result as raw JSON.
 *
 * `aiPowered` false = the rules-only answer: it is labelled "Estimate" and each card says how it
 * was worked out. A project with no budget says so instead of "$0 → $0".
 */
export function ScenarioResultView({ result, aiPowered }: { result: ScenarioResult; aiPowered: boolean }) {
  const { scheduleImpact: s, budgetImpact: b, resourceImpact: r, riskImpact: k } = result;
  const noBudget = !(b.originalBudget > 0);
  const how = (text: string) => (!aiPowered && (
    <p className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">How: {text}</p>
  ));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={<Clock className="w-4 h-4 text-blue-500" />} title="Schedule" estimate={!aiPowered}>
          <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{s.originalDays} → {s.projectedDays} days</p>
          <p className={`text-xs font-semibold ${impactColor(s.changePct)}`}>{signed(s.changePct)} · working days</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{s.explanation}</p>
          {how(HOW.schedule)}
        </Card>

        <Card icon={<DollarSign className="w-4 h-4 text-green-500" />} title="Budget" estimate={!aiPowered && !noBudget}>
          {noBudget ? (
            <>
              <p className="text-sm font-bold text-gray-900 dark:text-white">No budget set</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">Set a budget in Edit project to see the cost effect.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">${b.originalBudget.toLocaleString()} → ${b.projectedBudget.toLocaleString()}</p>
              <p className={`text-xs font-semibold ${impactColor(b.changePct)}`}>{signed(b.changePct)}</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{b.explanation}</p>
              {how(HOW.budget)}
            </>
          )}
        </Card>

        <Card icon={<Users className="w-4 h-4 text-purple-500" />} title="Resources" estimate={!aiPowered}>
          <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{r.currentWorkers} → {r.projectedWorkers}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">people</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{r.explanation}</p>
          {how(HOW.resources)}
        </Card>

        <Card icon={<Shield className="w-4 h-4 text-orange-500" />} title="Risk score" estimate={!aiPowered}>
          <p className={`text-lg font-bold tabular-nums ${
            k.projectedRiskScore > k.currentRiskScore ? 'text-red-600 dark:text-red-400'
              : k.projectedRiskScore < k.currentRiskScore ? 'text-green-600 dark:text-green-400'
                : 'text-gray-900 dark:text-white'}`}
          >
            {k.currentRiskScore} → {k.projectedRiskScore}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">out of 100</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{k.explanation}</p>
          {how(HOW.risk)}
        </Card>
      </div>

      {k.newRisks.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
          <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-2 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> New risks
          </p>
          <ul className="space-y-1 list-disc pl-5 text-xs text-red-800 dark:text-red-200">
            {k.newRisks.map((risk, i) => <li key={i}>{risk}</li>)}
          </ul>
        </div>
      )}

      {result.affectedTasks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide mb-2">Affected tasks</h3>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
            {result.affectedTasks.map((task, idx) => (
              <li key={idx} className="flex items-start gap-3 p-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{task.taskName}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">{task.impact}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${severityBadge(task.severity)}`}>
                  {SEVERITY_LABEL[task.severity] ?? task.severity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.recommendations.length > 0 && (
        <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 p-3">
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2 flex items-center gap-1">
            <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" /> Recommendations
          </p>
          <ul className="space-y-1.5 list-disc pl-5 text-xs text-violet-900 dark:text-violet-100">
            {result.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Card({ icon, title, estimate, children }: { icon: ReactNode; title: string; estimate: boolean; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 min-w-0">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase">{title}</span>
        {estimate && (
          <span className="ml-auto px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Estimate</span>
        )}
      </div>
      {children}
    </div>
  );
}

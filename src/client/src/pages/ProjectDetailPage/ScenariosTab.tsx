import { useState, useId } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, SlidersHorizontal, XCircle } from 'lucide-react';
import { apiService } from '../../services/api';
import { useProjectRole } from '../../hooks/useProjectRole';
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote';
import { ExampleDataNote } from '../../components/ui/ExampleDataNote';
import { ScenarioSliderPanel, type SliderValues } from '../../components/scenarios/ScenarioSliderPanel';
import { ScenarioResultView, type ScenarioResult } from '../../components/scenarios/ScenarioResultView';
import { WhatIfIntro } from '../../components/scenarios/WhatIfIntro';

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <XCircle className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function ScenariosTab({ projectId }: { projectId: string }) {
  const uid = useId();
  const { canEdit, loaded: roleLoaded } = useProjectRole(projectId);
  const [scenario, setScenario] = useState('');
  const [sliders, setSliders] = useState<SliderValues>({ budgetChangePct: 0, daysExtension: 0, workerChange: 0, scopeChangePct: 0 });
  // the project's budget, so the Budget slider can say "No budget set" (U78)
  const { data: baselineData } = useQuery({
    queryKey: ['scenario-baseline', projectId],
    queryFn: () => apiService.getScenarioBaseline(projectId),
    enabled: roleLoaded && canEdit,
  });
  const baseline = baselineData?.data as { budgetAllocated?: number } | undefined;

  const mutation = useMutation({
    mutationFn: (data: {
      projectId: string;
      scenario: string;
      parameters?: {
        budgetChangePct?: number;
        workerChange?: number;
        daysExtension?: number;
        scopeChangePct?: number;
      };
    }) => apiService.modelScenario(data),
  });

  const handleRunScenario = () => {
    if (!scenario.trim()) return;
    const parameters = Object.fromEntries(Object.entries(sliders).filter(([, v]) => v !== 0));

    mutation.mutate({
      projectId,
      scenario: scenario.trim(),
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    });
  };

  const result: ScenarioResult | undefined = mutation.data?.data;

  if (roleLoaded && !canEdit) {
    return <ViewOnlyNote className="mt-6" />;
  }

  return (
    <div className="space-y-6">
      {/* Scenario Form */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal className="h-5 w-5 text-primary-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Model a Scenario</h3>
        </div>

        <div className="space-y-4">
          <WhatIfIntro />
          <div>
            <label htmlFor={`${uid}-scenario-description`} className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200">
              Scenario Description
            </label>
            <input
              id={`${uid}-scenario-description`}
              type="text"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              placeholder="e.g., What if we lose the business analyst and extend the deadline by 2 weeks?"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <ScenarioSliderPanel
            values={sliders}
            onChange={setSliders}
            disabled={mutation.isPending}
            budgetSet={!baseline || (baseline.budgetAllocated ?? 0) > 0}
          />

          <div className="flex justify-end">
            <button
              onClick={handleRunScenario}
              disabled={!scenario.trim() || mutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Scenario
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {mutation.isError && (
        <SectionError message="Failed to model scenario. Please try again." />
      )}

      {result && (
        <div className="space-y-4">
          {mutation.data?.sample && (
            <ExampleDataNote>This project has no tasks yet, so this is an example result. Add tasks to the project and run the scenario again to see its real impact.</ExampleDataNote>
          )}
          {result.confidence != null && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Confidence:</span>
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-primary-500 transition-all"
                    style={{ width: `${Math.round(result.confidence * 100)}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
                  {Math.round(result.confidence * 100)}%
                </span>
              </div>
            </div>
          )}

          <ScenarioResultView result={result} aiPowered={!!mutation.data?.aiPowered} />
        </div>
      )}
    </div>
  );
}

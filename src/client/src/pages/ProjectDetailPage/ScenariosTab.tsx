import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Calendar,
  DollarSign,
  ShieldAlert,
  AlertTriangle,
  Lightbulb,
  Play,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { apiService } from '../../services/api';

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <XCircle className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function ScenariosTab({ projectId }: { projectId: string }) {
  const [scenario, setScenario] = useState('');
  const [budgetChangePct, setBudgetChangePct] = useState<number>(0);
  const [workerChange, setWorkerChange] = useState<number>(0);
  const [daysExtension, setDaysExtension] = useState<number>(0);
  const [scopeChangePct, setScopeChangePct] = useState<number>(0);

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
    const parameters: any = {};
    if (budgetChangePct !== 0) parameters.budgetChangePct = budgetChangePct;
    if (workerChange !== 0) parameters.workerChange = workerChange;
    if (daysExtension !== 0) parameters.daysExtension = daysExtension;
    if (scopeChangePct !== 0) parameters.scopeChangePct = scopeChangePct;

    mutation.mutate({
      projectId,
      scenario: scenario.trim(),
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    });
  };

  const result = mutation.data?.data;

  return (
    <div className="space-y-6">
      {/* Scenario Form */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal className="h-5 w-5 text-primary-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Model a Scenario</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200">
              Scenario Description
            </label>
            <input
              type="text"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              placeholder="e.g., What if we add 5 more workers and extend the deadline by 2 weeks?"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SliderInput label="Budget Change" value={budgetChangePct} onChange={setBudgetChangePct} min={-50} max={50} step={5} unit="%" />
            <SliderInput label="Worker Change" value={workerChange} onChange={setWorkerChange} min={-20} max={20} step={1} unit="" />
            <SliderInput label="Days Extension" value={daysExtension} onChange={setDaysExtension} min={0} max={180} step={7} unit=" days" />
            <SliderInput label="Scope Change" value={scopeChangePct} onChange={setScopeChangePct} min={-50} max={50} step={5} unit="%" />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleRunScenario}
              disabled={!scenario.trim() || mutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Running...
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {result.scheduleImpact && (
              <ImpactCard title="Schedule Impact" icon={Calendar} iconColor="text-blue-500" content={result.scheduleImpact} />
            )}
            {result.budgetImpact && (
              <ImpactCard title="Budget Impact" icon={DollarSign} iconColor="text-green-500" content={result.budgetImpact} />
            )}
            {result.riskImpact && (
              <ImpactCard title="Risk Impact" icon={ShieldAlert} iconColor="text-red-500" content={result.riskImpact} />
            )}
          </div>

          {result.resourceImpact && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h4 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">Resource Impact</h4>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {typeof result.resourceImpact === 'string'
                  ? result.resourceImpact
                  : JSON.stringify(result.resourceImpact)}
              </p>
            </div>
          )}

          {result.affectedTasks && result.affectedTasks.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h4 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">Affected Tasks</h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {result.affectedTasks.map((task: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-md bg-gray-50 dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200"
                  >
                    <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                    <span>
                      {typeof task === 'string'
                        ? task
                        : task.name || task.task || JSON.stringify(task)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.recommendations && result.recommendations.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h4 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">Recommendations</h4>
              <ul className="space-y-1.5">
                {result.recommendations.map((rec: string, idx: number) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300"
                  >
                    <Lightbulb className="mt-0.5 h-3 w-3 text-yellow-500 flex-shrink-0" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SliderInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-gray-700 dark:text-gray-200">{label}</label>
        <span className="text-xs font-bold text-gray-900 dark:text-white">
          {value > 0 ? '+' : ''}
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary-600"
      />
      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

function ImpactCard({
  title,
  icon: Icon,
  iconColor,
  content,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  content: any;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">{title}</h4>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {typeof content === 'string' ? content : JSON.stringify(content)}
      </p>
    </div>
  );
}

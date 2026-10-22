import React from 'react';
import { DollarSign, Clock, Users, Target, RotateCcw } from 'lucide-react';
import { InfoTip } from '../ui/InfoTip';

export interface SliderValues {
  budgetChangePct: number;
  daysExtension: number;
  workerChange: number;
  scopeChangePct: number;
}

interface Props {
  values: SliderValues;
  onChange: (values: SliderValues) => void;
  disabled?: boolean;
  /** false = the project has no budget: the Budget slider is off and says so (U78) */
  budgetSet?: boolean;
}

// help: what each slider does to the estimate (U74, approved mock https://claude.ai/artifact/D94EMU7a1MfJDvcQPMjeGk)
const SLIDERS = [
  { key: 'budgetChangePct' as const, label: 'Budget %', icon: DollarSign, min: -50, max: 50, step: 1, color: 'text-green-500',
    help: 'More or less money for this project, as a % of its budget. Less money raises the risk score.' },
  { key: 'daysExtension' as const, label: 'Days +/-', icon: Clock, min: -60, max: 60, step: 1, color: 'text-blue-500',
    help: 'Working days added to (or taken off) the finish. Less time raises the risk score; more time lowers it.' },
  { key: 'workerChange' as const, label: 'Resources +/-', icon: Users, min: -5, max: 5, step: 1, color: 'text-purple-500',
    help: 'Add or remove people (resources) on this project. Today it changes the team size and the risk score only. It does not move dates or cost yet.' },
  { key: 'scopeChangePct' as const, label: 'Scope %', icon: Target, min: -50, max: 50, step: 1, color: 'text-orange-500',
    help: 'More or less work, as a % of the plan. It changes the days and the cost in proportion.' },
] as const;

export const ScenarioSliderPanel: React.FC<Props> = ({ values, onChange, disabled, budgetSet = true }) => {
  const allZero = Object.values(values).every(v => v === 0);

  return (
    <div className="space-y-3">
      {SLIDERS.map(({ key, label, icon: Icon, min, max, step, color, help }) => {
        const off = disabled || (key === 'budgetChangePct' && !budgetSet);
        return (
          <div key={key}>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 w-32 flex-shrink-0">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
                <InfoTip title={label}>{help}</InfoTip>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={values[key]}
                disabled={off}
                onInput={(e) => onChange({ ...values, [key]: Number((e.target as HTMLInputElement).value) })}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 dark:bg-gray-700 accent-primary-600 disabled:opacity-50"
                aria-label={label}
              />
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={values[key]}
                disabled={off}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  onChange({ ...values, [key]: Math.max(min, Math.min(max, v)) });
                }}
                className="w-16 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-center text-gray-900 dark:text-white disabled:opacity-50"
                aria-label={`${label} value`}
              />
              <button
                type="button"
                onClick={() => onChange({ ...values, [key]: 0 })}
                disabled={off || values[key] === 0}
                className="p-1 text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors"
                aria-label={`Reset ${label}`}
                title="Reset"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
            {key === 'budgetChangePct' && !budgetSet && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">No budget set. Set a budget in Edit project to try budget changes.</p>
            )}
          </div>
        );
      })}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={() => onChange({ budgetChangePct: 0, daysExtension: 0, workerChange: 0, scopeChangePct: 0 })}
          disabled={disabled || allZero}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-40 transition-colors"
        >
          Reset All
        </button>
      </div>
    </div>
  );
};

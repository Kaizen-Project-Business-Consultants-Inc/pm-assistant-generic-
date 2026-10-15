import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { getReadinessSteps, type Methodology } from '../../utils/methodology';

interface ReadinessStep {
  key: string;
  label: string;
  tooltip: string;
  done: boolean;
  action: () => void;
}

interface ProjectReadinessBarProps {
  projectId: string;
  tasks: any[];
  resources: any[];
  methodology?: Methodology;
  sprintCount?: number;
  onTabChange: (tab: string) => void;
}

const STORAGE_PREFIX = 'readiness-dismissed-';
// a per-browser convenience: storage can be blocked (private window) — the bar then just shows
const remembered = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const remember = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* not kept */ } };

export function ProjectReadinessBar({ projectId, tasks, resources, methodology = 'waterfall', sprintCount = 0, onTabChange }: ProjectReadinessBarProps) {
  const [dismissed, setDismissed] = useState(() => remembered(`${STORAGE_PREFIX}${projectId}`));

  const hasTasks = tasks.length > 0;
  const hasDependencies = tasks.some((t: any) => t.dependency || t.predecessors?.length > 0);
  const hasResources = resources.length > 0;
  const hasSprints = sprintCount > 0;

  const stepConfigs = getReadinessSteps(methodology);

  const steps: ReadinessStep[] = stepConfigs.map((cfg) => {
    let done = false;
    if (cfg.doneKey === 'tasks') done = hasTasks;
    else if (cfg.doneKey === 'dependencies') done = hasDependencies;
    else if (cfg.doneKey === 'resources') done = hasResources;
    else if (cfg.doneKey === 'sprints') done = hasSprints;

    return { key: cfg.key, label: cfg.label, tooltip: cfg.tooltip, done, action: () => onTabChange(cfg.targetTab) };
  });

  const completedCount = steps.filter(s => s.done).length;
  const allComplete = completedCount === steps.length;

  // Auto-dismiss after 3 seconds when all steps are complete. This hook must run on every
  // render — the `dismissed` early return below used to sit above it, so dismissing changed
  // the hook count and crashed the whole project page (React #300) 3s after the checklist
  // completed.
  useEffect(() => {
    if (!allComplete || dismissed) return;
    const timer = setTimeout(() => {
      remember(`${STORAGE_PREFIX}${projectId}`);
      setDismissed(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [allComplete, dismissed, projectId]);

  if (dismissed) return null;

  const handleDismiss = () => {
    remember(`${STORAGE_PREFIX}${projectId}`);
    setDismissed(true);
  };

  if (allComplete) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-xs font-medium">
        <CheckCircle2 className="w-4 h-4" />
        All set! Your project is fully configured.
      </div>
    );
  }

  return (
    <section aria-label="Set up this project" className="card-stripe stripe-teal flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
        Set up this project: <span className="text-primary-700 dark:text-primary-300">{completedCount} of {steps.length} done</span>
      </h2>
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((step) => (
          <li key={step.key}>
            <button
              type="button"
              onClick={step.action}
              title={step.tooltip}
              aria-label={`${step.label}: ${step.done ? 'done' : 'not done yet'}. ${step.tooltip}`}
              className={`inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors ${
                step.done
                  ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {step.done ? (
                <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
              ) : (
                <Circle aria-hidden="true" className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
              )}
              {step.label}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={handleDismiss}
        className="ml-auto p-1 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        title="Hide the setup steps"
        aria-label="Hide the setup steps"
      >
        <X aria-hidden="true" className="w-4 h-4" />
      </button>
    </section>
  );
}

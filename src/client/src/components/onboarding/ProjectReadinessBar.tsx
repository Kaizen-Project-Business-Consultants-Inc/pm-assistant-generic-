import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  scheduleId?: string;
  methodology?: Methodology;
  sprintCount?: number;
  onTabChange: (tab: string) => void;
}

const STORAGE_PREFIX = 'readiness-dismissed-';
const STEP_PREFIX = 'readiness-step-';

export function ProjectReadinessBar({ projectId, tasks, resources, scheduleId, methodology = 'waterfall', sprintCount = 0, onTabChange }: ProjectReadinessBarProps) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(`${STORAGE_PREFIX}${projectId}`) === '1'
  );
  const [clickedSteps, setClickedSteps] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(`${STEP_PREFIX}${projectId}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(`${STEP_PREFIX}${projectId}`, JSON.stringify(clickedSteps));
  }, [clickedSteps, projectId]);

  if (dismissed) return null;

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
    else if (cfg.doneKey === 'clicked') done = !!clickedSteps[cfg.clickedStepKey!];

    const action = () => {
      if (cfg.clickedStepKey) {
        setClickedSteps(prev => ({ ...prev, [cfg.clickedStepKey!]: true }));
      }
      if (cfg.targetTab === 'simulation') {
        if (scheduleId) {
          navigate(`/monte-carlo`);
        } else {
          navigate(`/monte-carlo`);
        }
      } else {
        onTabChange(cfg.targetTab);
      }
    };

    return { key: cfg.key, label: cfg.label, tooltip: cfg.tooltip, done, action };
  });

  const completedCount = steps.filter(s => s.done).length;
  const allComplete = completedCount === steps.length;

  // Auto-dismiss after 3 seconds when all steps are complete
  useEffect(() => {
    if (!allComplete) return;
    const timer = setTimeout(() => {
      localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, '1');
      setDismissed(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [allComplete, projectId]);

  const handleDismiss = () => {
    localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, '1');
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
    <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
      {steps.map((step, i) => (
        <span key={step.key} className="contents">
          {i > 0 && <span className="text-gray-300 dark:text-gray-600 text-xs mx-0.5 flex-shrink-0 hidden sm:inline">&middot;</span>}
          <button
            onClick={step.action}
            title={step.tooltip}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              step.done
                ? 'text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
            )}
            {step.label}
          </button>
        </span>
      ))}
      <span className="ml-auto flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {completedCount}/{steps.length} ready
        </span>
        <button
          onClick={handleDismiss}
          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
}

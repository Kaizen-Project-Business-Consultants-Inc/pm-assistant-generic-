import React from 'react';
import { Clock, ChevronRight, ArrowLeft } from 'lucide-react';

interface TemplateTaskItem {
  refId: string;
  name: string;
  description: string;
  estimatedDays: number;
  priority: string;
  parentRefId: string | null;
  dependencyRefId: string | null;
  isSummary: boolean;
}

interface TemplatePreviewProps {
  template: {
    name: string;
    description: string;
    estimatedDurationDays: number;
    tasks: TemplateTaskItem[];
  };
  onBack: () => void;
  onSelect: () => void;
}

const priorityColors: Record<string, string> = {
  urgent: 'text-red-600 bg-red-50',
  high: 'text-orange-600 bg-orange-50',
  medium: 'text-yellow-600 bg-yellow-50',
  low: 'text-green-600 bg-green-50',
};

export const TemplatePreview: React.FC<TemplatePreviewProps> = ({ template, onBack, onSelect }) => {
  const phases = template.tasks.filter(t => t.isSummary);
  const phaseCount = phases.length;
  const taskCount = template.tasks.filter(t => !t.isSummary).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
          <Clock className="w-3 h-3" />
          ~{template.estimatedDurationDays} days
          <span className="mx-1">|</span>
          {phaseCount} phases, {taskCount} tasks
        </div>
      </div>

      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{template.name}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{template.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1 mb-4" style={{ maxHeight: '340px' }}>
        {template.tasks.map((task) => {
          const isPhase = task.isSummary;
          const isChild = !!task.parentRefId;
          const pColor = priorityColors[task.priority] || priorityColors.medium;

          return (
            <div
              key={task.refId}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${
                isPhase ? 'bg-gray-50 dark:bg-gray-700/50 font-medium' : ''
              } ${isChild && !isPhase ? 'ml-5' : ''}`}
            >
              {isChild && !isPhase && (
                <ChevronRight className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
              )}
              <span className={`text-xs flex-1 ${isPhase ? 'text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'}`}>
                {task.name}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${pColor}`}>
                {task.priority}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500 w-12 text-right flex-shrink-0">
                {task.estimatedDays}d
              </span>
            </div>
          );
        })}
      </div>

      <button
        onClick={onSelect}
        className="w-full py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
      >
        Use This Template
      </button>
    </div>
  );
};

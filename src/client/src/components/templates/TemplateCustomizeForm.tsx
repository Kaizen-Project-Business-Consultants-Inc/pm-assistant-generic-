import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ArrowLeft, Calendar, DollarSign, MapPin, ChevronDown, Lock } from 'lucide-react';

interface TemplateTask {
  refId: string;
  name: string;
  description: string;
  estimatedDays: number;
  parentRefId: string | null;
  dependencyRefId: string | null;
  isSummary: boolean;
  mandatory?: boolean;
}

interface TemplateCustomizeFormProps {
  templateName: string;
  estimatedDurationDays: number;
  phaseCount: number;
  taskCount: number;
  tasks: TemplateTask[];
  onBack: () => void;
  defaultMethodology?: string;
  onSubmit: (data: {
    projectName: string;
    startDate: string;
    budget?: number;
    priority: string;
    methodology?: string;
    location?: string;
    selectedTaskRefIds?: string[];
  }) => void;
  isSubmitting: boolean;
  extraContent?: React.ReactNode;
}

export const TemplateCustomizeForm: React.FC<TemplateCustomizeFormProps> = ({
  templateName,
  estimatedDurationDays,
  phaseCount,
  taskCount,
  tasks,
  defaultMethodology,
  onBack,
  onSubmit,
  isSubmitting,
  extraContent,
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [projectName, setProjectName] = useState(templateName || '');
  const [startDate, setStartDate] = useState(today);
  const [budget, setBudget] = useState('');
  const [priority, setPriority] = useState('medium');
  const [methodology, setMethodology] = useState(defaultMethodology || 'waterfall');
  const [location, setLocation] = useState('');
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(() => new Set(tasks.map(t => t.refId)));
  const [taskSectionExpanded, setTaskSectionExpanded] = useState(false);
  const [cascadeWarning, setCascadeWarning] = useState<string | null>(null);

  // Lookup maps
  const taskByRefId = useMemo(() => {
    const map = new Map<string, TemplateTask>();
    for (const t of tasks) map.set(t.refId, t);
    return map;
  }, [tasks]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of tasks) {
      if (t.parentRefId) {
        const children = map.get(t.parentRefId) || [];
        children.push(t.refId);
        map.set(t.parentRefId, children);
      }
    }
    return map;
  }, [tasks]);

  const dependentsByRefId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of tasks) {
      if (t.dependencyRefId) {
        const deps = map.get(t.dependencyRefId) || [];
        deps.push(t.refId);
        map.set(t.dependencyRefId, deps);
      }
    }
    return map;
  }, [tasks]);

  // Auto-dismiss cascade warning
  useEffect(() => {
    if (cascadeWarning) {
      const timer = setTimeout(() => setCascadeWarning(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [cascadeWarning]);

  const toggleTask = useCallback((refId: string) => {
    const task = taskByRefId.get(refId);
    if (!task || task.mandatory) return;

    setSelectedRefIds(prev => {
      const next = new Set(prev);
      const isSelected = next.has(refId);

      if (isSelected) {
        // UNCHECKING: remove task + children + downstream dependents
        const toRemove: string[] = [];

        const collectRemovals = (id: string) => {
          const t = taskByRefId.get(id);
          if (!t || t.mandatory) return;
          toRemove.push(id);
          // Remove children of summary tasks
          const children = childrenByParent.get(id) || [];
          for (const childId of children) {
            if (next.has(childId)) collectRemovals(childId);
          }
          // Remove downstream dependents
          const dependents = dependentsByRefId.get(id) || [];
          for (const depId of dependents) {
            if (next.has(depId)) collectRemovals(depId);
          }
        };

        collectRemovals(refId);

        // Deduplicate and remove
        const uniqueRemovals = [...new Set(toRemove)];
        for (const id of uniqueRemovals) next.delete(id);

        // Also uncheck parent summary if all its children are now deselected
        if (task.parentRefId) {
          const siblings = childrenByParent.get(task.parentRefId) || [];
          const anyChildSelected = siblings.some(s => next.has(s));
          if (!anyChildSelected) {
            const parent = taskByRefId.get(task.parentRefId);
            if (parent && !parent.mandatory) {
              next.delete(task.parentRefId);
            }
          }
        }

        if (uniqueRemovals.length > 1) {
          setCascadeWarning(`${uniqueRemovals.length} tasks deselected (dependents auto-removed)`);
        }
      } else {
        // CHECKING: add task + parent summary + prerequisite dependency
        next.add(refId);
        // Auto-add parent summary
        if (task.parentRefId) {
          next.add(task.parentRefId);
        }
        // Auto-add prerequisite dependency
        if (task.dependencyRefId && taskByRefId.has(task.dependencyRefId)) {
          next.add(task.dependencyRefId);
          // Also add the dependency's parent if it has one
          const dep = taskByRefId.get(task.dependencyRefId);
          if (dep?.parentRefId) {
            next.add(dep.parentRefId);
          }
        }
      }

      return next;
    });
  }, [taskByRefId, childrenByParent, dependentsByRefId]);

  const totalTasks = tasks.length;
  const selectedCount = selectedRefIds.size;
  const allSelected = selectedCount === totalTasks;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      projectName,
      startDate,
      budget: budget ? parseFloat(budget) : undefined,
      priority,
      methodology,
      location: location || undefined,
      selectedTaskRefIds: allSelected ? undefined : [...selectedRefIds],
    });
  };

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
      </div>

      {templateName && (
        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs font-medium text-primary-700 dark:text-primary-400">Template: {templateName}</p>
          <p className="text-xs text-primary-500 dark:text-primary-400/70 mt-0.5">
            {phaseCount} phases, {taskCount} tasks, ~{estimatedDurationDays} days
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex-1 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Project Name *</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            placeholder="My Project"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            <Calendar className="w-3 h-3 inline mr-1" />
            Start Date *
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            <DollarSign className="w-3 h-3 inline mr-1" />
            Budget (USD)
          </label>
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            min="0"
            step="1000"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            placeholder="Optional"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 bg-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Methodology</label>
            <select
              value={methodology}
              onChange={(e) => setMethodology(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 bg-white"
            >
              <option value="waterfall">Waterfall</option>
              <option value="agile">Agile</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            <MapPin className="w-3 h-3 inline mr-1" />
            Location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            placeholder="e.g. New York, NY"
          />
        </div>

        {/* Task Selection (only shown when template has tasks) */}
        {tasks.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setTaskSectionExpanded(!taskSectionExpanded)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Tasks: {selectedCount}/{totalTasks} selected
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${taskSectionExpanded ? 'rotate-180' : ''}`} />
            </button>

            {taskSectionExpanded && (
              <div className="max-h-52 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
                {tasks.map((t) => {
                  const isSelected = selectedRefIds.has(t.refId);
                  const isMandatory = !!t.mandatory;
                  const indent = t.parentRefId ? 'pl-6' : 'pl-3';

                  return (
                    <label
                      key={t.refId}
                      className={`flex items-center gap-2 px-1 py-1.5 ${indent} hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${
                        t.isSummary ? 'bg-gray-50/50 dark:bg-gray-700/30' : ''
                      }`}
                    >
                      {isMandatory ? (
                        <Lock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTask(t.refId)}
                          className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 flex-shrink-0"
                        />
                      )}
                      <span
                        className={`text-xs flex-1 ${
                          !isSelected ? 'line-through text-gray-400 dark:text-gray-500' : t.isSummary ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {t.name}
                      </span>
                      {isMandatory && (
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">
                          Required
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {t.estimatedDays}d
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Cascade warning toast */}
            {cascadeWarning && (
              <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
                {cascadeWarning}
              </div>
            )}
          </div>
        )}

        {extraContent}

        <button
          type="submit"
          disabled={!projectName || !startDate || isSubmitting}
          className="w-full py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {isSubmitting ? 'Creating Project…' : 'Create Project'}
        </button>
      </form>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { X, Save, Trash2, Sparkles } from 'lucide-react';
import type { GanttTask } from './GanttChart';
import { TaskActivityPanel } from './TaskActivityPanel';
import { TimeLogForm } from '../timetracking/TimeLogForm';
import { CustomFieldsSection } from '../customfields/CustomFieldsSection';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { apiService } from '../../services/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredecessorEntry {
  dependencyId: string;
  dependencyType: string;
  lagDays: string;
}

export interface TaskFormData {
  name: string;
  description: string;
  status: string;
  priority: string;
  assignedTo: string;
  startDate: string;
  endDate: string;
  progressPercentage: number;
  /** @deprecated — kept for backward compat; use predecessors[] */
  dependency: string;
  /** @deprecated */
  dependencyType: string;
  /** @deprecated */
  dependencyLagDays: string;
  parentTaskId: string;
  estimatedDays: string;
  recurrenceRule: string;
  isRecurrenceTemplate: boolean;
  isMilestone: boolean;
  predecessors: PredecessorEntry[];
}

interface TaskFormModalProps {
  /** null = create mode, object = edit mode */
  task: GanttTask | null;
  /** All tasks in the schedule (for dependency & parent dropdowns) */
  allTasks: GanttTask[];
  onSave: (data: TaskFormData) => void;
  onDelete?: (taskId: string) => void;
  onClose: () => void;
  isSaving?: boolean;
  /** Schedule ID for comments/activity panel */
  scheduleId?: string;
  /** Project ID for custom fields, time tracking, and attachments */
  projectId?: string;
  /** ID of the currently active/selected task (used to pre-fill parent in create mode) */
  activeTaskId?: string | null;
  /** Pre-fill start date in create mode (from drag-to-create) */
  initialStartDate?: string;
  /** Pre-fill end date in create mode (from drag-to-create) */
  initialEndDate?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toInputDate(s?: string): string {
  if (!s) return '';
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskFormModal({
  task,
  allTasks,
  onSave,
  onDelete,
  onClose,
  isSaving,
  scheduleId,
  projectId,
  activeTaskId,
  initialStartDate,
  initialEndDate,
}: TaskFormModalProps) {
  const isEdit = !!task;

  const [form, setForm] = useState<TaskFormData>({
    name: '',
    description: '',
    status: 'pending',
    priority: 'medium',
    assignedTo: '',
    startDate: initialStartDate || '',
    endDate: initialEndDate || '',
    progressPercentage: 0,
    dependency: '',
    parentTaskId: '',
    estimatedDays: '',
    recurrenceRule: '',
    isRecurrenceTemplate: false,
    dependencyType: 'FS',
    dependencyLagDays: '',
    isMilestone: false,
    predecessors: [],
  });

  // Pre-fill form when editing
  useEffect(() => {
    if (task) {
      const deps: PredecessorEntry[] = task.dependencies?.length
        ? task.dependencies.map((d) => ({
            dependencyId: d.dependencyId,
            dependencyType: d.dependencyType || 'FS',
            lagDays: d.lagDays?.toString() || '0',
          }))
        : task.dependency
          ? [{ dependencyId: task.dependency, dependencyType: task.dependencyType || 'FS', lagDays: task.dependencyLagDays?.toString() || '0' }]
          : [];
      setForm({
        name: task.name || '',
        description: task.description || '',
        status: task.status || 'pending',
        priority: task.priority || 'medium',
        assignedTo: task.assignedTo || '',
        startDate: toInputDate(task.startDate),
        endDate: toInputDate(task.endDate),
        progressPercentage: task.progressPercentage ?? 0,
        dependency: task.dependency || '',
        parentTaskId: task.parentTaskId || '',
        estimatedDays: task.estimatedDays?.toString() || '',
        recurrenceRule: task.recurrenceRule || '',
        isRecurrenceTemplate: task.isRecurrenceTemplate || false,
        dependencyType: task.dependencyType || 'FS',
        dependencyLagDays: task.dependencyLagDays?.toString() || '',
        isMilestone: task.isMilestone || false,
        predecessors: deps,
      });
    }
  }, [task]);

  // Pre-fill parentTaskId based on active task context (create mode only)
  useEffect(() => {
    if (isEdit || !activeTaskId) return;
    const activeTask = allTasks.find(t => t.id === activeTaskId);
    if (!activeTask) return;
    const hasChildren = allTasks.some(t => t.parentTaskId === activeTask.id);
    if (hasChildren) {
      // Active task is a parent — new task becomes its child
      setForm(f => ({ ...f, parentTaskId: activeTask.id }));
    } else if (activeTask.parentTaskId) {
      // Active task is a child — new task becomes sibling (same parent)
      setForm(f => ({ ...f, parentTaskId: activeTask.parentTaskId || '' }));
    }
    // If active task is a top-level leaf, no parent pre-fill
  }, [isEdit, activeTaskId, allTasks]);

  const [estimating, setEstimating] = useState(false);
  const [estimationHint, setEstimationHint] = useState<string | null>(null);

  const handleAiEstimate = async () => {
    if (!form.name.trim() || !projectId) return;
    setEstimating(true);
    setEstimationHint(null);
    try {
      const res = await apiService.estimateTaskDuration({
        taskName: form.name,
        taskDescription: form.description || undefined,
        projectId,
        scheduleId: scheduleId || undefined,
      });
      const est = res.estimation;
      setForm((prev) => ({ ...prev, estimatedDays: String(est.estimatedDays) }));
      setEstimationHint(`${est.estimatedDays}d (${est.confidence}% confidence) — ${est.reasoning}`);
    } catch {
      setEstimationHint('Estimation failed. Try again later.');
    } finally {
      setEstimating(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
    setForm((prev) => ({ ...prev, progressPercentage: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
  };

  // Filter tasks for dependency/parent dropdowns (exclude self)
  const otherTasks = allTasks.filter((t) => t.id !== task?.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh]" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="task-form-title" className="text-base font-bold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Edit Task' : 'Add Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Task Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Task Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Site Survey & Analysis"
              className="input w-full"
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Description
            </label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={2}
              placeholder="Brief description of the task..."
              className="input w-full resize-none"
            />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className="input w-full"
              >
                <option value="pending">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Priority</label>
              <select
                name="priority"
                value={form.priority}
                onChange={handleChange}
                className="input w-full"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Dates row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date</label>
              <input
                type="date"
                name="startDate"
                value={form.startDate}
                onChange={handleChange}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Date</label>
              <input
                type="date"
                name="endDate"
                value={form.endDate}
                onChange={handleChange}
                className="input w-full"
              />
            </div>
          </div>

          {/* Progress + Estimated Days */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Progress: {form.progressPercentage}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={form.progressPercentage}
                onChange={handleProgressChange}
                className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Est. Duration (days)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  name="estimatedDays"
                  value={form.estimatedDays}
                  onChange={handleChange}
                  min="0.25"
                  step="0.25"
                  placeholder="—"
                  className="input flex-1"
                />
                {projectId && (
                  <button
                    type="button"
                    onClick={handleAiEstimate}
                    disabled={estimating || !form.name.trim()}
                    title="AI Estimate"
                    aria-label="AI Estimate duration"
                    className="px-2 py-1.5 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    {estimating ? (
                      <div className="w-3.5 h-3.5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
              {estimationHint && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">{estimationHint}</p>
              )}
            </div>
          </div>

          {/* Assigned To */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Assigned To</label>
            <input
              type="text"
              name="assignedTo"
              value={form.assignedTo}
              onChange={handleChange}
              placeholder="Person or team name"
              className="input w-full"
            />
          </div>

          {/* Parent Task */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Parent Task</label>
            <select
              name="parentTaskId"
              value={form.parentTaskId}
              onChange={handleChange}
              className="input w-full"
            >
              <option value="">None (top-level)</option>
              {otherTasks
                .filter((t) => !t.parentTaskId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Multi-predecessor list */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Predecessors ({form.predecessors.length}/20)
            </label>
            {form.predecessors.map((pred, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <select
                  value={pred.dependencyId}
                  onChange={(e) => {
                    const updated = [...form.predecessors];
                    updated[idx] = { ...updated[idx], dependencyId: e.target.value };
                    setForm(f => ({ ...f, predecessors: updated }));
                  }}
                  className="input flex-1 text-xs"
                >
                  <option value="">Select task...</option>
                  {otherTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <select
                  value={pred.dependencyType}
                  onChange={(e) => {
                    const updated = [...form.predecessors];
                    updated[idx] = { ...updated[idx], dependencyType: e.target.value };
                    setForm(f => ({ ...f, predecessors: updated }));
                  }}
                  className="input w-16 text-xs"
                >
                  <option value="FS">FS</option>
                  <option value="SS">SS</option>
                  <option value="FF">FF</option>
                  <option value="SF">SF</option>
                </select>
                <input
                  type="number"
                  value={pred.lagDays}
                  onChange={(e) => {
                    const updated = [...form.predecessors];
                    updated[idx] = { ...updated[idx], lagDays: e.target.value };
                    setForm(f => ({ ...f, predecessors: updated }));
                  }}
                  placeholder="Lag"
                  className="input w-16 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    const updated = form.predecessors.filter((_, i) => i !== idx);
                    setForm(f => ({ ...f, predecessors: updated }));
                  }}
                  className="text-red-400 hover:text-red-600 text-xs px-1"
                  title="Remove predecessor"
                >
                  &times;
                </button>
              </div>
            ))}
            {form.predecessors.length < 20 && (
              <button
                type="button"
                onClick={() => {
                  setForm(f => ({
                    ...f,
                    predecessors: [...f.predecessors, { dependencyId: '', dependencyType: 'FS', lagDays: '0' }],
                  }));
                }}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                + Add Predecessor
              </button>
            )}
          </div>

          {/* Milestone checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isMilestone}
              onChange={(e) => setForm((prev) => ({ ...prev, isMilestone: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Mark as Milestone</span>
          </label>

          {/* Recurrence */}
          <RecurrenceSection form={form} setForm={setForm} isRecurringInstance={!!task?.recurrenceParentId} />

          {/* Time Tracking (edit mode only) */}
          {isEdit && scheduleId && projectId && task && (
            <TimeLogForm taskId={task.id} scheduleId={scheduleId} projectId={projectId} />
          )}

          {/* Custom Fields (edit mode only) */}
          {isEdit && projectId && task && (
            <CustomFieldsSection entityType="task" entityId={task.id} projectId={projectId} />
          )}

          {/* Attachments (edit mode only) */}
          {isEdit && task && (
            <AttachmentPanel entityType="task" entityId={task.id} />
          )}

          {/* Comments & Activity (edit mode only) */}
          {isEdit && scheduleId && task && (
            <TaskActivityPanel scheduleId={scheduleId} taskId={task.id} />
          )}
        </form>

        {/* Footer buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
          <div>
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (task && confirm('Delete this task?')) {
                    onDelete(task.id);
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={isSaving || !form.name.trim()}
              className="btn btn-primary flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {isEdit ? 'Update Task' : 'Create Task'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recurrence section
// ---------------------------------------------------------------------------

const DAYS_OF_WEEK = [
  { key: 'MO', label: 'Mon' },
  { key: 'TU', label: 'Tue' },
  { key: 'WE', label: 'Wed' },
  { key: 'TH', label: 'Thu' },
  { key: 'FR', label: 'Fri' },
  { key: 'SA', label: 'Sat' },
  { key: 'SU', label: 'Sun' },
];

function parseFrequency(rule: string): string {
  if (!rule) return 'none';
  if (rule.startsWith('FREQ=DAILY')) return 'daily';
  if (rule.startsWith('FREQ=BIWEEKLY')) return 'biweekly';
  if (rule.startsWith('FREQ=WEEKLY')) return 'weekly';
  if (rule.startsWith('FREQ=MONTHLY')) return 'monthly';
  return 'none';
}

function parseDays(rule: string): string[] {
  const match = rule.match(/BYDAY=([A-Z,]+)/);
  return match ? match[1].split(',') : [];
}

function buildRule(freq: string, days: string[]): string {
  if (freq === 'none') return '';
  let rule = `FREQ=${freq.toUpperCase()}`;
  if ((freq === 'weekly' || freq === 'biweekly') && days.length > 0) {
    rule += `;BYDAY=${days.join(',')}`;
  }
  return rule;
}

function RecurrenceSection({
  form,
  setForm,
  isRecurringInstance,
}: {
  form: TaskFormData;
  setForm: React.Dispatch<React.SetStateAction<TaskFormData>>;
  isRecurringInstance: boolean;
}) {
  const freq = parseFrequency(form.recurrenceRule);
  const selectedDays = parseDays(form.recurrenceRule);

  if (isRecurringInstance) {
    return (
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-3 py-2">
        <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">This is a recurring task instance</span>
      </div>
    );
  }

  const setFreq = (newFreq: string) => {
    const rule = buildRule(newFreq, selectedDays);
    setForm(prev => ({
      ...prev,
      recurrenceRule: rule,
      isRecurrenceTemplate: newFreq !== 'none',
    }));
  };

  const toggleDay = (day: string) => {
    const newDays = selectedDays.includes(day)
      ? selectedDays.filter(d => d !== day)
      : [...selectedDays, day];
    const rule = buildRule(freq, newDays);
    setForm(prev => ({ ...prev, recurrenceRule: rule }));
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Recurrence</label>
      <div className="flex items-center gap-3">
        <select
          value={freq}
          onChange={e => setFreq(e.target.value)}
          className="input"
        >
          <option value="none">None</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Biweekly</option>
          <option value="monthly">Monthly</option>
        </select>

        {(freq === 'weekly' || freq === 'biweekly') && (
          <div className="flex gap-1">
            {DAYS_OF_WEEK.map(d => (
              <button
                key={d.key}
                type="button"
                onClick={() => toggleDay(d.key)}
                className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors ${
                  selectedDays.includes(d.key)
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

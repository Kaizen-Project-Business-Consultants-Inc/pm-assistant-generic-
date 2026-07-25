import React, { useState, useCallback, useEffect, useMemo } from 'react';

export interface KanbanTask {
  id: string;
  name: string;
  description?: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  dueDate?: string;
  endDate?: string;
  progressPercentage?: number;
  isMilestone?: boolean;
  parentTaskId?: string;
}

interface KanbanBoardProps {
  tasks: KanbanTask[];
  allTasks?: KanbanTask[];
  onTaskClick?: (task: KanbanTask) => void;
  onStatusChange?: (taskId: string, newStatus: string) => void;
  onQuickAdd?: (name: string, status: string) => void;
  scheduleId?: string;
  activeTaskId?: string | null;
}

const COLUMNS: { id: string; label: string; color: string; bg: string; border: string }[] = [
  { id: 'pending', label: 'Pending', color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-800/50', border: 'border-gray-200 dark:border-gray-600' },
  { id: 'in_progress', label: 'In Progress', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-700' },
  { id: 'completed', label: 'Completed', color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-700' },
  { id: 'cancelled', label: 'Cancelled', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-700' },
];

const priorityOrder: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const priorityBadge: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
  high: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
  medium: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
  low: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(s?: string): string {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function isOverdue(s?: string): boolean {
  if (!s) return false;
  try {
    return new Date(s).getTime() < Date.now();
  } catch {
    return false;
  }
}

const WIP_STORAGE_KEY = 'pm-kanban-wip-limits';

function loadWipLimits(scheduleId: string): Record<string, number> {
  try {
    const stored = localStorage.getItem(`${WIP_STORAGE_KEY}-${scheduleId}`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

function saveWipLimits(scheduleId: string, limits: Record<string, number>) {
  try {
    localStorage.setItem(`${WIP_STORAGE_KEY}-${scheduleId}`, JSON.stringify(limits));
  } catch {}
}

type SwimlaneSetting = '' | 'assignee' | 'priority';

export function KanbanBoard({ tasks, allTasks, onTaskClick, onStatusChange, onQuickAdd, scheduleId, activeTaskId }: KanbanBoardProps) {
  const [quickAddColumn, setQuickAddColumn] = useState<string | null>(null);
  const [quickAddValue, setQuickAddValue] = useState('');
  const quickAddRef = React.useRef<HTMLInputElement>(null);
  const [swimlane, setSwimlane] = useState<SwimlaneSetting>('');

  // Compute swimlane groups
  const swimlaneGroups = useMemo(() => {
    if (!swimlane) return null;
    const groups = new Map<string, KanbanTask[]>();
    for (const task of tasks) {
      let key: string;
      if (swimlane === 'assignee') key = task.assignedTo || 'Unassigned';
      else key = task.priority || 'medium';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }
    // Sort keys
    if (swimlane === 'priority') {
      const order = ['urgent', 'high', 'medium', 'low'];
      return new Map([...groups.entries()].sort((a, b) => (order.indexOf(a[0]) ?? 99) - (order.indexOf(b[0]) ?? 99)));
    }
    return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [tasks, swimlane]);

  const handleQuickAddSubmit = useCallback((columnId: string) => {
    const name = quickAddValue.trim();
    if (name && onQuickAdd) {
      onQuickAdd(name, columnId);
      setQuickAddValue('');
      setQuickAddColumn(null);
    }
  }, [quickAddValue, onQuickAdd]);

  React.useEffect(() => {
    if (quickAddColumn && quickAddRef.current) quickAddRef.current.focus();
  }, [quickAddColumn]);
  // Precompute subtask counts and dependency counts from allTasks (or tasks if allTasks not provided)
  const sourceTasks = allTasks || tasks;
  const subtaskCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of sourceTasks) {
      if (t.parentTaskId) {
        counts[t.parentTaskId] = (counts[t.parentTaskId] || 0) + 1;
      }
    }
    return counts;
  }, [sourceTasks]);

  const dependencyCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of sourceTasks) {
      const deps = (t as any).dependencies;
      if (Array.isArray(deps) && deps.length > 0) {
        counts[t.id] = deps.length;
      }
    }
    return counts;
  }, [sourceTasks]);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [wipLimits, setWipLimits] = useState<Record<string, number>>(() =>
    loadWipLimits(scheduleId || 'default')
  );

  useEffect(() => {
    saveWipLimits(scheduleId || 'default', wipLimits);
  }, [wipLimits, scheduleId]);

  const handleSetWipLimit = useCallback((columnId: string) => {
    const current = wipLimits[columnId] || 0;
    const input = prompt(`Set WIP limit for this column (0 = no limit):`, String(current));
    if (input === null) return;
    const val = parseInt(input, 10);
    if (isNaN(val) || val < 0) return;
    setWipLimits(prev => ({ ...prev, [columnId]: val }));
  }, [wipLimits]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
      e.dataTransfer.setData('text/plain', taskId);
      e.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, columnId: string) => {
      e.preventDefault();
      setDragOverColumn(null);
      const taskId = e.dataTransfer.getData('text/plain');
      if (taskId && onStatusChange) {
        const task = tasks.find((t) => t.id === taskId);
        if (task && task.status !== columnId) {
          onStatusChange(taskId, columnId);
        }
      }
    },
    [tasks, onStatusChange],
  );

  // Group tasks by status and sort by priority
  const groupTasksByStatus = (taskList: KanbanTask[]) => {
    const grouped: Record<string, KanbanTask[]> = {};
    for (const col of COLUMNS) {
      grouped[col.id] = taskList
        .filter((t) => t.status === col.id)
        .sort((a, b) => (priorityOrder[a.priority || 'medium'] ?? 2) - (priorityOrder[b.priority || 'medium'] ?? 2));
    }
    return grouped;
  };

  const grouped = groupTasksByStatus(tasks);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Kanban Board</h3>
          <span className="text-xs text-gray-400">{tasks.length} tasks</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Swimlane</span>
          <select
            value={swimlane}
            onChange={(e) => setSwimlane(e.target.value as SwimlaneSetting)}
            className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            <option value="">None</option>
            <option value="assignee">By Assignee</option>
            <option value="priority">By Priority</option>
          </select>
        </div>
      </div>

      {swimlaneGroups ? (
        // Swimlane view
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {/* Column headers */}
          <div className="flex gap-3 px-4 pt-3 pb-2 overflow-x-auto">
            <div className="w-32 flex-shrink-0" />
            {COLUMNS.map(col => (
              <div key={col.id} className="flex-1 min-w-[200px]">
                <span className={`text-xs font-semibold uppercase tracking-wide ${col.color}`}>{col.label}</span>
              </div>
            ))}
          </div>
          {[...swimlaneGroups.entries()].map(([laneKey, laneTasks]) => {
            const laneGrouped = groupTasksByStatus(laneTasks);
            return (
              <div key={laneKey} className="flex gap-3 px-4 py-3">
                {/* Swimlane label */}
                <div className="w-32 flex-shrink-0 pt-1">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 capitalize">{laneKey.replace(/_/g, ' ')}</span>
                  <span className="block text-[10px] text-gray-400 dark:text-gray-500">{laneTasks.length} tasks</span>
                </div>
                {/* Mini columns */}
                {COLUMNS.map(col => {
                  const columnTasks = laneGrouped[col.id] || [];
                  return (
                    <div
                      key={col.id}
                      className={`flex-1 min-w-[200px] rounded-lg border ${col.border} ${col.bg} p-2`}
                      onDragOver={(e) => handleDragOver(e, col.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, col.id)}
                    >
                      {columnTasks.length === 0 ? (
                        <div className="text-center py-4 text-[10px] text-gray-300 dark:text-gray-600">—</div>
                      ) : (
                        <div className="space-y-1.5">
                          {columnTasks.map(task => (
                            <div
                              key={task.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, task.id)}
                              onClick={() => onTaskClick?.(task)}
                              className={`bg-white dark:bg-gray-700 rounded-md border p-2 text-xs cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow ${activeTaskId === task.id ? 'border-primary-400 ring-1 ring-primary-200' : 'border-gray-200 dark:border-gray-600'}`}
                            >
                              <span className="font-medium text-gray-900 dark:text-gray-100 line-clamp-1">{task.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
      <div className="flex gap-3 p-4 overflow-x-auto" style={{ minHeight: '400px' }}>
        {COLUMNS.map((col) => {
          const columnTasks = grouped[col.id] || [];
          const isOver = dragOverColumn === col.id;
          const wipLimit = wipLimits[col.id] || 0;
          const isOverWip = wipLimit > 0 && columnTasks.length >= wipLimit;

          return (
            <div
              key={col.id}
              className={`flex-1 min-w-[240px] rounded-lg border ${col.border} ${col.bg} transition-all ${
                isOver ? 'ring-2 ring-primary-400 ring-opacity-50' : ''
              } ${isOverWip ? 'ring-2 ring-amber-400' : ''}`}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2.5 border-b border-gray-200/60 dark:border-gray-600 ${isOverWip ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${col.color}`}>
                    {col.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 ${isOverWip ? 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200' : 'bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300'}`}>
                    {columnTasks.length}{wipLimit > 0 ? `/${wipLimit}` : ''}
                  </span>
                  <button
                    onClick={() => handleSetWipLimit(col.id)}
                    className="text-gray-300 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
                    title="Set WIP limit"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {columnTasks.length === 0 && (
                  <div className="text-center py-8 text-xs text-gray-400">
                    {isOver ? 'Drop here' : 'No tasks'}
                  </div>
                )}

                {columnTasks.map((task) => {
                  const pBadge = priorityBadge[task.priority || 'medium'] || priorityBadge.medium;
                  const due = task.dueDate || task.endDate;
                  const overdue = (task.status !== 'completed' && task.status !== 'cancelled') && isOverdue(due);

                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onClick={() => onTaskClick?.(task)}
                      className={`bg-white dark:bg-gray-700 rounded-lg border p-3 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing group ${activeTaskId === task.id ? 'border-primary-400 ring-1 ring-primary-200' : 'border-gray-200 dark:border-gray-600'}`}
                    >
                      {/* Title */}
                      <div className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-2 line-clamp-2 group-hover:text-primary-600 transition-colors flex items-center gap-1.5">
                        {task.isMilestone && <span className="w-2.5 h-2.5 flex-shrink-0 rotate-45 bg-primary-500 inline-block" title="Milestone" />}
                        {task.name}
                      </div>

                      {/* Priority + Due date */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${pBadge.bg} ${pBadge.text} capitalize`}>
                          {task.priority || 'medium'}
                        </span>

                        {due && (
                          <span className={`text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                            {overdue ? 'Overdue ' : ''}{formatDate(due)}
                          </span>
                        )}
                      </div>

                      {/* Subtask + Dependency badges */}
                      {((subtaskCounts[task.id] || 0) > 0 || (dependencyCounts[task.id] || 0) > 0) && (
                        <div className="flex items-center gap-2 mt-1.5">
                          {subtaskCounts[task.id] > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500" title={`${subtaskCounts[task.id]} subtask${subtaskCounts[task.id] > 1 ? 's' : ''}`}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />
                              </svg>
                              {subtaskCounts[task.id]}
                            </span>
                          )}
                          {dependencyCounts[task.id] > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500" title={`${dependencyCounts[task.id]} dependenc${dependencyCounts[task.id] > 1 ? 'ies' : 'y'}`}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                              {dependencyCounts[task.id]}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Progress bar */}
                      {(task.progressPercentage ?? 0) > 0 && task.status !== 'completed' && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-gray-400 mb-0.5">
                            <span>Progress</span>
                            <span>{task.progressPercentage}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-600">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${Math.min(task.progressPercentage || 0, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Assignee */}
                      {task.assignedTo && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-[8px] font-bold">
                            {getInitials(task.assignedTo)}
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{task.assignedTo}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quick-add */}
              {onQuickAdd && (
                <div className="px-2 pb-2">
                  {quickAddColumn === col.id ? (
                    <div className="flex flex-col gap-1">
                      <input
                        ref={quickAddRef}
                        type="text"
                        value={quickAddValue}
                        onChange={(e) => setQuickAddValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleQuickAddSubmit(col.id);
                          if (e.key === 'Escape') { setQuickAddColumn(null); setQuickAddValue(''); }
                        }}
                        placeholder="Task name..."
                        className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                      />
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleQuickAddSubmit(col.id)}
                          disabled={!quickAddValue.trim()}
                          className="text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 rounded px-2 py-0.5 transition-colors"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => { setQuickAddColumn(null); setQuickAddValue(''); }}
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setQuickAddColumn(col.id); setQuickAddValue(''); }}
                      className="w-full text-left text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1.5 px-1 rounded hover:bg-white/50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      + Add task
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

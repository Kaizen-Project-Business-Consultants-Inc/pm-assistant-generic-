import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Kanban, Settings, Users, ShieldCheck } from 'lucide-react';
import { apiService } from '../../services/api';

interface BoardTask {
  id: string;
  name: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  story_points?: number;
  storyPoints?: number;
  taskType?: string;
  acceptanceCriteria?: string;
}

interface SprintBoardProps {
  sprintId: string;
}

const COLUMNS: { id: string; label: string; headerBg: string; headerText: string; bg: string; border: string; darkHeaderBg: string; darkBg: string; darkBorder: string }[] = [
  { id: 'pending', label: 'Todo', headerBg: 'bg-gray-100', headerText: 'text-gray-700', bg: 'bg-gray-50', border: 'border-gray-200', darkHeaderBg: 'dark:bg-gray-700', darkBg: 'dark:bg-gray-800/50', darkBorder: 'dark:border-gray-600' },
  { id: 'in_progress', label: 'In Progress', headerBg: 'bg-blue-100', headerText: 'text-blue-700', bg: 'bg-blue-50/30', border: 'border-blue-200', darkHeaderBg: 'dark:bg-blue-900/40', darkBg: 'dark:bg-blue-900/10', darkBorder: 'dark:border-blue-800' },
  { id: 'in_review', label: 'In Review', headerBg: 'bg-purple-100', headerText: 'text-purple-700', bg: 'bg-purple-50/30', border: 'border-purple-200', darkHeaderBg: 'dark:bg-purple-900/40', darkBg: 'dark:bg-purple-900/10', darkBorder: 'dark:border-purple-800' },
  { id: 'testing', label: 'Testing', headerBg: 'bg-amber-100', headerText: 'text-amber-700', bg: 'bg-amber-50/30', border: 'border-amber-200', darkHeaderBg: 'dark:bg-amber-900/40', darkBg: 'dark:bg-amber-900/10', darkBorder: 'dark:border-amber-800' },
  { id: 'completed', label: 'Done', headerBg: 'bg-green-100', headerText: 'text-green-700', bg: 'bg-green-50/30', border: 'border-green-200', darkHeaderBg: 'dark:bg-green-900/40', darkBg: 'dark:bg-green-900/10', darkBorder: 'dark:border-green-800' },
];

const taskTypeBadge: Record<string, { bg: string; text: string; label: string }> = {
  story: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Story' },
  bug: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Bug' },
  epic: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', label: 'Epic' },
};

function getAcCount(ac?: string): { checked: number; total: number } | null {
  if (!ac) return null;
  const lines = ac.split('\n').filter(l => l.trim().startsWith('- ['));
  if (lines.length === 0) return null;
  const checked = lines.filter(l => l.includes('[x]') || l.includes('[X]')).length;
  return { checked, total: lines.length };
}

const priorityBadge: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  urgent: { bg: 'bg-red-100', text: 'text-red-700', darkBg: 'dark:bg-red-900/30', darkText: 'dark:text-red-300' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', darkBg: 'dark:bg-orange-900/30', darkText: 'dark:text-orange-300' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', darkBg: 'dark:bg-yellow-900/30', darkText: 'dark:text-yellow-300' },
  low: { bg: 'bg-green-100', text: 'text-green-700', darkBg: 'dark:bg-green-900/30', darkText: 'dark:text-green-300' },
};

const AVATAR_COLORS = [
  { bg: 'bg-blue-500', text: 'text-white' },
  { bg: 'bg-emerald-500', text: 'text-white' },
  { bg: 'bg-purple-500', text: 'text-white' },
  { bg: 'bg-amber-500', text: 'text-white' },
  { bg: 'bg-rose-500', text: 'text-white' },
  { bg: 'bg-cyan-500', text: 'text-white' },
  { bg: 'bg-indigo-500', text: 'text-white' },
  { bg: 'bg-pink-500', text: 'text-white' },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getAvatarColor(name: string) {
  return AVATAR_COLORS[hashStr(name) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function getPoints(task: BoardTask): number {
  return task.story_points ?? task.storyPoints ?? 0;
}

const WIP_STORAGE_KEY = 'pm-sprint-wip-limits';

function loadWipLimits(sprintId: string): Record<string, number> {
  try {
    const stored = localStorage.getItem(`${WIP_STORAGE_KEY}-${sprintId}`);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

function saveWipLimits(sprintId: string, limits: Record<string, number>) {
  localStorage.setItem(`${WIP_STORAGE_KEY}-${sprintId}`, JSON.stringify(limits));
}

export function SprintBoard({ sprintId }: SprintBoardProps) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [localTaskOverrides, setLocalTaskOverrides] = useState<Record<string, string>>({});
  const [wipLimits, setWipLimits] = useState<Record<string, number>>(() => loadWipLimits(sprintId));
  const [swimlane, setSwimlane] = useState<'none' | 'assignee'>('none');
  const [editingPointsTaskId, setEditingPointsTaskId] = useState<string | null>(null);
  const [editingPointsValue, setEditingPointsValue] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sprintBoard', sprintId],
    queryFn: () => apiService.getSprintBoard(sprintId),
  });

  const board = data?.board ?? data ?? {};
  const scheduleId: string | null = board.scheduleId ?? null;
  const rawTasks: BoardTask[] = board.tasks ?? [];
  const tasks: BoardTask[] = rawTasks.map((t) =>
    localTaskOverrides[t.id] ? { ...t, status: localTaskOverrides[t.id] } : t,
  );

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const { data: dodData } = useQuery({
    queryKey: ['dodReadiness', taskIds.join(',')],
    queryFn: () => apiService.getBulkReadiness('dod', taskIds),
    enabled: taskIds.length > 0,
  });
  const dodReadiness: Record<string, { ready: boolean; checked: number; total: number }> = dodData?.readiness || {};

  const assignees = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.assignedTo) set.add(t.assignedTo); });
    return Array.from(set).sort();
  }, [tasks]);

  const swimlaneGroups = useMemo(() => {
    if (swimlane === 'none') return [{ key: '__all', label: '', tasks }];
    const groups: { key: string; label: string; tasks: BoardTask[] }[] = [];
    for (const a of assignees) {
      groups.push({ key: a, label: a, tasks: tasks.filter((t) => t.assignedTo === a) });
    }
    const unassigned = tasks.filter((t) => !t.assignedTo);
    if (unassigned.length > 0) groups.push({ key: '__unassigned', label: 'Unassigned', tasks: unassigned });
    return groups;
  }, [swimlane, tasks, assignees]);

  const updatePointsMutation = useMutation({
    mutationFn: ({ taskId, storyPoints }: { taskId: string; storyPoints: number }) =>
      apiService.updateSprintTaskPoints(sprintId, taskId, storyPoints),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprintBoard', sprintId] });
    },
  });

  const handlePointsClick = useCallback((taskId: string, currentPoints: number) => {
    setEditingPointsTaskId(taskId);
    setEditingPointsValue(currentPoints > 0 ? String(currentPoints) : '');
  }, []);

  const handlePointsSave = useCallback((taskId: string) => {
    const val = parseInt(editingPointsValue, 10);
    if (!isNaN(val) && val >= 0) {
      updatePointsMutation.mutate({ taskId, storyPoints: val });
    }
    setEditingPointsTaskId(null);
  }, [editingPointsValue, updatePointsMutation]);

  const handlePointsKeyDown = useCallback((e: React.KeyboardEvent, taskId: string) => {
    if (e.key === 'Enter') {
      handlePointsSave(taskId);
    } else if (e.key === 'Escape') {
      setEditingPointsTaskId(null);
    }
  }, [handlePointsSave]);

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) => {
      if (!scheduleId) return Promise.reject(new Error('No scheduleId available'));
      return apiService.updateTask(scheduleId, taskId, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprintBoard', sprintId] });
    },
  });

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
      if (taskId) {
        const task = tasks.find((t) => t.id === taskId);
        if (task && task.status !== columnId) {
          setLocalTaskOverrides((prev) => ({ ...prev, [taskId]: columnId }));
          updateStatusMutation.mutate({ taskId, status: columnId });
        }
      }
    },
    [tasks, updateStatusMutation],
  );

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="animate-pulse flex gap-4">
          <div className="flex-1 h-48 bg-gray-100 dark:bg-gray-700 rounded" />
          <div className="flex-1 h-48 bg-gray-100 dark:bg-gray-700 rounded" />
          <div className="flex-1 h-48 bg-gray-100 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load sprint board.</p>
      </div>
    );
  }

  const handleSetWipLimit = (columnId: string) => {
    const current = wipLimits[columnId];
    const input = prompt(`WIP limit for this column${current ? ` (current: ${current})` : ''}.\nEnter a number or leave blank to remove:`, current?.toString() || '');
    if (input === null) return;
    const val = parseInt(input, 10);
    const next = { ...wipLimits };
    if (!input.trim() || isNaN(val) || val <= 0) {
      delete next[columnId];
    } else {
      next[columnId] = val;
    }
    setWipLimits(next);
    saveWipLimits(sprintId, next);
  };

  const totalPoints = tasks.reduce((sum, t) => sum + getPoints(t), 0);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-wrap">
        <Kanban className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Sprint Board</h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          {totalPoints > 0 && <> · {totalPoints} pts</>}
        </span>
        <div className="ml-auto">
          <button
            onClick={() => setSwimlane((s) => (s === 'none' ? 'assignee' : 'none'))}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors ${
              swimlane !== 'none'
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title="Toggle swimlanes by assignee"
          >
            <Users className="w-3 h-3" />
            <span className="hidden sm:inline">Swimlane</span>
          </button>
        </div>
      </div>

      {swimlaneGroups.map((group) => (
        <div key={group.key}>
          {group.label && (
            <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
              <div className="flex items-center gap-2">
                {group.key !== '__unassigned' && (
                  <div className={`w-5 h-5 rounded-full ${getAvatarColor(group.label).bg} ${getAvatarColor(group.label).text} flex items-center justify-center text-[8px] font-bold`}>
                    {getInitials(group.label)}
                  </div>
                )}
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{group.label}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          )}
          <div className="flex gap-3 p-4 overflow-x-auto" style={{ minHeight: group.label ? '200px' : '400px' }}>
            {COLUMNS.map((col) => {
              const columnTasks = group.tasks.filter((t) => {
                if (t.status === col.id) return true;
                // blocked/cancelled tasks show in Todo column with a badge
                if (col.id === 'pending' && (t.status === 'blocked' || t.status === 'cancelled')) return true;
                return false;
              });
              const isOver = dragOverColumn === col.id;
              const colPoints = columnTasks.reduce((sum, t) => sum + getPoints(t), 0);
              const wipLimit = wipLimits[col.id];
              const overWip = wipLimit != null && columnTasks.length >= wipLimit;

              return (
                <div
                  key={col.id}
                  className={`flex-1 min-w-[200px] sm:min-w-[240px] rounded-lg border ${col.border} ${col.darkBorder} ${col.bg} ${col.darkBg} transition-all ${
                    isOver ? 'ring-2 ring-primary-400 ring-opacity-50' : ''
                  } ${overWip ? 'ring-2 ring-amber-400' : ''}`}
                  onDragOver={(e) => handleDragOver(e, col.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  {/* Column header */}
                  <div className={`flex items-center justify-between px-3 py-2.5 ${col.headerBg} ${col.darkHeaderBg} rounded-t-lg`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-semibold uppercase tracking-wide ${col.headerText} dark:text-gray-200`}>
                        {col.label}
                      </span>
                      {colPoints > 0 && (
                        <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{colPoints} pts</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-xs font-bold bg-white dark:bg-gray-800 rounded-full w-5 h-5 flex items-center justify-center ${overWip ? 'text-amber-600' : 'text-gray-500 dark:text-gray-400'}`}>
                        {wipLimit != null ? `${columnTasks.length}/${wipLimit}` : columnTasks.length}
                      </span>
                      <button
                        onClick={() => handleSetWipLimit(col.id)}
                        className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        aria-label="Set WIP limit"
                        title="Set WIP limit"
                      >
                        <Settings className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                    {columnTasks.length === 0 && (
                      <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">
                        {isOver ? 'Drop here' : 'No tasks'}
                      </div>
                    )}

                    {columnTasks.map((task) => {
                      const pBadge = priorityBadge[task.priority || 'medium'] || priorityBadge.medium;
                      const points = getPoints(task);
                      const avatarColor = task.assignedTo ? getAvatarColor(task.assignedTo) : null;

                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, task.id)}
                          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 p-3 shadow-sm hover:shadow-md dark:hover:shadow-lg dark:hover:shadow-black/20 transition-shadow cursor-grab active:cursor-grabbing"
                        >
                          <div className="flex items-center gap-1.5 mb-2">
                            {task.taskType && task.taskType !== 'task' && taskTypeBadge[task.taskType] && (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${taskTypeBadge[task.taskType].bg} ${taskTypeBadge[task.taskType].text}`}>
                                {taskTypeBadge[task.taskType].label}
                              </span>
                            )}
                            {(task.status === 'blocked' || task.status === 'cancelled') && (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${task.status === 'blocked' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300'}`}>
                                {task.status === 'blocked' ? 'Blocked' : 'Cancelled'}
                              </span>
                            )}
                            <span className="text-xs font-medium text-gray-900 dark:text-white line-clamp-2">
                              {task.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${pBadge.bg} ${pBadge.text} ${pBadge.darkBg} ${pBadge.darkText} capitalize`}
                            >
                              {task.priority || 'medium'}
                            </span>
                            {editingPointsTaskId === task.id ? (
                              <input
                                type="number"
                                min="0"
                                className="w-12 text-xs font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded-full border border-primary-300 dark:border-primary-600 outline-none text-center"
                                value={editingPointsValue}
                                onChange={(e) => setEditingPointsValue(e.target.value)}
                                onBlur={() => handlePointsSave(task.id)}
                                onKeyDown={(e) => handlePointsKeyDown(e, task.id)}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span
                                className="text-xs font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded-full cursor-pointer hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
                                onClick={(e) => { e.stopPropagation(); handlePointsClick(task.id, points); }}
                                title="Click to edit story points"
                              >
                                {points > 0 ? `${points} pts` : '+ pts'}
                              </span>
                            )}
                            {(() => {
                              const ac = getAcCount(task.acceptanceCriteria);
                              if (!ac) return null;
                              return (
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ac.checked === ac.total ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                                  {ac.checked}/{ac.total} AC
                                </span>
                              );
                            })()}
                            {dodReadiness[task.id] && (
                              <span
                                title={`DoD: ${dodReadiness[task.id].checked}/${dodReadiness[task.id].total}`}
                                className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                  dodReadiness[task.id].ready
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                }`}
                              >
                                <ShieldCheck className="w-3 h-3" />
                                {dodReadiness[task.id].checked}/{dodReadiness[task.id].total}
                              </span>
                            )}
                          </div>
                          {task.assignedTo && avatarColor && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <div className={`w-5 h-5 rounded-full ${avatarColor.bg} ${avatarColor.text} flex items-center justify-center text-[8px] font-bold`}>
                                {getInitials(task.assignedTo)}
                              </div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{task.assignedTo}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

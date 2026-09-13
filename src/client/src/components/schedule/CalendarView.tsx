import { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { GanttTask } from './GanttChart';

const barColors: Record<string, string> = {
  completed: 'bg-green-500',
  in_progress: 'bg-blue-500',
  pending: 'bg-gray-400',
  cancelled: 'bg-red-400',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type CalendarMode = 'month' | 'week' | 'day';

interface CalendarViewProps {
  tasks: GanttTask[];
  onTaskClick: (task: GanttTask) => void;
  onTaskReschedule?: (taskId: string, newStartDate: string, newEndDate: string) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toDateOnly(s: string): Date {
  // Parse YYYY-MM-DD as local date to avoid UTC timezone shift
  const parts = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (parts) return new Date(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]));
  const d = new Date(s);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

function getTasksForDay(tasks: GanttTask[], day: Date): GanttTask[] {
  return tasks.filter(t => {
    if (!t.startDate && !t.endDate) return false;
    const start = t.startDate ? toDateOnly(t.startDate) : toDateOnly(t.endDate!);
    const end = t.endDate ? toDateOnly(t.endDate) : start;
    return day >= start && day <= end;
  });
}

function taskStartsOnDay(task: GanttTask, day: Date): boolean {
  if (!task.startDate) return isSameDay(day, toDateOnly(task.endDate!));
  return isSameDay(day, toDateOnly(task.startDate));
}

export function CalendarView({ tasks, onTaskClick, onTaskReschedule }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [mode, setMode] = useState<CalendarMode>('month');
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  // Navigation
  const navigate = useCallback((dir: -1 | 1) => {
    setCurrentDate(prev => {
      if (mode === 'month') return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
      if (mode === 'week') {
        const d = new Date(prev);
        d.setDate(d.getDate() + dir * 7);
        return d;
      }
      const d = new Date(prev);
      d.setDate(d.getDate() + dir);
      return d;
    });
  }, [mode]);

  const goToday = () => setCurrentDate(new Date());

  // Label
  const headerLabel = useMemo(() => {
    if (mode === 'month') return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (mode === 'week') {
      const weekStart = startOfWeek(currentDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${startStr} – ${endStr}`;
    }
    return currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [currentDate, mode]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(dateStr);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverDate(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetDateStr: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId || !onTaskReschedule) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const targetDate = new Date(targetDateStr);
    const oldStart = task.startDate ? toDateOnly(task.startDate) : null;
    const oldEnd = task.endDate ? toDateOnly(task.endDate) : null;

    if (oldStart && oldEnd) {
      const duration = Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000);
      const newEnd = new Date(targetDate);
      newEnd.setDate(newEnd.getDate() + duration);
      onTaskReschedule(taskId, toISODate(targetDate), toISODate(newEnd));
    } else {
      onTaskReschedule(taskId, toISODate(targetDate), toISODate(targetDate));
    }
  }, [tasks, onTaskReschedule]);

  // Task pill renderer
  const renderTaskPill = (task: GanttTask, day: Date, compact = false) => {
    const startsHere = taskStartsOnDay(task, day);
    const color = barColors[task.status] || barColors.pending;
    const draggable = !!onTaskReschedule;

    if (startsHere) {
      return (
        <button
          key={task.id}
          draggable={draggable}
          onDragStart={draggable ? (e) => handleDragStart(e, task.id) : undefined}
          onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
          className={`w-full text-left rounded px-1.5 py-0.5 text-xs font-medium text-white truncate ${color} hover:opacity-80 transition-opacity ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
          title={task.name}
        >
          {task.name}
        </button>
      );
    }
    if (compact) return null;
    return (
      <div
        key={task.id}
        draggable={draggable}
        onDragStart={draggable ? (e) => handleDragStart(e, task.id) : undefined}
        className={`w-full h-[18px] rounded-sm ${color} opacity-40 cursor-pointer hover:opacity-60`}
        onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
        title={task.name}
      />
    );
  };

  // ─── MONTH VIEW ─────────────────────────────────────────────
  const renderMonth = () => {
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const firstDay = new Date(monthStart);
    firstDay.setDate(firstDay.getDate() - firstDay.getDay());
    const gridDays: Date[] = [];
    for (let i = 0; i < 42; i++) {
      gridDays.push(new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i));
    }

    return (
      <>
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
          {DAYS.map(day => (
            <div key={day} className="px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-center">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((day, idx) => {
            const isCurrentMonth = day.getMonth() === currentDate.getMonth();
            const isToday = isSameDay(day, today);
            const dayTasks = getTasksForDay(tasks, day);
            const dateStr = toISODate(day);
            const isDragOver = dragOverDate === dateStr;

            return (
              <div
                key={idx}
                className={`min-h-[80px] border-b border-r border-gray-100 dark:border-gray-800 p-1 transition-colors ${
                  !isCurrentMonth ? 'bg-gray-50/50 dark:bg-gray-800/50' : ''
                } ${idx % 7 === 6 ? 'border-r-0' : ''} ${isDragOver ? 'bg-primary-50 dark:bg-primary-900/20 ring-1 ring-inset ring-primary-300' : ''}`}
                onDragOver={onTaskReschedule ? (e) => handleDragOver(e, dateStr) : undefined}
                onDragLeave={onTaskReschedule ? handleDragLeave : undefined}
                onDrop={onTaskReschedule ? (e) => handleDrop(e, dateStr) : undefined}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-px pl-1">
                    {dayTasks.length > 0 && dayTasks.length <= 3 && (
                      Array.from({ length: dayTasks.length }).map((_, i) => (
                        <span key={i} className="w-1 h-1 rounded-full bg-primary-400 dark:bg-primary-500" />
                      ))
                    )}
                    {dayTasks.length > 3 && (
                      <span className="text-[9px] font-bold text-primary-500 dark:text-primary-400">{dayTasks.length}</span>
                    )}
                  </div>
                  <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-primary-600 text-white'
                      : isCurrentMonth ? 'text-gray-700 dark:text-gray-200'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map(task => renderTaskPill(task, day))}
                  {dayTasks.length > 3 && (
                    <span className="text-xs text-gray-500 dark:text-gray-500 pl-1">+{dayTasks.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  // ─── WEEK VIEW ──────────────────────────────────────────────
  const renderWeek = () => {
    const weekStart = startOfWeek(currentDate);
    const weekDays: Date[] = [];
    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }

    return (
      <div className="grid grid-cols-7 divide-x divide-gray-100 dark:divide-gray-800">
        {weekDays.map((day, idx) => {
          const isToday = isSameDay(day, today);
          const dayTasks = getTasksForDay(tasks, day);
          const dateStr = toISODate(day);
          const isDragOver = dragOverDate === dateStr;

          return (
            <div
              key={idx}
              className={`min-h-[400px] p-2 transition-colors ${isDragOver ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
              onDragOver={onTaskReschedule ? (e) => handleDragOver(e, dateStr) : undefined}
              onDragLeave={onTaskReschedule ? handleDragLeave : undefined}
              onDrop={onTaskReschedule ? (e) => handleDrop(e, dateStr) : undefined}
            >
              {/* Day header */}
              <div className="text-center mb-2">
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase">{DAYS[day.getDay()]}</div>
                <div className={`text-lg font-bold mx-auto w-8 h-8 flex items-center justify-center rounded-full ${
                  isToday ? 'bg-primary-600 text-white' : 'text-gray-700 dark:text-gray-200'
                }`}>
                  {day.getDate()}
                </div>
              </div>
              {/* Tasks */}
              <div className="space-y-1">
                {dayTasks.map(task => renderTaskPill(task, day, true))}
                {dayTasks.length === 0 && (
                  <div className="text-center text-xs text-gray-300 dark:text-gray-600 py-4">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ─── DAY VIEW ───────────────────────────────────────────────
  const renderDay = () => {
    const dayTasks = getTasksForDay(tasks, currentDate);
    const isToday = isSameDay(currentDate, today);
    const dateStr = toISODate(currentDate);
    const isDragOver = dragOverDate === dateStr;

    return (
      <div
        className={`min-h-[500px] p-4 transition-colors ${isDragOver ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
        onDragOver={onTaskReschedule ? (e) => handleDragOver(e, dateStr) : undefined}
        onDragLeave={onTaskReschedule ? handleDragLeave : undefined}
        onDrop={onTaskReschedule ? (e) => handleDrop(e, dateStr) : undefined}
      >
        {/* Day header */}
        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold ${
            isToday ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'
          }`}>
            {currentDate.getDate()}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {currentDate.toLocaleDateString('en-US', { weekday: 'long' })}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {dayTasks.length} task{dayTasks.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Task list */}
        {dayTasks.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400 dark:text-gray-500">No tasks scheduled for this day</div>
        ) : (
          <div className="space-y-2">
            {dayTasks.map(task => {
              const color = barColors[task.status] || barColors.pending;
              const draggable = !!onTaskReschedule;
              return (
                <div
                  key={task.id}
                  draggable={draggable}
                  onDragStart={draggable ? (e) => handleDragStart(e, task.id) : undefined}
                  onClick={() => onTaskClick(task)}
                  className={`flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow cursor-pointer ${draggable ? 'active:cursor-grabbing' : ''}`}
                >
                  <div className={`w-2 h-8 rounded-full ${color} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{task.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {task.priority && (
                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">{task.priority}</span>
                      )}
                      {task.assignedTo && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{task.assignedTo}</span>
                      )}
                      {task.startDate && task.endDate && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(task.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(task.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                  {task.progressPercentage != null && task.progressPercentage > 0 && task.status !== 'completed' && (
                    <div className="w-10 text-right">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{task.progressPercentage}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="Previous">
            <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white min-w-[200px] text-center">{headerLabel}</h3>
          <button onClick={() => navigate(1)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="Next">
            <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-0.5">
            {(['month', 'week', 'day'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize ${
                  mode === m
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={goToday}
            className="px-2.5 py-1 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/20 dark:hover:bg-primary-900/40 dark:text-primary-400 rounded-md transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      {mode === 'month' && renderMonth()}
      {mode === 'week' && renderWeek()}
      {mode === 'day' && renderDay()}
    </div>
  );
}

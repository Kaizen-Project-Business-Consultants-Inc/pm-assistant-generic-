/** Phone/narrow view of the Schedule tab (list / board / calendar). Moved out of ScheduleTab.tsx
 * unchanged (code health item 4, Phase 1, 2026-10-04). */
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../../services/api';
import { KanbanBoard } from '../../../components/schedule/KanbanBoard';
import { CalendarView } from '../../../components/schedule/CalendarView';
import { useProjectRole } from '../../../hooks/useProjectRole';
import { TaskListMobile } from '../../../components/tasks/TaskListMobile';

export function MobileScheduleView({ schedules, selectedIdx, onSelectSchedule, desktopViewMode }: { schedules: any[]; selectedIdx: number; onSelectSchedule: (idx: number) => void; desktopViewMode?: string }) {
  const queryClient = useQueryClient();
  const { canEdit } = useProjectRole(schedules[0]?.projectId);
  const [mobileView, setMobileView] = useState<'list' | 'kanban' | 'calendar'>(() => {
    if (desktopViewMode === 'kanban') return 'kanban';
    if (desktopViewMode === 'calendar') return 'calendar';
    return 'list';
  });
  const schedule = schedules[selectedIdx] || schedules[0];
  const { data: tasksData } = useQuery({
    queryKey: ['tasks', schedule?.id],
    queryFn: () => apiService.getTasks(schedule?.id),
    enabled: !!schedule,
  });

  const tasks = tasksData?.data || tasksData?.tasks || [];

  const handleStatusChange = useCallback((taskId: string, newStatus: string) => {
    apiService.updateTask(schedule.id, taskId, { status: newStatus }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
    });
  }, [schedule?.id, queryClient]);

  return (
    <div className="space-y-3">
      {/* Schedule selector + Mobile view switcher */}
      {schedules.length > 1 && (
        <select
          aria-label="Schedule"
          value={selectedIdx}
          onChange={(e) => onSelectSchedule(Number(e.target.value))}
          className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 mb-2"
        >
          {schedules.map((s: any, idx: number) => (
            <option key={s.id} value={idx}>{s.name || `Schedule ${idx + 1}`}</option>
          ))}
        </select>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {schedule?.name || 'Tasks'}
        </h3>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
          {([
            { mode: 'list' as const, label: 'List' },
            { mode: 'kanban' as const, label: 'Board' },
            { mode: 'calendar' as const, label: 'Cal' },
          ] as const).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setMobileView(mode)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mobileView === mode
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mobileView === 'list' && (
        <>
          {desktopViewMode && !['table', 'kanban', 'calendar'].includes(desktopViewMode) && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {desktopViewMode.charAt(0).toUpperCase() + desktopViewMode.slice(1)} view requires a wider screen. Showing task list instead.
            </p>
          )}
          <TaskListMobile tasks={tasks} onStatusChange={canEdit ? handleStatusChange : undefined} />
        </>
      )}
      {mobileView === 'kanban' && (
        <KanbanBoard
          tasks={tasks}
          onTaskClick={() => {}}
          onStatusChange={canEdit ? handleStatusChange : undefined}
          scheduleId={schedule?.id}
        />
      )}
      {mobileView === 'calendar' && (
        <CalendarView
          tasks={tasks}
          onTaskClick={() => {}}
        />
      )}
    </div>
  );
}

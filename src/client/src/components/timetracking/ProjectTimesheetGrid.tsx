import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, User, Users } from 'lucide-react';
import { apiService } from '../../services/api';

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getSunday(monday: Date): Date {
  const d = new Date(monday);
  d.setDate(d.getDate() + 6);
  return d;
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getDays(weekStart: string): string[] {
  const days: string[] = [];
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

interface UserGroup {
  userId: string;
  userName: string;
  tasks: Map<string, { taskId: string; taskName: string; entries: any[] }>;
}

export function ProjectTimesheetGrid({ projectId }: { projectId: string }) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()).toISOString().slice(0, 10));

  const days = useMemo(() => getDays(weekStart), [weekStart]);
  const endDate = useMemo(() => getSunday(new Date(weekStart + 'T00:00:00')).toISOString().slice(0, 10), [weekStart]);

  const { data, isLoading } = useQuery({
    queryKey: ['project-time-entries', projectId, weekStart, endDate, undefined],
    queryFn: () => apiService.getProjectTimeEntries(projectId, weekStart, endDate),
    enabled: !!projectId,
  });

  const entries: any[] = data?.entries || [];

  // Group by user, then by task
  const userGroups = useMemo(() => {
    const map = new Map<string, UserGroup>();
    for (const e of entries) {
      const uid = e.userId || 'unknown';
      if (!map.has(uid)) {
        map.set(uid, { userId: uid, userName: e.userName || 'Unknown', tasks: new Map() });
      }
      const group = map.get(uid)!;
      const tid = e.taskId || 'no-task';
      if (!group.tasks.has(tid)) {
        group.tasks.set(tid, { taskId: tid, taskName: e.taskName || e.description || tid.slice(0, 8), entries: [] });
      }
      group.tasks.get(tid)!.entries.push(e);
    }
    return Array.from(map.values()).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [entries]);

  const navigateWeek = (offset: number) => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + offset * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  const weekTotal = entries.reduce((s: number, e: any) => s + (e.hours || 0), 0);

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigateWeek(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Previous week">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Week of {new Date(weekStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
        <button onClick={() => navigateWeek(1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Next week">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase min-w-[200px]">Team Member / Task</th>
                {days.map(d => (
                  <th key={d} className="text-center py-2.5 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 min-w-[80px]">
                    {formatDay(d)}
                  </th>
                ))}
                <th className="text-center py-2.5 px-2 text-xs font-medium text-gray-500 dark:text-gray-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {userGroups.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 2} className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
                    No time entries for this week
                  </td>
                </tr>
              ) : (
                userGroups.map((userGroup) => {
                  const taskRows = Array.from(userGroup.tasks.values());
                  const userTotal = taskRows.reduce((sum, t) => sum + t.entries.reduce((s: number, e: any) => s + (e.hours || 0), 0), 0);

                  return (
                    <tbody key={userGroup.userId}>
                      {/* User header row */}
                      <tr className="bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-600">
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                              <User className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
                            </div>
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                              {userGroup.userName}
                            </span>
                          </div>
                        </td>
                        {days.map(d => {
                          const dayTotal = taskRows.reduce((sum, t) => {
                            return sum + t.entries.filter((e: any) => e.date === d).reduce((s: number, e: any) => s + (e.hours || 0), 0);
                          }, 0);
                          return (
                            <td key={d} className="text-center py-2 px-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              {dayTotal > 0 ? `${dayTotal}h` : ''}
                            </td>
                          );
                        })}
                        <td className="text-center py-2 px-2 font-bold text-primary-600 text-xs">{userTotal}h</td>
                      </tr>
                      {/* Task rows */}
                      {taskRows.map((task) => {
                        const dayHours = days.map(d =>
                          task.entries.filter((e: any) => e.date === d).reduce((s: number, e: any) => s + (e.hours || 0), 0)
                        );
                        const rowTotal = dayHours.reduce((s, h) => s + h, 0);
                        return (
                          <tr key={task.taskId} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="py-2 pl-10 pr-3 text-sm text-gray-700 dark:text-gray-300 truncate max-w-[250px]">
                              {task.taskName}
                            </td>
                            {dayHours.map((h, i) => (
                              <td key={days[i]} className="text-center py-2 px-2">
                                {h > 0 ? (
                                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{h}</span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">-</span>
                                )}
                              </td>
                            ))}
                            <td className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">{rowTotal}h</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })
              )}
            </tbody>
            {userGroups.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                  <td className="py-2.5 px-3 text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-500" /> Project Total
                  </td>
                  {days.map(d => {
                    const dayTotal = entries.filter((e: any) => e.date === d).reduce((s: number, e: any) => s + (e.hours || 0), 0);
                    return (
                      <td key={d} className="text-center py-2.5 px-2 font-semibold text-gray-700 dark:text-gray-300">
                        {dayTotal > 0 ? `${dayTotal}` : '-'}
                      </td>
                    );
                  })}
                  <td className="text-center py-2.5 px-2 font-bold text-primary-600">{weekTotal}h</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

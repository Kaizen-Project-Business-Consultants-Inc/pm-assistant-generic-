import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Calendar,
  CalendarDays,
  TrendingUp,
  Upload,
  Kanban,
  GanttChartSquare,
  Table2,
  MapPin,
} from 'lucide-react';
import { apiService } from '../../services/api';
import type { Methodology } from '../../utils/methodology';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { MobileScheduleView } from './schedule-tab/MobileScheduleView';
import { ScheduleGantt } from './schedule-tab/ScheduleWorkspace';


export function ScheduleTab({ projectId, projectName, projectStartDate, defaultViewMode = 'gantt', methodology = 'waterfall' }: { projectId: string; projectName?: string; projectStartDate?: string; defaultViewMode?: string; methodology?: Methodology }) {
  const queryClient = useQueryClient();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const viewModeKey = `schedule-view-mode-${projectId}`;
  const [viewModeRaw, setViewModeRaw] = useState<'gantt' | 'kanban' | 'table' | 'calendar' | 'network' | 'burndown' | 'scurve'>(() => {
    try {
      const saved = localStorage.getItem(viewModeKey);
      if (saved && ['gantt', 'kanban', 'table', 'calendar', 'network', 'burndown', 'scurve'].includes(saved)) return saved as any;
    } catch { /* noop */ }
    return defaultViewMode as any;
  });
  const setViewMode = useCallback((mode: typeof viewModeRaw) => {
    setViewModeRaw(mode);
    try { localStorage.setItem(viewModeKey, mode); } catch { /* noop */ }
  }, [viewModeKey]);
  // Burndown is an Agile chart (fixed sprint scope); a waterfall project gets the S-curve in
  // its place. A remembered view that doesn't fit this project's methodology is swapped.
  const isWaterfall = methodology === 'waterfall';
  const viewMode: typeof viewModeRaw =
    isWaterfall && viewModeRaw === 'burndown' ? 'scurve'
    : !isWaterfall && viewModeRaw === 'scurve' ? 'burndown'
    : viewModeRaw;
  const [uploadingSchedule, setUploadingSchedule] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [selectedScheduleIdx, setSelectedScheduleIdx] = useState(0);
  const [openImportOnLoad, setOpenImportOnLoad] = useState(false);

  const { data: schedulesData, isLoading: schedulesLoading } = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => apiService.getSchedules(projectId),
    enabled: !!projectId,
  });

  const schedules: any[] = schedulesData?.schedules || [];

  // A link to one task (Morning Briefing): open the schedule it lives in, in a view
  // that has rows. ScheduleGantt scrolls to and highlights the task itself.
  const [linkParams] = useSearchParams();
  const linkedScheduleId = linkParams.get('schedule');
  const linkedTaskId = linkParams.get('task');
  useEffect(() => {
    if (!linkedScheduleId) return;
    const i = schedules.findIndex(sc => sc.id === linkedScheduleId);
    if (i >= 0) setSelectedScheduleIdx(i);
  }, [linkedScheduleId, schedules]);
  useEffect(() => {
    if (linkedTaskId && viewMode !== 'gantt' && viewMode !== 'table') setViewModeRaw('gantt');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedTaskId]);


  if (schedulesLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-72 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-4 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
                <div className={`h-4 animate-pulse bg-gray-200 dark:bg-gray-700 rounded`} style={{ width: `${40 + (i * 7) % 30}%` }} />
                <div className="h-4 w-20 animate-pulse bg-gray-100 dark:bg-gray-600 rounded" />
                <div className="h-3 w-32 animate-pulse bg-gray-100 dark:bg-gray-600 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <Calendar className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Schedules</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          No schedules have been created for this project yet.
        </p>
        <div className="mt-4 flex flex-col items-center gap-3">
          <button
            onClick={async () => {
              try {
                const startDate = projectStartDate || new Date().toISOString().split('T')[0];
                const endDate = new Date(startDate);
                endDate.setFullYear(endDate.getFullYear() + 1);
                await apiService.createSchedule({
                  projectId,
                  name: `${projectName || 'Project'} Schedule`,
                  startDate,
                  endDate: endDate.toISOString().split('T')[0],
                });
                queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
              } catch {
                setUploadError('Failed to create schedule.');
              }
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            <Calendar className="w-4 h-4" />
            Create Schedule
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">or</span>
          <button
            onClick={async () => {
              setUploadingSchedule(true);
              try {
                const startDate = projectStartDate || new Date().toISOString().split('T')[0];
                const endDate = new Date(startDate);
                endDate.setFullYear(endDate.getFullYear() + 1);
                await apiService.createSchedule({
                  projectId,
                  name: `${projectName || 'Project'} Schedule`,
                  startDate,
                  endDate: endDate.toISOString().split('T')[0],
                });
                setOpenImportOnLoad(true);
                queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
              } catch {
                setUploadError('Failed to create schedule.');
              } finally {
                setUploadingSchedule(false);
              }
            }}
            disabled={uploadingSchedule}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:bg-gray-300 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploadingSchedule ? 'Creating…' : 'Import Schedule (.xlsx / .csv)'}
          </button>
          {uploadError && (
            <p className="text-xs text-red-600">{uploadError}</p>
          )}
        </div>
      </div>
    );
  }

  // Guard against out-of-bounds (e.g. after schedule deletion)
  const linkedIdx = linkedScheduleId ? schedules.findIndex(sc => sc.id === linkedScheduleId) : -1;
  const safeIdx = linkedIdx >= 0 ? linkedIdx : selectedScheduleIdx >= schedules.length ? 0 : selectedScheduleIdx;

  if (isMobile) {
    return <MobileScheduleView schedules={schedules} selectedIdx={safeIdx} onSelectSchedule={setSelectedScheduleIdx} desktopViewMode={viewMode} />;
  }

  return (
    <div className="space-y-4">
      {/* View Toggle + Schedule Selector */}
      <div className="flex items-center gap-2 flex-wrap" role="toolbar" aria-label="Schedule view controls">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5" role="group" aria-label="View mode">
          {([
            { mode: 'gantt' as const, icon: GanttChartSquare, label: 'Gantt' },
            { mode: 'kanban' as const, icon: Kanban, label: 'Kanban' },
            { mode: 'table' as const, icon: Table2, label: 'Table' },
            { mode: 'calendar' as const, icon: CalendarDays, label: 'Calendar' },
            { mode: 'network' as const, icon: MapPin, label: 'Network' },
            isWaterfall
              ? { mode: 'scurve' as const, icon: TrendingUp, label: 'S-curve' }
              : { mode: 'burndown' as const, icon: TrendingUp, label: 'Burndown' },
          ] as const).map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === mode
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {schedules.length > 1 && (
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
            {schedules.map((s: any, idx: number) => (
              <button
                key={s.id}
                onClick={() => setSelectedScheduleIdx(idx)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  safeIdx === idx
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {s.name || `Schedule ${idx + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <ScheduleGantt key={schedules[safeIdx].id} schedule={schedules[safeIdx]} viewMode={viewMode} projectId={projectId} openImportOnLoad={openImportOnLoad} onImportOpened={() => setOpenImportOnLoad(false)} />
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Zap, Calendar } from 'lucide-react';
import { apiService } from '../../services/api';
import { SprintList } from '../../components/sprints/SprintList';
import { SprintPlanningPanel } from '../../components/sprints/SprintPlanningPanel';
import { SprintBoard } from '../../components/sprints/SprintBoard';
import { SprintBurndownChart } from '../../components/sprints/SprintBurndownChart';
import { CumulativeFlowChart } from '../../components/sprints/CumulativeFlowChart';
import { CapacityCard } from '../../components/sprints/CapacityCard';

interface SprintSummary {
  id: string;
  name: string;
  status: string;
  start_date?: string;
  end_date?: string;
  taskStats?: { totalTasks: number; completedTasks: number; totalPoints: number; completedPoints: number };
}

function DayProgress({ sprint }: { sprint: SprintSummary | null }) {
  if (!sprint || sprint.status !== 'active' || !sprint.start_date || !sprint.end_date) return null;
  const start = new Date(sprint.start_date + 'T00:00:00').getTime();
  const end = new Date(sprint.end_date + 'T00:00:00').getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  const totalDays = Math.max(1, Math.round((end - start) / 86400000));
  const elapsed = Math.max(0, Math.min(totalDays, Math.round((now - start) / 86400000)));
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <Calendar className="w-3 h-3" />
      <span>Day {elapsed} of {totalDays}</span>
      <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.round((elapsed / totalDays) * 100)}%` }} />
      </div>
    </div>
  );
}

export function SprintsTab({ projectId }: { projectId: string }) {
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => apiService.getSchedules(projectId),
    enabled: !!projectId,
  });

  const schedules: any[] = schedulesData?.schedules || [];
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [selectedSprintId, setSelectedSprintId] = useState<string | undefined>();
  const [sprintView, setSprintView] = useState<'list' | 'planning' | 'board' | 'burndown' | 'flow' | 'capacity'>('list');
  const [retroData, setRetroData] = useState<{ markdown: string; sprintName: string } | null>(null);
  const [retroLoading, setRetroLoading] = useState(false);

  useEffect(() => {
    if (schedules.length > 0 && !selectedScheduleId) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  const { data: sprintsData } = useQuery({
    queryKey: ['sprints', projectId],
    queryFn: () => apiService.getSprints(projectId),
    enabled: !!projectId,
  });

  const allSprints: SprintSummary[] = sprintsData?.data || sprintsData?.sprints || [];
  const activeSprint = useMemo(() => allSprints.find((s) => s.status === 'active') || null, [allSprints]);

  const activeProgress = useMemo(() => {
    if (!activeSprint?.taskStats) return null;
    const { totalTasks, completedTasks } = activeSprint.taskStats;
    if (totalTasks === 0) return null;
    return Math.round((completedTasks / totalTasks) * 100);
  }, [activeSprint]);

  const handleRetro = async (sprintId: string) => {
    setRetroLoading(true);
    try {
      const res = await apiService.generateSprintRetrospective(sprintId);
      setRetroData({
        markdown: res.retrospective || 'AI retrospective unavailable. Please try again later.',
        sprintName: res.sprint?.name || 'Sprint',
      });
    } catch {
      setRetroData({ markdown: 'Failed to generate retrospective. Please try again.', sprintName: 'Sprint' });
    } finally {
      setRetroLoading(false);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Sprint Planning</h3>
          {/* Active sprint progress bar */}
          {activeSprint && activeProgress != null && (
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${activeProgress === 100 ? 'bg-green-500' : activeProgress >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                  style={{ width: `${activeProgress}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">{activeProgress}%</span>
            </div>
          )}
          {/* Day progress indicator */}
          <DayProgress sprint={activeSprint} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {schedules.length > 1 && (
            <select
              value={selectedScheduleId}
              onChange={(e) => setSelectedScheduleId(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1.5 text-sm"
            >
              {schedules.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {selectedSprintId && (
            <div className="flex gap-1 flex-wrap">
              {(['list', 'planning', 'board', 'burndown', 'flow', 'capacity'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSprintView(v)}
                  className={`px-3 py-1 text-xs rounded-md capitalize ${sprintView === v ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {sprintView === 'list' && (
        <SprintList
          projectId={projectId}
          onSelect={(id) => { setSelectedSprintId(id); setSprintView('planning'); }}
          onCreate={() => { setSelectedSprintId(undefined); setSprintView('planning'); }}
          onRetro={handleRetro}
        />
      )}
      {sprintView === 'planning' && selectedScheduleId && (
        <SprintPlanningPanel
          projectId={projectId}
          scheduleId={selectedScheduleId}
          sprintId={selectedSprintId || ''}
        />
      )}
      {sprintView === 'board' && selectedSprintId && (
        <SprintBoard sprintId={selectedSprintId} />
      )}
      {sprintView === 'burndown' && selectedSprintId && (
        <SprintBurndownChart sprintId={selectedSprintId} />
      )}
      {sprintView === 'flow' && selectedSprintId && (
        <CumulativeFlowChart sprintId={selectedSprintId} />
      )}
      {sprintView === 'capacity' && selectedSprintId && (
        <CapacityCard sprintId={selectedSprintId} />
      )}

      {/* AI Retrospective Loading */}
      {retroLoading && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-6 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-indigo-600 dark:text-indigo-400">Generating AI retrospective…</p>
        </div>
      )}

      {/* AI Retrospective Result */}
      {retroData && !retroLoading && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-200 dark:border-indigo-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-500" />
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                AI Retrospective — {retroData.sprintName}
              </h4>
            </div>
            <button
              onClick={() => setRetroData(null)}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Dismiss
            </button>
          </div>
          <div className="p-4 prose-sm max-w-none text-sm text-gray-700 dark:text-gray-300">
            {retroData.markdown}
          </div>
        </div>
      )}
    </div>
  );
}

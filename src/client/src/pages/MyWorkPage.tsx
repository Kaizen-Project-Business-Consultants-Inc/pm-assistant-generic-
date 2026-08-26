import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FolderPlus, LayoutTemplate, Sun } from 'lucide-react';
import { apiService } from '../services/api';
import { ROUTES } from '../routes';
import AttentionBar from '../components/mywork/AttentionBar';
import DecisionsSection from '../components/mywork/DecisionsSection';
import CommitmentsSection from '../components/mywork/CommitmentsSection';
import WeekAheadSection from '../components/mywork/WeekAheadSection';
import RecentlyCompletedSection from '../components/mywork/RecentlyCompletedSection';

interface CommitmentItem {
  id: string | number;
  type: 'task' | 'action_item' | 'raid_action';
  name: string;
  projectId: string | number;
  projectName: string;
  scheduleId?: number;
  meetingTitle?: string;
  dueDate: string | null;
  priority: string;
  status: string;
  percentComplete?: number;
}

export default function MyWorkPage() {
  const queryClient = useQueryClient();
  const [markingId, setMarkingId] = useState<string | number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['my-work'],
    queryFn: () => apiService.getMyWork(),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
    staleTime: 60000,
  });
  const hasProjects = (projectsData?.projects?.length ?? 0) > 0;

  // Mark done mutation — routes to different API based on item type
  const markDone = useMutation({
    mutationFn: async (item: CommitmentItem) => {
      if (item.type === 'task') {
        return apiService.updateTask(String(item.scheduleId), String(item.id), {
          status: 'completed',
          progress_percentage: 100,
        });
      } else if (item.type === 'action_item') {
        return apiService.updateActionItem(String(item.id), {
          status: 'completed',
          completedAt: new Date().toISOString(),
        });
      } else {
        return apiService.updateRiskItem(String(item.projectId), String(item.id), {
          status: 'resolved',
        });
      }
    },
    onMutate: (item) => setMarkingId(item.id),
    onSettled: () => {
      setMarkingId(null);
      queryClient.invalidateQueries({ queryKey: ['my-work'] });
    },
  });

  const handleMarkDone = useCallback((item: CommitmentItem) => {
    markDone.mutate(item);
  }, [markDone]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const hasAttention = data?.attention && (
    data.attention.overdueCount > 0 || data.attention.blockedCount > 0 || data.attention.criticalRisks?.length > 0
  );
  const hasDecisions = data?.counts?.decisions && data.counts.decisions > 0;
  const hasCommitments = data?.commitments && data.commitments.length > 0;
  const isEmpty = !hasAttention && !hasDecisions && !hasCommitments;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Work</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{today}</p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">
          Failed to load your work. Please try again later.
        </div>
      )}

      {/* Content */}
      {!isLoading && !error && data && (
        <>
          {/* Empty state — all clear or no projects */}
          {isEmpty && (
            hasProjects ? (
              <div className="text-center py-16">
                <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                  <Sun className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-lg font-medium text-gray-600 dark:text-gray-400">You're all clear</h2>
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 mb-4">
                  No tasks, action items, or decisions need your attention right now.
                </p>
                <Link to={ROUTES.projects} className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
                  Go to Projects
                </Link>
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="mx-auto w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mb-4">
                  <FolderPlus className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Welcome! Let's get started.</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
                  Create your first project to start planning, tracking tasks, and managing your work.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link
                    to={ROUTES.projects}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    <FolderPlus className="w-4 h-4" />
                    Create a Project
                  </Link>
                  <Link
                    to={ROUTES.projects}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    <LayoutTemplate className="w-4 h-4" />
                    Use a Template
                  </Link>
                </div>
              </div>
            )
          )}

          {/* Zone 1: Attention Bar */}
          {data.attention && <AttentionBar data={data.attention} />}

          {/* Zone 2: Decisions */}
          {data.decisions && <DecisionsSection data={data.decisions} />}

          {/* Zone 3: Commitments */}
          {hasCommitments && (
            <CommitmentsSection
              items={data.commitments}
              counts={data.counts || { tasks: 0, actionItems: 0, raidActions: 0 }}
              onMarkDone={handleMarkDone}
              markingId={markingId}
            />
          )}

          {/* Zone 4: Week Ahead */}
          {data.weekAhead && <WeekAheadSection days={data.weekAhead} />}

          {/* Zone 5: Recently Completed */}
          {data.recentlyCompleted && <RecentlyCompletedSection items={data.recentlyCompleted} />}
        </>
      )}
    </div>
  );
}

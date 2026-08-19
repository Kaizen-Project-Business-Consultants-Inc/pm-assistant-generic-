import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trash2, Send, Undo2, Lock, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/api';
import { ConfirmModal } from '../ui/ConfirmModal';

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type EntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

const STATUS_BADGE: Record<EntryStatus, { label: string; classes: string }> = {
  draft: { label: 'Draft', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  submitted: { label: 'Submitted', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  approved: { label: 'Approved', classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Rejected', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

interface Submission {
  id: string;
  userId: string;
  projectId: string;
  weekStart: string;
  status: string;
  totalHours: number;
  rejectionReason?: string | null;
}

export function TimesheetGrid() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => {
    const monday = getMonday(new Date());
    return monday.toISOString().slice(0, 10);
  });

  const { data, isLoading } = useQuery({
    queryKey: ['timesheet-status', weekStart],
    queryFn: () => apiService.getWeeklyTimesheetStatus(weekStart),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteTimeEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timesheet-status', weekStart] }),
  });

  const submitMutation = useMutation({
    mutationFn: (projectId: string) => apiService.submitTimesheet(projectId, weekStart),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timesheet-status', weekStart] }),
  });

  const recallMutation = useMutation({
    mutationFn: (submissionId: string) => apiService.recallTimesheet(submissionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timesheet-status', weekStart] }),
  });

  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const entries: any[] = data?.entries || [];
  const days: string[] = data?.days || [];
  const totalHours: number = data?.totalHours || 0;
  const submissions: Submission[] = data?.submissions || [];

  // Group entries by project then by task
  const projectGroups = useMemo(() => {
    const map = new Map<string, { projectId: string; projectName: string; tasks: Map<string, any[]> }>();
    for (const e of entries) {
      if (!map.has(e.projectId)) map.set(e.projectId, { projectId: e.projectId, projectName: e.projectName || e.projectId.slice(0, 8), tasks: new Map() });
      const group = map.get(e.projectId)!;
      if (!group.tasks.has(e.taskId)) group.tasks.set(e.taskId, []);
      group.tasks.get(e.taskId)!.push(e);
    }
    return Array.from(map.values());
  }, [entries]);

  const getSubmission = (projectId: string) => submissions.find(s => s.projectId === projectId);

  const navigateWeek = (offset: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + offset * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  // Determine aggregate status for the banner
  const hasRejected = submissions.some(s => s.status === 'rejected');
  const allApproved = submissions.length > 0 && submissions.every(s => s.status === 'approved');
  const hasPending = submissions.some(s => s.status === 'submitted');

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

      {/* Status banner */}
      {hasRejected && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>One or more timesheets were rejected. Edit and resubmit.</span>
        </div>
      )}
      {allApproved && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
          <Lock className="w-4 h-4 shrink-0" />
          <span>All timesheets for this week are approved.</span>
        </div>
      )}
      {hasPending && !hasRejected && !allApproved && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          <Send className="w-4 h-4 shrink-0" />
          <span>Timesheets submitted and awaiting approval.</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Task</th>
                <th className="text-center py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                {days.map(d => (
                  <th key={d} className="text-center py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 min-w-[80px]">
                    {formatDay(d)}
                  </th>
                ))}
                <th className="text-center py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {projectGroups.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 3} className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                    No time entries for this week
                  </td>
                </tr>
              ) : (
                projectGroups.map(({ projectId, projectName, tasks }) => {
                  const sub = getSubmission(projectId);
                  const taskRows = Array.from(tasks.entries());
                  const hasDraftEntries = taskRows.some(([, ents]) => ents.some((e: any) => (e.status || 'draft') === 'draft'));
                  const hasRejectedEntries = taskRows.some(([, ents]) => ents.some((e: any) => e.status === 'rejected'));

                  return (
                    <tbody key={projectId}>
                      {/* Project header row */}
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
                        <td colSpan={days.length + 1} className="py-2 px-3 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          {projectName}
                        </td>
                        <td colSpan={2} className="py-2 px-3 text-right">
                          {sub?.status === 'submitted' && (
                            <button
                              onClick={() => recallMutation.mutate(sub.id)}
                              disabled={recallMutation.isPending}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-50 transition-colors"
                              title="Recall submitted timesheet"
                            >
                              <Undo2 className="w-3 h-3" /> Recall
                            </button>
                          )}
                          {(hasDraftEntries || hasRejectedEntries) && !sub?.status?.match(/submitted|approved/) && (
                            <button
                              onClick={() => submitMutation.mutate(projectId)}
                              disabled={submitMutation.isPending}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
                              title="Submit for approval"
                            >
                              <Send className="w-3 h-3" /> Submit
                            </button>
                          )}
                        </td>
                      </tr>
                      {/* Rejection reason */}
                      {sub?.status === 'rejected' && sub.rejectionReason && (
                        <tr>
                          <td colSpan={days.length + 3} className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10">
                            <span className="font-medium">Rejection reason:</span> {sub.rejectionReason}
                          </td>
                        </tr>
                      )}
                      {taskRows.map(([taskId, taskEntries]) => {
                        const entryStatus: EntryStatus = taskEntries[0]?.status || 'draft';
                        const isLocked = entryStatus === 'submitted' || entryStatus === 'approved';
                        const badge = STATUS_BADGE[entryStatus];
                        const dayTotals = days.map(d => {
                          const dayEntries = taskEntries.filter((e: any) => e.date === d);
                          return { hours: dayEntries.reduce((s: number, e: any) => s + e.hours, 0), entries: dayEntries };
                        });
                        const rowTotal = dayTotals.reduce((s, d) => s + d.hours, 0);
                        return (
                          <tr key={taskId} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="py-2 px-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                              <div className="flex items-center gap-1.5">
                                {isLocked && <Lock className="w-3 h-3 text-gray-400 shrink-0" />}
                                <span className="truncate">{taskEntries[0]?.taskName || taskEntries[0]?.description || taskId}</span>
                              </div>
                            </td>
                            <td className="text-center py-2 px-2">
                              <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full ${badge.classes}`}>
                                {badge.label}
                              </span>
                            </td>
                            {dayTotals.map((d, i) => (
                              <td key={days[i]} className="text-center py-2 px-2">
                                {d.hours > 0 ? (
                                  <div className="group relative">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{d.hours}</span>
                                    {!isLocked && (
                                      <button
                                        className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 p-0.5 text-red-400 hover:text-red-600"
                                        onClick={() => setDeleteConfirmIds(d.entries.map((e: any) => e.id))}
                                        aria-label="Delete time entry"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">-</span>
                                )}
                              </td>
                            ))}
                            <td className="text-center py-2 px-2 font-semibold text-primary-600">{rowTotal}h</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                <td className="py-2 px-3 text-sm font-bold text-gray-900 dark:text-gray-100">Total</td>
                <td></td>
                {days.map(d => {
                  const dayTotal = entries.filter((e: any) => e.date === d).reduce((s: number, e: any) => s + e.hours, 0);
                  return (
                    <td key={d} className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">
                      {dayTotal > 0 ? `${dayTotal}` : '-'}
                    </td>
                  );
                })}
                <td className="text-center py-2 px-2 font-bold text-primary-600">{totalHours}h</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {deleteConfirmIds && (
        <ConfirmModal
          title="Delete Time Entry"
          message="Delete this time entry? This cannot be undone."
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => { deleteConfirmIds.forEach(id => deleteMutation.mutate(id)); setDeleteConfirmIds(null); }}
          onCancel={() => setDeleteConfirmIds(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { AccessibleModal } from '../ui/AccessibleModal';
import { apiService } from '../../services/api';
import { formatCalendarDate } from '../../utils/dateUtils';

interface Person { id: string; name: string; role?: string; isGeneric?: boolean; isActive?: boolean }

const DONE = new Set(['completed', 'cancelled']);
const day = (d: string | null) => (d ? formatCalendarDate(d, { day: 'numeric', month: 'short' }) : '—');

/**
 * "Replace Generic Developer with …" — pick the real person and which of the generic role's
 * tasks in this plan they take over (open tasks ticked by default). Warns before saving if the
 * person would go over 100% in some week. Recorded in Schedule History, so it can be undone.
 */
export function ReplaceResourceDialog({ projectId, schedules, from, people, onClose }: {
  projectId: string;
  /** The project's plans; a picker shows when there is more than one */
  schedules: Array<{ id: string; name: string }>;
  from: { id: string; name: string };
  /** Everyone on the Resources list; generic roles and inactive people are left out here */
  people: Person[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '');
  const [toId, setToId] = useState('');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () => people.filter(p => !p.isGeneric && p.isActive !== false && p.id !== from.id).sort((a, b) => a.name.localeCompare(b.name)),
    [people, from.id],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['resource-tasks', from.id, scheduleId],
    queryFn: () => apiService.getResourceTasks(from.id, scheduleId),
    enabled: !!scheduleId,
  });
  const tasks = data?.tasks ?? [];

  // Open work is ticked to start with; finished work stays with the record of who it was planned for
  useEffect(() => {
    if (data && picked === null) setPicked(new Set(data.tasks.filter(t => !DONE.has(t.status)).map(t => t.taskId)));
  }, [data, picked]);
  const selected = picked ?? new Set<string>();
  const selectedIds = tasks.filter(t => selected.has(t.taskId)).map(t => t.taskId);

  const { data: load } = useQuery({
    queryKey: ['replace-check', scheduleId, from.id, toId, selectedIds.join(',')],
    queryFn: () => apiService.checkReplaceLoad({ scheduleId, fromResourceId: from.id, toResourceId: toId, taskIds: selectedIds }),
    enabled: !!toId && selectedIds.length > 0,
  });

  const replace = useMutation({
    mutationFn: () => apiService.replaceResource({ scheduleId, fromResourceId: from.id, toResourceId: toId, taskIds: selectedIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', scheduleId] });
      queryClient.invalidateQueries({ queryKey: ['schedule-changes', scheduleId] });
      queryClient.invalidateQueries({ queryKey: ['schedule-review', scheduleId] });
      queryClient.invalidateQueries({ queryKey: ['workload', projectId] });
      queryClient.invalidateQueries({ queryKey: ['people-on-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['resource-tasks', from.id, scheduleId] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'The replacement could not be saved. Try again.'),
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };
  const allTicked = tasks.length > 0 && tasks.every(t => selected.has(t.taskId));
  const over = load?.overWeeks ?? [];
  const toName = candidates.find(c => c.id === toId)?.name;

  return (
    <AccessibleModal isOpen onClose={onClose} ariaLabel={`Replace ${from.name}`} className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto mx-4">
      <div className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Replace {from.name}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {isLoading ? 'Finding their tasks…' : `${from.name} is on ${tasks.length} task${tasks.length === 1 ? '' : 's'} in this plan.`}
          </p>
        </div>

        {schedules.length > 1 && (
          <div>
            <label htmlFor="replace-plan" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Plan</label>
            <select id="replace-plan" value={scheduleId} onChange={(e) => { setScheduleId(e.target.value); setPicked(null); }} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100">
              {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="replace-with" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Replace with</label>
          <select id="replace-with" value={toId} onChange={(e) => { setToId(e.target.value); setError(null); }} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100">
            <option value="">Choose a person…</option>
            {candidates.map(c => <option key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ''}</option>)}
          </select>
        </div>

        {tasks.length > 0 && (
          <fieldset className="border border-gray-200 dark:border-gray-700 rounded-lg">
            <legend className="sr-only">Tasks to hand over</legend>
            <label className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-700 text-sm font-semibold text-gray-900 dark:text-white">
              <input type="checkbox" checked={allTicked} onChange={() => setPicked(allTicked ? new Set() : new Set(tasks.map(t => t.taskId)))} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              All {tasks.length} tasks
            </label>
            <div className="max-h-64 overflow-y-auto">
              {tasks.map(t => (
                <label key={t.taskId} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <input type="checkbox" checked={selected.has(t.taskId)} onChange={() => toggle(t.taskId)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className={`flex-1 min-w-0 truncate ${DONE.has(t.status) ? 'text-gray-500 dark:text-gray-400' : ''}`}>{t.name}{DONE.has(t.status) ? ' (done)' : ''}</span>
                  <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{day(t.startDate)}–{day(t.endDate)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {toName && over.length > 0 && (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {toName} would be over-booked in {over.length} week{over.length === 1 ? '' : 's'}:{' '}
              {over.slice(0, 3).map(w => `week of ${day(w.weekStart)} (${w.utilization}%)`).join(', ')}{over.length > 3 ? ` and ${over.length - 3} more` : ''}.
              You can still go ahead, or untick some tasks.
            </span>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-gray-600 dark:text-gray-400">Recorded in Schedule History — you can undo it there.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button
              onClick={() => replace.mutate()}
              disabled={!toId || selectedIds.length === 0 || replace.isPending}
              className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
            >
              {replace.isPending ? 'Replacing…' : `Replace on ${selectedIds.length} task${selectedIds.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </AccessibleModal>
  );
}

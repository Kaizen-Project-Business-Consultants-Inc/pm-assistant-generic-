import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, History, Undo2, Loader2, CheckCircle2, AlertTriangle, Bot } from 'lucide-react';
import { apiService } from '../../services/api';
import { useModal } from '../../hooks/useModal';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';

export interface ScheduleChange {
  id: string;
  kind: string;
  summary: string;
  actorId: string | null;
  actorName: string | null;
  source: 'web' | 'mcp' | 'system';
  status: 'applied' | 'undone';
  undoable: boolean;
  createdAt: string;
  undoneAt: string | null;
  undoneByName: string | null;
}

/** "You", "Claude (for Michael)", a colleague's name, or "System" */
export function whoDidIt(c: Pick<ScheduleChange, 'actorId' | 'actorName' | 'source'>, currentUserId?: string): string {
  const person = c.actorId && c.actorId === currentUserId ? 'you' : c.actorName ?? 'someone';
  if (c.source === 'mcp') return `Claude (for ${person})`;
  if (c.source === 'system' || !c.actorId) return 'System';
  return person === 'you' ? 'You' : person;
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

interface Props {
  scheduleId: string;
  canEdit: boolean;
  currentUserId?: string;
  onClose: () => void;
}

/**
 * Schedule History: group changes of the last 30 days with an Undo for each — including
 * changes Claude made through the connector, which never had an undo before.
 */
export function ScheduleHistoryPanel({ scheduleId, canEdit, currentUserId, onClose }: Props) {
  const queryClient = useQueryClient();
  const { dialogRef, handleKeyDown } = useModal(true, onClose);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: changes = [], isLoading } = useQuery<ScheduleChange[]>({
    queryKey: ['schedule-changes', scheduleId],
    queryFn: () => apiService.getScheduleChanges(scheduleId),
    staleTime: 0,
  });

  const undo = async (c: ScheduleChange, force = false) => {
    setBusyId(c.id); setError(null); setDone(null);
    try {
      await apiService.undoScheduleChange(scheduleId, c.id, force);
      setConfirm(null);
      const msg = `Undone: ${c.summary}`;
      setDone(msg);
      announce(msg);
      queryClient.invalidateQueries({ queryKey: ['schedule-changes', scheduleId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', scheduleId] });
      queryClient.invalidateQueries({ queryKey: ['schedule-review', scheduleId] });
      queryClient.invalidateQueries({ queryKey: ['criticalPath', scheduleId] });
    } catch (err: any) {
      const body = err?.response?.data;
      if (err?.response?.status === 409 && body?.error === 'edited_since') {
        setConfirm({ id: c.id, message: body.message });
      } else {
        setError(getApiErrorMessage(err, 'The undo did not complete. Please try again.'));
        queryClient.invalidateQueries({ queryKey: ['schedule-changes', scheduleId] });
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10 dark:bg-black/20" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-history-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col outline-none"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 id="schedule-history-title" className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <History className="w-4 h-4" aria-hidden="true" /> Schedule History
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
              Changes to many tasks at once, last 30 days — by you, your team or Claude.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close history" className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {done && (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 px-3 py-2 text-sm font-medium text-green-800 dark:text-green-200">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> {done}
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-800 dark:text-red-200">{error}</div>
          )}

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Loading…</div>
          ) : changes.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              No group changes in the last 30 days. Linking several tasks, editing or changing the status of several at once,
              Schedule Review fixes and AI Reschedule will appear here, each with an Undo.
            </p>
          ) : (
            <ul className="space-y-2">
              {changes.map(c => {
                const who = whoDidIt(c, currentUserId);
                const isConfirm = confirm?.id === c.id;
                return (
                  <li key={c.id} className={`rounded-lg border px-3 py-2.5 ${c.status === 'undone' ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40' : 'border-gray-200 dark:border-gray-700'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${c.status === 'undone' ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'}`}>{c.summary}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-600 dark:text-gray-300">
                          <span>{when(c.createdAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            {c.source === 'mcp' && <Bot className="w-3.5 h-3.5 text-ai-primary" aria-hidden="true" />}
                            {who}
                          </span>
                        </p>
                        {c.status === 'undone' && (
                          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                            Undone{c.undoneAt ? ` ${when(c.undoneAt).replace(/^Today /, 'at ')}` : ''}{c.undoneByName ? ` by ${c.undoneByName}` : ''}
                          </p>
                        )}
                      </div>
                      {canEdit && c.undoable && !isConfirm && (
                        <button
                          type="button"
                          onClick={() => undo(c)}
                          disabled={busyId !== null}
                          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 disabled:opacity-50"
                        >
                          {busyId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" /> : <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />}
                          Undo
                        </button>
                      )}
                    </div>
                    {isConfirm && (
                      <div role="alert" className="mt-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-2.5">
                        <p className="flex items-start gap-1.5 text-sm text-amber-900 dark:text-amber-100">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {confirm!.message}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => undo(c, true)} disabled={busyId !== null}
                            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                            {busyId === c.id ? 'Undoing…' : 'Undo anyway'}
                          </button>
                          <button type="button" onClick={() => setConfirm(null)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
                            Keep it
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

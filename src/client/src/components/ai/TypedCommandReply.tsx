import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { announce } from '../../utils/announce';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { refreshAfterScheduleChange } from '../../utils/scheduleChanged';
import type { ActionResult } from '../../stores/aiChatStore';

/**
 * Under a reply to a typed command (delete task 5, link 5 to 7…; mock https://claude.ai/artifact/JgYEZXrak1e6ceSaFFEwq3):
 * which path answered, the Confirm button of a delete, and the Undo link — the Schedule History undo.
 * The server marks such a reply with one `typed_command` action.
 */

interface TypedData {
  typed: true;
  pending?: { taskId: string };
  undo?: { scheduleId: string; changeId: string; projectId: string };
}

/** The typed-command marker of a reply's actions, or null when Claude (or nothing) answered */
export function typedReplyOf(actions: ActionResult[] | undefined): { success: boolean; data: TypedData } | null {
  const marker = actions?.find(a => a.toolName === 'typed_command' && a.data?.typed === true);
  return marker ? { success: marker.success, data: marker.data as TypedData } : null;
}

const BADGE = 'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold';

export function ClaudeBadge() {
  return (
    <span className={`${BADGE} bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      Asked Claude · uses credits
    </span>
  );
}

type UndoState = { kind: 'idle' } | { kind: 'working' } | { kind: 'done' } | { kind: 'error'; message: string };

export function TypedCommandReply({ reply, onConfirmDelete, busy }: {
  reply: { success: boolean; data: TypedData };
  /** Sends the confirmed delete (the chat shows "Confirm delete" and the app does it) */
  onConfirmDelete: (taskId: string) => void;
  busy: boolean;
}) {
  const queryClient = useQueryClient();
  const { success, data } = reply;
  const [choice, setChoice] = useState<'asking' | 'confirmed' | 'cancelled'>('asking');
  const [undo, setUndo] = useState<UndoState>({ kind: 'idle' });

  async function doUndo() {
    if (!data.undo) return;
    setUndo({ kind: 'working' });
    try {
      await apiService.undoScheduleChange(data.undo.scheduleId, data.undo.changeId);
      setUndo({ kind: 'done' });
      announce('Undone');
      refreshAfterScheduleChange(queryClient, { scheduleId: data.undo.scheduleId, projectId: data.undo.projectId });
    } catch (err) {
      // e.g. something else changed in the plan meanwhile: the server says why
      setUndo({ kind: 'error', message: getApiErrorMessage(err, 'The undo did not complete. Please try again.') });
    }
  }

  const waiting = !!data.pending && choice === 'asking';
  const badge = waiting
    ? { text: 'Waiting for your OK · no AI cost', cls: 'bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200' }
    : success
      ? { text: 'Done by the app · no AI cost', cls: 'bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200' }
      : { text: 'Nothing changed · no AI cost', cls: 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200' };

  return (
    <div className="mt-2 space-y-2 border-t border-gray-200 pt-2 dark:border-gray-600">
      {waiting && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => { setChoice('confirmed'); onConfirmDelete(data.pending!.taskId); }}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            Confirm delete
          </button>
          <button
            type="button"
            onClick={() => setChoice('cancelled')}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      )}
      {data.pending && choice === 'cancelled' && <p className="text-xs text-gray-600 dark:text-gray-300">Cancelled. Nothing was deleted.</p>}
      {data.undo && (undo.kind === 'idle' || undo.kind === 'error') && (
        <button type="button" onClick={doUndo} className="text-xs font-semibold text-primary-700 underline hover:no-underline dark:text-primary-300">Undo</button>
      )}
      <div role="status" className="text-xs text-gray-600 dark:text-gray-300">
        {undo.kind === 'working' && 'Undoing…'}
        {undo.kind === 'done' && 'Undone.'}
        {undo.kind === 'error' && <span className="text-red-700 dark:text-red-300">{undo.message}</span>}
      </div>
      <span className={`${BADGE} ${badge.cls}`}>
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        {badge.text}
      </span>
    </div>
  );
}

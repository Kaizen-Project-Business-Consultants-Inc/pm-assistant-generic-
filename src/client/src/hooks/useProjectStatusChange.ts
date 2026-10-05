import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { announce } from '../utils/announce';
import { saveFailedMessage, SHOWN_AGAIN } from '../utils/saveFailedMessage';

/**
 * The project header's status change (taken out of ProjectDetailPage, 2026-10-05). The new status
 * shows at once; if it does not save, the last saved status is put back (as before) and
 * `statusError` now says so: 'The status change to "Completed" was not saved: <reason>. The last
 * saved version is shown again — please try again.' `onSaved` runs only once the server has
 * agreed (the page closes the cancel dialog / opens the close-out prompt then).
 */
export function useProjectStatusChange(
  projectId: string | undefined,
  labelOf: (status: string) => string,
  onSaved?: (status: string) => void,
) {
  const queryClient = useQueryClient();
  const [statusError, setStatusError] = useState<string | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const labelRef = useRef(labelOf);
  labelRef.current = labelOf;

  const statusMutation = useMutation({
    mutationFn: ({ status, cancellationReason }: { status: string; cancellationReason?: string }) =>
      apiService.updateProjectStatus(projectId!, status, cancellationReason),
    onMutate: async ({ status }) => {
      // Optimistic update — immediately show the new status in the select
      await queryClient.cancelQueries({ queryKey: ['project', projectId] });
      const previous = queryClient.getQueryData(['project', projectId]);
      queryClient.setQueryData(['project', projectId], (old: any) => {
        if (!old) return old;
        // Handle both { project: {...} } and direct project shapes
        if (old.project) return { ...old, project: { ...old.project, status } };
        return { ...old, status };
      });
      return { previous };
    },
    onSuccess: (_data, { status }) => {
      setStatusError(null);
      onSavedRef.current?.(status);
    },
    onError: (error, { status }, context) => {
      // Rollback on failure
      if (context?.previous) {
        queryClient.setQueryData(['project', projectId], context.previous);
      }
      const message = saveFailedMessage(`The status change to "${labelRef.current(status)}" was not saved`, error, SHOWN_AGAIN);
      setStatusError(message);
      announce(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  return { statusMutation, statusError, setStatusError };
}

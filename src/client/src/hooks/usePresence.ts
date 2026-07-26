import { useEffect } from 'react';
import { sendWsMessage, usePresenceViewers, usePresenceEditors } from './useWebSocket';

export function usePresence(projectId: string | undefined) {
  const viewers = usePresenceViewers(projectId);
  const editors = usePresenceEditors(projectId);

  useEffect(() => {
    if (!projectId) return;

    sendWsMessage({ type: 'presence:join', projectId });

    return () => {
      sendWsMessage({ type: 'presence:leave' });
    };
  }, [projectId]);

  return { viewers, editors };
}

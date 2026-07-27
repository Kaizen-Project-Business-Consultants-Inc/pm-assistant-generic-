import { useEffect } from 'react';
import { sendWsMessage, usePresenceViewers, usePresenceEditors, useConnectionState } from './useWebSocket';

export function usePresence(projectId: string | undefined) {
  const viewers = usePresenceViewers(projectId);
  const editors = usePresenceEditors(projectId);
  const connectionState = useConnectionState();

  useEffect(() => {
    if (!projectId || connectionState !== 'connected') return;

    sendWsMessage({ type: 'presence:join', projectId });

    return () => {
      sendWsMessage({ type: 'presence:leave' });
    };
  }, [projectId, connectionState]);

  return { viewers, editors };
}

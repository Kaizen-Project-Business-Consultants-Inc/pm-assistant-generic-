import { useEffect, useState } from 'react';
import { useConnectionState, reconnectNow } from '../../hooks/useWebSocket';

export function ConnectionStatus() {
  const state = useConnectionState();
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (state === 'connected') {
      setFaded(false);
      const timer = setTimeout(() => setFaded(true), 3000);
      return () => clearTimeout(timer);
    }
    setFaded(false);
  }, [state]);

  if (state === 'connected' && faded) return null;

  return (
    <div className="flex items-center gap-1.5" title={
      state === 'connected' ? 'Connected' :
      state === 'connecting' ? 'Reconnecting...' :
      'Disconnected'
    }>
      <span className={`block w-2 h-2 rounded-full ${
        state === 'connected' ? 'bg-green-500' :
        state === 'connecting' ? 'bg-amber-500 animate-pulse motion-reduce:animate-none' :
        'bg-red-500'
      }`} aria-hidden="true" />
      <span className="sr-only">
        {state === 'connected' ? 'Connected' : state === 'connecting' ? 'Reconnecting' : 'Disconnected'}
      </span>
      {state === 'disconnected' && (
        <button
          onClick={reconnectNow}
          className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 hover:underline"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}

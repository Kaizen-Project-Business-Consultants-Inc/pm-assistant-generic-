import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001/api/v1/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/ws`;

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;
const MAX_ATTEMPTS = 20;

function getBackoffDelay(attempt: number): number {
  const base = Math.min(BACKOFF_BASE * Math.pow(2, attempt), BACKOFF_MAX);
  const jitter = base * 0.3 * (Math.random() * 2 - 1); // ±30%
  return Math.round(base + jitter);
}

// Module-level WebSocket reference for sending messages from anywhere
let globalWs: WebSocket | null = null;

export function sendWsMessage(data: object) {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify(data));
  }
}

// Module-level presence state with custom event dispatch
const PRESENCE_EVENT = 'ws:presence_update';
const presenceMap = new Map<string, { userId: string; username: string }[]>();
const editorsMap = new Map<string, { userId: string; username: string; field: string }[]>();

export function getPresenceViewers(projectId: string): { userId: string; username: string }[] {
  return presenceMap.get(projectId) || [];
}

export function getPresenceEditors(projectId: string): { userId: string; username: string; field: string }[] {
  return editorsMap.get(projectId) || [];
}

export function usePresenceViewers(projectId: string | undefined): { userId: string; username: string }[] {
  const [viewers, setViewers] = useState<{ userId: string; username: string }[]>(() =>
    projectId ? getPresenceViewers(projectId) : []
  );

  useEffect(() => {
    if (!projectId) return;
    setViewers(getPresenceViewers(projectId));

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.projectId === projectId) {
        setViewers(detail.viewers);
      }
    };
    window.addEventListener(PRESENCE_EVENT, handler);
    return () => window.removeEventListener(PRESENCE_EVENT, handler);
  }, [projectId]);

  return viewers;
}

export function usePresenceEditors(projectId: string | undefined): { userId: string; username: string; field: string }[] {
  const [editors, setEditors] = useState<{ userId: string; username: string; field: string }[]>(() =>
    projectId ? getPresenceEditors(projectId) : []
  );

  useEffect(() => {
    if (!projectId) return;
    setEditors(getPresenceEditors(projectId));

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.projectId === projectId) {
        setEditors(detail.editors || []);
      }
    };
    window.addEventListener(PRESENCE_EVENT, handler);
    return () => window.removeEventListener(PRESENCE_EVENT, handler);
  }, [projectId]);

  return editors;
}

// Module-level connection state with custom event dispatch
export type WsConnectionState = 'connected' | 'connecting' | 'disconnected';
const CONNECTION_STATE_EVENT = 'ws:connection_state';
let connectionState: WsConnectionState = 'disconnected';
let reconnectAttempts = 0;
let pendingReconnect: ReturnType<typeof setTimeout> | null = null;
let connectFn: (() => void) | null = null;

function setConnectionState(state: WsConnectionState) {
  connectionState = state;
  window.dispatchEvent(new CustomEvent(CONNECTION_STATE_EVENT, { detail: { state } }));
}

export function useConnectionState(): WsConnectionState {
  const [state, setState] = useState<WsConnectionState>(connectionState);

  useEffect(() => {
    const handler = (e: Event) => {
      setState((e as CustomEvent).detail.state);
    };
    window.addEventListener(CONNECTION_STATE_EVENT, handler);
    return () => window.removeEventListener(CONNECTION_STATE_EVENT, handler);
  }, []);

  return state;
}

export function reconnectNow() {
  if (pendingReconnect) clearTimeout(pendingReconnect);
  pendingReconnect = null;
  reconnectAttempts = 0;
  setConnectionState('connecting');
  connectFn?.();
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function connect() {
      try {
        setConnectionState('connecting');
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        globalWs = ws;

        ws.onopen = () => {
          reconnectAttempts = 0;
          setConnectionState('connected');
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            switch (message.type) {
              case 'task_updated':
              case 'task_created':
              case 'task_deleted':
                queryClient.invalidateQueries({ queryKey: ['tasks'] });
                queryClient.invalidateQueries({ queryKey: ['criticalPath'] });
                queryClient.invalidateQueries({ queryKey: ['portfolio'] });
                queryClient.invalidateQueries({ queryKey: ['workflowExecutions'] });
                break;
              case 'schedule_updated':
                queryClient.invalidateQueries({ queryKey: ['schedules'] });
                queryClient.invalidateQueries({ queryKey: ['portfolio'] });
                break;
              case 'presence_update': {
                const { projectId, viewers, editors } = message.payload;
                presenceMap.set(projectId, viewers);
                editorsMap.set(projectId, editors || []);
                window.dispatchEvent(new CustomEvent(PRESENCE_EVENT, {
                  detail: { projectId, viewers, editors: editors || [] },
                }));
                break;
              }
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (globalWs === ws) globalWs = null;
          reconnectAttempts++;
          if (reconnectAttempts < MAX_ATTEMPTS) {
            const delay = getBackoffDelay(reconnectAttempts);
            setConnectionState('connecting');
            pendingReconnect = setTimeout(connect, delay);
            reconnectTimeoutRef.current = pendingReconnect;
          } else {
            setConnectionState('disconnected');
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        reconnectAttempts++;
        if (reconnectAttempts < MAX_ATTEMPTS) {
          const delay = getBackoffDelay(reconnectAttempts);
          setConnectionState('connecting');
          pendingReconnect = setTimeout(connect, delay);
          reconnectTimeoutRef.current = pendingReconnect;
        } else {
          setConnectionState('disconnected');
        }
      }
    }

    connectFn = connect;
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pendingReconnect) {
        clearTimeout(pendingReconnect);
        pendingReconnect = null;
      }
      connectFn = null;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [queryClient]);
}

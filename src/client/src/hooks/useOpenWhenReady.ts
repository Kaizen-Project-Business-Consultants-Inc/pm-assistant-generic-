import { useCallback, useEffect, useRef } from 'react';

interface ReadyReport {
  id: string;
  title: string;
  reportType: string;
  generatedAt?: string;
}

/** Announcements kept for a job the page hasn't started waiting for yet (a quick report can beat the reply) */
const RECENT_LIMIT = 20;

/**
 * A report made in the background is announced over the WebSocket ("ws:ai_report_ready",
 * hooks/useWebSocket.ts). The page that asked for it opens it: `expect(jobId)` after starting
 * one, and `onReady(report, stillWaiting)` gets it when it is done — also when the announcement
 * came before the reply with its job id. Reports asked for elsewhere are ignored. A handled
 * announcement is marked (preventDefault) so no "find it under Reports" message shows as well
 * (UAT U44 — the "ready" message used to lead nowhere).
 */
export function useOpenWhenReady(
  onReady: (report: ReadyReport, stillWaiting: boolean) => void,
): (jobId: string) => void {
  const awaiting = useRef(new Set<string>());
  const recent = useRef(new Map<string, ReadyReport>());
  const handler = useRef(onReady);
  handler.current = onReady;

  useEffect(() => {
    const listener = (e: Event) => {
      const { jobId, report } = (e as CustomEvent<{ jobId?: string; report?: ReadyReport }>).detail ?? {};
      if (!jobId || !report?.id) return;
      if (!awaiting.current.delete(jobId)) {
        recent.current.set(jobId, report);
        if (recent.current.size > RECENT_LIMIT) recent.current.delete(recent.current.keys().next().value!);
        return;
      }
      e.preventDefault();
      handler.current(report, awaiting.current.size > 0);
    };
    window.addEventListener('ws:ai_report_ready', listener);
    return () => window.removeEventListener('ws:ai_report_ready', listener);
  }, []);

  return useCallback((jobId: string) => {
    const early = recent.current.get(jobId);
    if (early) {
      recent.current.delete(jobId);
      handler.current(early, awaiting.current.size > 0);
      return;
    }
    awaiting.current.add(jobId);
  }, []);
}

import { useRef, useEffect, useCallback } from 'react';

/**
 * setTimeout for a component's short-lived UI timers (the pasted-cell flash, "Copied 2 tasks",
 * the "saving" → "saved" step): same delays and same behaviour while mounted — every call gets
 * its own timer, none restarts another — but any still waiting are cleared on unmount, so none
 * sets state after the component is gone (in tests that ran after teardown and threw
 * "window is not defined"). 2026-10-05.
 */
export function useUnmountSafeTimeouts() {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);
  return useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);
}

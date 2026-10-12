/**
 * Work started without waiting for it (workflows after a task change, a workflow's field update).
 * In the web server that's fine; a scheduled job (scripts/runCronJob.ts) closes the database and
 * exits as soon as its own work returns, so anything still running was cut off — the overdue scan's
 * workflows, and workflows set off by tasks a job created (2026-10-12). Track such work here; the job
 * runner waits for it, up to a limit, before it exits.
 */
const pending = new Set<Promise<unknown>>();

/** Run `work` in the background, and let a job runner wait for it before exiting */
export function trackBackground<T>(work: Promise<T>): Promise<T> {
  pending.add(work);
  const forget = () => { pending.delete(work); };
  work.then(forget, forget);
  return work;
}

/**
 * Wait until no tracked work is left, or `maxMs` has passed. Work started while waiting (a workflow
 * whose update sets off another) is waited for too. Returns how many were still running at the limit.
 */
export async function settleBackgroundWork(maxMs: number): Promise<number> {
  const deadline = Date.now() + maxMs;
  while (pending.size > 0) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // eslint-disable-next-line no-await-in-loop -- wait for this round, then for whatever it started
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, left); }),
    ]);
    clearTimeout(timer);
  }
  return pending.size;
}

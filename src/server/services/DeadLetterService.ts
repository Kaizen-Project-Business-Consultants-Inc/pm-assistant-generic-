import { v4 as uuidv4 } from 'uuid';
import { deadLetterRepository } from '../database/DeadLetterRepository';
import logger from '../utils/logger';

interface DeadLetterEntry {
  id: string;
  operation: string;
  payload: any;
  errorMessage: string;
  attempts: number;
  maxAttempts: number;
  status: 'pending' | 'retrying' | 'failed' | 'resolved';
  nextRetryAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

class DeadLetterService {
  /**
   * Capture a failed fire-and-forget side effect for later retry.
   */
  capture(operation: string, payload: any, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const id = uuidv4();
    const nextRetryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    deadLetterRepository.insert(id, operation, JSON.stringify(payload), errorMessage, nextRetryAt)
    .catch((dbErr) => {
      // Last resort: log if we can't even write to DLQ
      logger.error('[DeadLetter] Failed to capture', { operation, errorMessage, dbErr });
    });
  }

  /**
   * Process pending entries that are due for retry.
   * Called by a periodic job (e.g., every 5 minutes).
   * Returns number of entries processed.
   */
  async processRetries(executor: (operation: string, payload: any) => Promise<void>): Promise<number> {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const entries = await deadLetterRepository.findDueForRetry(now);

    let processed = 0;
    for (const entry of entries) {
      try {
        let payload: any;
        try {
          payload = JSON.parse(entry.payload);
        } catch {
          // Malformed payload — mark as failed immediately
          // eslint-disable-next-line no-await-in-loop -- retry queue: each failed operation is replayed and its outcome recorded one by one
          await deadLetterRepository.markFailed(entry.id, entry.max_attempts);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop -- retry queue: failed operations are replayed one by one, in due order
        await executor(entry.operation, payload);
        // Success — mark resolved
        // eslint-disable-next-line no-await-in-loop -- retry queue: records this operation's outcome right after its replay
        await deadLetterRepository.markResolved(entry.id);
        processed++;
      } catch (retryErr) {
        const attempts = entry.attempts + 1;
        if (attempts >= entry.max_attempts) {
          // eslint-disable-next-line no-await-in-loop -- retry queue: records this operation's outcome right after its replay
          await deadLetterRepository.markFailed(entry.id, attempts);
        } else {
          // Exponential backoff: 5min, 25min, 125min...
          const delayMs = Math.pow(5, attempts) * 60 * 1000;
          const nextRetry = new Date(Date.now() + delayMs).toISOString().replace('T', ' ').substring(0, 19);
          // eslint-disable-next-line no-await-in-loop -- retry queue: schedules this operation's backoff right after its replay failed
          await deadLetterRepository.markRetrying(
            entry.id, attempts, nextRetry,
            retryErr instanceof Error ? retryErr.message : String(retryErr),
          );
        }
        processed++;
      }
    }

    return processed;
  }

  /**
   * Get DLQ stats for monitoring.
   */
  async getStats(): Promise<{ pending: number; retrying: number; failed: number; resolved24h: number }> {
    const row = await deadLetterRepository.getStats();
    return {
      pending: Number(row.pending || 0),
      retrying: Number(row.retrying || 0),
      failed: Number(row.failed || 0),
      resolved24h: Number(row.resolved24h || 0),
    };
  }

  /**
   * List failed entries for admin review.
   */
  async listFailed(limit = 50): Promise<DeadLetterEntry[]> {
    const rows = await deadLetterRepository.findFailed(limit);
    return rows.map((r: any) => {
      let payload: any;
      try {
        payload = JSON.parse(r.payload);
      } catch {
        payload = r.payload;
      }
      return {
        id: r.id,
        operation: r.operation,
        payload,
        errorMessage: r.error_message,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
        status: r.status,
        nextRetryAt: r.next_retry_at,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      };
    });
  }
}

export const deadLetterService = new DeadLetterService();

/**
 * Fire-and-forget helper that captures failures to the dead-letter queue.
 * Use instead of `.catch(() => {})` for important side effects.
 */
export function fireAndForget(promise: Promise<any>, operation: string, payload?: any): void {
  promise.catch((err) => deadLetterService.capture(operation, payload ?? {}, err));
}

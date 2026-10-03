import logger from '../utils/logger';

/**
 * "Something changed" notices (code health, 2026-10-03).
 *
 * Code that changes a plan, a rate or a RAID item posts a notice here instead of calling the
 * code that reacts to it (Schedule Review re-runs, budgets re-price, RAID Review re-runs).
 * Those reactions are connected once at startup in domainListeners.ts. This file imports
 * nothing from the app, so posting a notice can never close an import circle — calling the
 * reaction directly is what tangled the server (see importCycleGuard.test.ts).
 *
 * Delivery is immediate and in the same call, so a listener runs inside the poster's request
 * context (the right company database, the right user). A listener that throws is logged and
 * never breaks the change that posted the notice — same as the fire-and-forget calls before.
 */
export type DomainEvent =
  /** A schedule's tasks, links, dates, bookings or calendar changed */
  | { type: 'plan.changed'; scheduleId: string }
  /** One person's rates changed */
  | { type: 'person.rates.changed'; resourceId: string }
  /** The company rate card changed */
  | { type: 'ratecard.changed' }
  /** A project's RAID log changed */
  | { type: 'raid.changed'; projectId: string };

type Handler<T extends DomainEvent['type']> = (event: Extract<DomainEvent, { type: T }>) => void;

const handlers = new Map<DomainEvent['type'], Array<(event: DomainEvent) => void>>();

export function onDomainEvent<T extends DomainEvent['type']>(type: T, handler: Handler<T>): void {
  const list = handlers.get(type) ?? [];
  list.push(handler as (event: DomainEvent) => void);
  handlers.set(type, list);
}

export function publishDomainEvent(event: DomainEvent): void {
  for (const handler of handlers.get(event.type) ?? []) {
    try { handler(event); } catch (err) { logger.warn('[domainEvents] listener failed', { type: event.type, error: (err as Error)?.message }); }
  }
}

/** Shorthands for the posters */
export const planChanged = (scheduleId: string | null | undefined): void => {
  if (scheduleId) publishDomainEvent({ type: 'plan.changed', scheduleId });
};
export const personRatesChanged = (resourceId: string): void => publishDomainEvent({ type: 'person.rates.changed', resourceId });
export const rateCardChanged = (): void => publishDomainEvent({ type: 'ratecard.changed' });
export const raidChanged = (projectId: string | null | undefined): void => {
  if (projectId) publishDomainEvent({ type: 'raid.changed', projectId });
};

/** How many listeners each notice has — for the startup guard */
export function listenerCounts(): Record<DomainEvent['type'], number> {
  return {
    'plan.changed': handlers.get('plan.changed')?.length ?? 0,
    'person.rates.changed': handlers.get('person.rates.changed')?.length ?? 0,
    'ratecard.changed': handlers.get('ratecard.changed')?.length ?? 0,
    'raid.changed': handlers.get('raid.changed')?.length ?? 0,
  };
}

/** Test hook */
export function _resetDomainEventsForTests(): void { handlers.clear(); }

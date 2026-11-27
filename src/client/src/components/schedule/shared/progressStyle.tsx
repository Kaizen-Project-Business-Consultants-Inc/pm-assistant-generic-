import { createContext, useContext } from 'react';

/**
 * The plan's progress style (Plan menu, Nov 2026): 'done' = each task is Done (100) or Not done (0);
 * 'percent' = any % (as always). Provided once by the Schedule workspace; the Table and Gantt % cells read it.
 */
const ProgressStyleContext = createContext(false);
export const ProgressStyleProvider = ProgressStyleContext.Provider;

/** True when this plan tracks tasks as done / not done (headings still show their rolled-up %) */
export const useDoneOnly = (): boolean => useContext(ProgressStyleContext);

export const DONE_OPTIONS = [
  { value: '0', label: 'Not done' },
  { value: '100', label: 'Done' },
] as const;

/** What a task's % cell says in a done / not done plan */
export const doneLabel = (pct: number | null | undefined): string => ((pct ?? 0) >= 100 ? 'Done' : 'Not done');

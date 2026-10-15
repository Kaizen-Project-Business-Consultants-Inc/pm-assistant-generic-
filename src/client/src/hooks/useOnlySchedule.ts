import { useEffect } from 'react';

/** The project's plans: What-If scenario copies are listed with them (newest first) but are not plans */
export function plansOnly<T extends { isScenario?: boolean }>(schedules: T[]): T[] {
  return schedules.filter(s => !s.isScenario);
}

/**
 * A project has one schedule (user 2026-10-14, U26). Returns the project's plans — What-If
 * scenario copies are not plans — and picks the plan when there is exactly one, so screens need no
 * schedule picker. Screens show a picker (listing these plans) only when an older project still
 * has several. `enabled: false` holds the pick back, e.g. while a link's own schedule is resolved.
 */
export function useOnlySchedule<T extends { id: string; isScenario?: boolean }>(
  schedules: T[],
  selectedId: string,
  setSelectedId: (id: string) => void,
  enabled = true,
): T[] {
  const plans = plansOnly(schedules);
  const onlyId = plans.length === 1 ? plans[0].id : null;
  useEffect(() => {
    if (enabled && onlyId && !selectedId) setSelectedId(onlyId);
  }, [enabled, onlyId, selectedId, setSelectedId]);
  return plans;
}

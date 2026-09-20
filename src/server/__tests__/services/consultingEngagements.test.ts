import { describe, it, expect } from 'vitest';
import { consultingEngagementTemplates } from '../../services/templates/consultingEngagements';
import { projectTemplateSchema } from '../../schemas/templateSchemas';

/**
 * These templates are the first thing a new consultant sees, so they have to be
 * structurally sound. A broken reference or a gate carrying a duration would show up as
 * a nonsense schedule, and the schedule review would then flag the product's own starter
 * content as poor practice.
 */
describe('consulting engagement templates', () => {
  it('provides a template for each engagement shape', () => {
    expect(consultingEngagementTemplates.length).toBeGreaterThanOrEqual(4);
    const ids = consultingEngagementTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(consultingEngagementTemplates.map((t) => [t.name, t] as const))(
    '%s is a valid template',
    (_name, template) => {
      expect(() => projectTemplateSchema.parse(template)).not.toThrow();
    },
  );

  describe.each(consultingEngagementTemplates.map((t) => [t.name, t] as const))('%s', (_name, template) => {
    const refIds = new Set(template.tasks.map((t) => t.refId));

    it('has unique task references', () => {
      expect(refIds.size).toBe(template.tasks.length);
    });

    it('never points a dependency or parent at something that does not exist', () => {
      for (const task of template.tasks) {
        if (task.dependencyRefId) {
          expect(refIds.has(task.dependencyRefId), `${task.refId} depends on a missing ${task.dependencyRefId}`).toBe(true);
        }
        if (task.parentRefId) {
          expect(refIds.has(task.parentRefId), `${task.refId} sits under a missing ${task.parentRefId}`).toBe(true);
        }
      }
    });

    it('has no task depending on itself', () => {
      for (const task of template.tasks) {
        expect(task.dependencyRefId).not.toBe(task.refId);
      }
    });

    it('has no circular dependency', () => {
      const depOf = new Map(template.tasks.map((t) => [t.refId, t.dependencyRefId]));
      for (const start of refIds) {
        const seen = new Set<string>([start]);
        let cursor = depOf.get(start) ?? null;
        while (cursor) {
          expect(seen.has(cursor), `cycle reached from ${start} via ${cursor}`).toBe(false);
          seen.add(cursor);
          cursor = depOf.get(cursor) ?? null;
        }
      }
    });

    it('includes at least one gate', () => {
      // Gates are where acceptance and usually payment sit. An engagement plan without
      // one is a task list.
      expect(template.tasks.some((t) => t.isMilestone)).toBe(true);
    });

    it('gives the consultant starter risks and assumptions', () => {
      expect(template.raidItems?.length ?? 0).toBeGreaterThan(0);
    });

    it('scores probability and impact only on risks', () => {
      for (const item of template.raidItems ?? []) {
        if (item.type !== 'risk') {
          expect(item.probability, `${item.title} is a ${item.type} but carries a probability`).toBeUndefined();
          expect(item.impact).toBeUndefined();
        }
      }
    });

    it('states a report cadence, because the client will expect one', () => {
      expect(template.reportCadence).toBeDefined();
      expect(template.reportCadence!.dayOfWeek).toBeGreaterThanOrEqual(1);
      expect(template.reportCadence!.dayOfWeek).toBeLessThanOrEqual(7);
    });

    it('has a duration consistent with its phases', () => {
      const topLevel = template.tasks.filter((t) => !t.parentRefId && !t.isMilestone);
      const longestPath = topLevel.reduce((sum, t) => sum + t.estimatedDays, 0);
      // Phases mostly run in sequence, so the stated duration should be in the same
      // region as their total — not half of it, and not triple.
      expect(template.estimatedDurationDays).toBeGreaterThan(longestPath * 0.5);
      expect(template.estimatedDurationDays).toBeLessThan(longestPath * 2.5);
    });
  });

  it('flags every gate as a milestone rather than a one-day task', () => {
    // A gate with a duration is exactly what the schedule review penalises, so the
    // product's own starters must not contain one.
    for (const template of consultingEngagementTemplates) {
      for (const task of template.tasks) {
        if (/^gate\b/i.test(task.name)) {
          expect(task.isMilestone, `${template.name}: "${task.name}" is not flagged as a milestone`).toBe(true);
        }
      }
    }
  });
});

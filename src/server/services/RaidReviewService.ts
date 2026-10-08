import { randomUUID } from 'crypto';
import { riskRepository, RAID_RESPONSE_STRATEGIES, type ProjectRisk } from '../database/RiskRepository';
import { raidReviewRepository } from '../database/RaidReviewRepository';
import { riskService } from './RiskService';
import { projectMemberService } from './ProjectMemberService';
import { resourceService } from './ResourceService';
import { calendarService } from './CalendarService';
import { statusDateFor } from './StatusDateService';
import { reviewRaid, RULE_IDS, type RaidFinding } from './raidReview/rules';
import { proposeFixes, type RaidFix } from './raidReview/fixProposer';
import { RAID_STATUSES, type RaidType } from '../utils/raidImport';
import { toDateString } from '../utils/calendarDate';
import { type IsWorking, weekdaysOnly, ymdOf } from '../utils/workingDays';
import logger from '../utils/logger';

export interface RaidReview {
  id: string;
  projectId: string;
  score: number;
  rulesVersion: string;
  itemsChecked: number;
  createdAt: string;
  findings: RaidFinding[];
  disabledRules: string[];
}

export interface RaidFixRequest {
  id: string;
  kind: string;
  itemId: string;
  value?: string;
  toType?: string;
}

export interface PersonOption { value: string; label: string }

/** A request the user can correct (400 with this plain message) */
export class RaidReviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RaidReviewInputError';
  }
}

/** Undo refused: not the newest set of fixes, or the register changed since (409; there is no "undo anyway") */
export class RaidUndoConflictError extends Error {
  constructor(public readonly changed: number, message: string, public readonly code = 'edited_since') {
    super(message);
    this.name = 'RaidUndoConflictError';
  }
}

export class RaidReviewNotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'RaidReviewNotFoundError';
  }
}

/** Items touched after the batch was saved by more than this are "changed since" */
const EDIT_GRACE_MS = 5_000;

/** DB timestamps come back as 'YYYY-MM-DD HH:MM:SS' (UTC server); read them consistently */
function epoch(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
}

const TYPE_PLURAL: Record<string, string> = {
  risk: 'Risks', issue: 'Issues', action: 'Actions', decision: 'Decisions', assumption: 'Assumptions', dependency: 'Dependencies',
};

export class RaidReviewService {
  /** Run the rules over the project's whole RAID log (closed items included), store and return */
  async run(projectId: string, userId?: string | null): Promise<RaidReview> {
    const [items, disabledRules, today] = await Promise.all([
      riskRepository.findByProject(projectId),
      raidReviewRepository.getDisabledRules(projectId),
      statusDateFor(projectId),
    ]);
    const result = reviewRaid({ items, today, disabledRules });
    const id = randomUUID();
    await raidReviewRepository.insertReview({
      id,
      projectId,
      score: result.score,
      rulesVersion: result.rulesVersion,
      itemsChecked: result.itemsChecked,
      findings: result.findings,
      createdBy: userId ?? null,
    });
    raidReviewRepository.pruneReviews(projectId).catch(err =>
      logger.warn('[RaidReview] prune failed', { projectId, error: err?.message }),
    );
    const stored = await raidReviewRepository.findReviewById(id);
    return {
      id,
      projectId,
      score: result.score,
      rulesVersion: result.rulesVersion,
      itemsChecked: result.itemsChecked,
      createdAt: stored?.createdAt ?? new Date().toISOString(),
      findings: result.findings,
      disabledRules,
    };
  }

  async latest(projectId: string): Promise<RaidReview | null> {
    const [row, disabledRules] = await Promise.all([
      raidReviewRepository.findLatestReview(projectId),
      raidReviewRepository.getDisabledRules(projectId),
    ]);
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      score: row.score,
      rulesVersion: row.rulesVersion,
      itemsChecked: row.itemsChecked,
      createdAt: row.createdAt,
      findings: row.findings,
      disabledRules,
    };
  }

  /** Switch checks off (unknown ids are dropped), then re-run so the score reflects it */
  async setDisabledRules(projectId: string, rules: string[], userId?: string | null): Promise<string[]> {
    const clean = [...new Set(rules.filter(r => RULE_IDS.includes(r)))].sort();
    await raidReviewRepository.setDisabledRules(projectId, clean);
    try { await this.run(projectId, userId); } catch (err: any) {
      logger.warn('[RaidReview] re-run after settings change failed', { projectId, error: err?.message });
    }
    return clean;
  }

  /** Fixes for the log as it is now (not the stored review, which may be ~20 s old) */
  async proposeFixes(projectId: string): Promise<{ fixes: RaidFix[]; people: PersonOption[] }> {
    const [items, disabledRules, today, isWorking, people] = await Promise.all([
      riskRepository.findByProject(projectId),
      raidReviewRepository.getDisabledRules(projectId),
      statusDateFor(projectId),
      this.workingDayTest(projectId),
      this.people(projectId),
    ]);
    // Also offer the people named in the log's own owner column ("Marsha Turner / Rashida
    // Wynter" → both), so a register whose owners aren't app users can still be fixed
    const known = new Set(people.map(p => p.label.toLowerCase()));
    for (const name of namesInOwnerColumn(items)) {
      if (known.has(name.toLowerCase())) continue;
      known.add(name.toLowerCase());
      people.push({ value: name, label: `${name} (named in the log)` });
    }
    people.sort((a, b) => a.label.localeCompare(b.label));
    const { findings } = reviewRaid({ items, today, disabledRules });
    return { fixes: proposeFixes({ findings, items, today, isWorking }), people };
  }

  /** Project members (as login accounts) and the organisation's resources without one */
  async people(projectId: string): Promise<PersonOption[]> {
    const [members, resources] = await Promise.all([
      projectMemberService.findByProjectId(projectId).catch(() => []),
      resourceService.findAllResources().catch(() => []),
    ]);
    const memberIds = new Set(members.map(m => m.userId));
    const out: PersonOption[] = members
      .filter(m => m.userId)
      .map(m => ({ value: `user:${m.userId}`, label: m.userName || m.email || 'Unnamed member' }));
    for (const r of resources) {
      if (r.isActive === false) continue;
      if (r.userId && memberIds.has(r.userId)) continue; // already listed as the member
      out.push({ value: `resource:${r.id}`, label: r.name });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  async applyFixes(projectId: string, fixes: RaidFixRequest[], userId: string): Promise<{ batchId: string; applied: number; summary: string }> {
    if (fixes.length === 0) throw new RaidReviewInputError('Tick at least one fix to apply.');

    // Load and check everything first, so a bad request changes nothing
    const itemCache = new Map<string, ProjectRisk>();
    const plans: Array<{ fix: RaidFixRequest; item: ProjectRisk; data: Record<string, any> }> = [];
    let people: PersonOption[] | null = null;

    for (const fix of fixes) {
      let item = itemCache.get(fix.itemId);
      if (!item) {
        const found = await riskRepository.findById(fix.itemId);
        if (!found || found.projectId !== projectId) throw new RaidReviewInputError('One of these RAID items no longer exists. Re-run the review and try again.');
        item = found;
        itemCache.set(item.id, item);
      }
      const label = item.recordId || `"${item.title}"`;
      const value = typeof fix.value === 'string' ? fix.value.trim() : '';

      switch (fix.kind) {
        case 'change_type': {
          const toType = (fix.toType || 'action') as RaidType;
          if (!RAID_STATUSES[toType]) throw new RaidReviewInputError(`"${fix.toType}" is not a RAID type.`);
          if (toType === item.type) throw new RaidReviewInputError(`${label} is already in ${TYPE_PLURAL[toType]}.`);
          plans.push({ fix, item, data: { type: toType } });
          break;
        }
        case 'set_owner': {
          if (!value) throw new RaidReviewInputError(`Pick a person for ${label}`);
          if (value.startsWith('user:') || value.startsWith('resource:')) {
            // eslint-disable-next-line no-await-in-loop -- loads the people list once (??=); later iterations skip the await
            people ??= await this.people(projectId);
            if (!people.some(p => p.value === value)) throw new RaidReviewInputError(`The person picked for ${label} is not on this project. Pick someone from the list.`);
            const id = value.slice(value.indexOf(':') + 1);
            plans.push({
              fix, item,
              data: value.startsWith('user:')
                ? { ownerId: id, ownerResourceId: null, ownerName: null }
                : { ownerResourceId: id, ownerId: null, ownerName: null },
            });
          } else {
            plans.push({ fix, item, data: { ownerName: value.slice(0, 255), ownerId: null, ownerResourceId: null } });
          }
          break;
        }
        case 'set_due_date': {
          const d = toDateString(value);
          if (!value || !d || d !== value.slice(0, 10) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
            throw new RaidReviewInputError(`Pick a due date for ${label}`);
          }
          plans.push({ fix, item, data: { dueDate: d } });
          break;
        }
        case 'set_response_strategy': {
          if (!value || !(RAID_RESPONSE_STRATEGIES as readonly string[]).includes(value)) {
            throw new RaidReviewInputError(`Pick a response strategy for ${label}`);
          }
          plans.push({ fix, item, data: { responseStrategy: value } });
          break;
        }
        default:
          throw new RaidReviewInputError(`Unknown fix "${fix.kind}".`);
      }
    }

    // Previous values, per item, taken once from the original before anything changes
    const previous: Record<string, Record<string, unknown>> = {};
    const remember = (item: ProjectRisk, fields: string[]) => {
      const prev = (previous[item.id] ??= {});
      for (const f of fields) {
        if (f in prev) continue;
        const v = (item as any)[f];
        prev[f] = f === 'dueDate' ? toDateString(v) : v ?? null;
      }
    };

    const counts = { moved: 0, owner: 0, due: 0, strategy: 0 };
    const moveTargets = new Map<string, string>();
    // Field fixes first, then moves (a move renumbers the item)
    const ordered = [...plans.filter(p => p.fix.kind !== 'change_type'), ...plans.filter(p => p.fix.kind === 'change_type')];
    for (const { fix, item, data } of ordered) {
      if (fix.kind === 'change_type') {
        const toType = data.type as RaidType;
        const status = RAID_STATUSES[toType].includes(item.status) ? undefined : 'open';
        // eslint-disable-next-line no-await-in-loop -- a move takes the next record number in its new register; moves must run one after another or two get the same number
        const { sequenceNumber, recordId } = await riskRepository.nextSequenceId(toType, projectId);
        const update: Record<string, any> = { type: toType, recordId, sequenceNumber };
        if (status) update.status = status;
        remember(item, ['type', 'recordId', 'sequenceNumber', 'status', 'resolvedAt']);
        // eslint-disable-next-line no-await-in-loop -- the move must be saved before the next move asks for the next record number
        await riskService.update(item.id, update, userId);
        counts.moved++;
        moveTargets.set(item.id, toType);
      } else {
        remember(item, Object.keys(data));
        await riskService.update(item.id, { ...data }, userId);
        if (fix.kind === 'set_owner') counts.owner++;
        else if (fix.kind === 'set_due_date') counts.due++;
        else counts.strategy++;
      }
    }

    const parts: string[] = [];
    if (counts.moved) {
      const targets = new Set(moveTargets.values());
      const where = targets.size === 1 ? TYPE_PLURAL[[...targets][0]] : 'another type';
      parts.push(`${counts.moved} moved to ${where}`);
    }
    if (counts.owner) parts.push(`${counts.owner} owner${counts.owner > 1 ? 's' : ''} set`);
    if (counts.due) parts.push(`${counts.due} due date${counts.due > 1 ? 's' : ''} set`);
    if (counts.strategy) parts.push(`${counts.strategy} response strateg${counts.strategy > 1 ? 'ies' : 'y'} set`);
    const summary = `RAID Review fixes: ${parts.join(', ')}`;

    const batchId = randomUUID();
    await raidReviewRepository.insertBatch({
      id: batchId,
      projectId,
      summary,
      previous,
      itemIds: Object.keys(previous),
      createdBy: userId,
    });

    await this.rerunQuietly(projectId, userId);
    return { batchId, applied: plans.length, summary };
  }

  /**
   * Same rule as Schedule History (product owner, 2026-10-01): only the newest set of fixes on the
   * project can be undone, and only while no RAID item has changed since. No "undo anyway".
   */
  async undo(projectId: string, batchId: string, userId: string): Promise<{ restored: number }> {
    const batch = await raidReviewRepository.findBatch(batchId);
    if (!batch || batch.projectId !== projectId) throw new RaidReviewNotFoundError('These fixes were not found.');
    if (batch.undoneAt) throw new RaidUndoConflictError(0, 'These fixes were already undone.', 'already_undone');

    const latest = await raidReviewRepository.findLatestBatchId(projectId);
    const changedSince = await raidReviewRepository.itemsChangedSince(projectId, batch.createdAt, EDIT_GRACE_MS / 1000);
    if (latest !== batchId || changedSince > 0) {
      throw new RaidUndoConflictError(
        changedSince,
        'Only the most recent fixes can be undone, and only until something else in the register changes. To reverse older fixes, change the items again by hand.',
        'not_latest',
      );
    }

    const items = (await Promise.all(batch.itemIds.map(id => riskRepository.findById(id))))
      .filter((i): i is ProjectRisk => !!i && i.projectId === projectId);

    let restored = 0;
    for (const item of items) {
      const prev = { ...(batch.previous[item.id] || {}) };
      if (Object.keys(prev).length === 0) continue;
      // The old record id may have been reused since (numbering follows the highest number)
      if (typeof prev.recordId === 'string' && prev.recordId !== item.recordId
        // eslint-disable-next-line no-await-in-loop -- Undo restores items in order; an earlier restore can take a record id a later one wants
        && await riskRepository.recordIdTaken(projectId, prev.recordId, item.id)) {
        // eslint-disable-next-line no-await-in-loop -- Undo restores items in order; the next free record id depends on the restores before it
        const next = await riskRepository.nextSequenceId(String(prev.type || item.type), projectId);
        prev.recordId = next.recordId;
        prev.sequenceNumber = next.sequenceNumber;
      }
      // Explicit nulls must clear the field; resolveOwner:false writes owners exactly as they were
      // eslint-disable-next-line no-await-in-loop -- Undo restores items in order; later record-id checks depend on this write
      await riskRepository.update(item.id, prev, { resolveOwner: false });
      restored++;
      riskRepository.createActivityLog({
        raidItemId: item.id,
        projectId,
        userId,
        actionType: 'field_update',
        fieldName: Object.keys(prev).join(','),
        comment: `Undid: ${batch.summary}`,
      }).catch(err => logger.warn('[RaidReview] undo activity log failed', { itemId: item.id, error: err?.message }));
    }

    await raidReviewRepository.markUndone(batchId, userId);
    await this.rerunQuietly(projectId, userId);
    return { restored };
  }

  private async rerunQuietly(projectId: string, userId: string | null): Promise<void> {
    try { await this.run(projectId, userId); } catch (err: any) {
      logger.warn('[RaidReview] re-run failed', { projectId, error: err?.message });
    }
  }

  private async workingDayTest(projectId: string): Promise<IsWorking> {
    try {
      const check = await calendarService.workingDayChecker(projectId);
      return d => check(ymdOf(d));
    } catch (err: any) {
      logger.warn('[RaidReview] project calendar unavailable, using Mon–Fri', { projectId, error: err?.message });
      return weekdaysOnly;
    }
  }
}

export const raidReviewService = new RaidReviewService();

/** Individual names in the owner-name column: split on / , ; & "and"; single words (teams like "DBJ") left out */
export function namesInOwnerColumn(items: Array<{ ownerName?: string | null }>): string[] {
  const out = new Set<string>();
  for (const it of items) {
    for (const part of (it.ownerName || '').split(/\s*(?:\/|,|;|&|\band\b)\s*/i)) {
      const name = part.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (name.split(/\s+/).length >= 2 && name.length <= 80) out.add(name);
    }
  }
  return [...out];
}

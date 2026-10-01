/**
 * Meeting Coach (2026-10-01). People call out actions, risks, issues, decisions and dependencies
 * as they talk ("that's an action for Tom — by Friday"); the analysis marks those `calledOut`
 * and everything else the AI noticed as spotted. This module turns the AI's names and dates into
 * project people and working-day dates, and builds the meeting scorecard. Pure — no I/O.
 * Only the PM adds anything to RAID; nothing here changes project data.
 */
import { IsWorking, onOrAfterWorking, ymdOf } from '../utils/workingDays';

export interface Person { userId: string; name: string }

export interface OwnerMatch {
  /** the project member this is, when there is exactly one */
  ownerUserId?: string;
  /** the name to show / store when it's nobody on the project (e.g. a vendor) */
  ownerName?: string;
  /** two or more members fit ("Tom" → Tom Reyes, Tom Okafor): the PM picks */
  ownerChoices?: Person[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** "Tom" / "Tom Reyes" / "tom reyes (not a project member)" → a project member, a choice, or just a name */
export function resolveOwner(name: string | undefined, members: Person[]): OwnerMatch {
  const raw = (name || '').replace(/\(not a project member\)/i, '').trim();
  if (!raw || /^(unassigned|tbd|none|n\/a|unknown)$/i.test(raw)) return {};
  const n = norm(raw);
  const exact = members.filter(m => norm(m.name) === n);
  if (exact.length === 1) return { ownerUserId: exact[0].userId, ownerName: exact[0].name };
  const byFirst = members.filter(m => norm(m.name).split(' ')[0] === n || norm(m.name).startsWith(n + ' '));
  if (byFirst.length === 1) return { ownerUserId: byFirst[0].userId, ownerName: byFirst[0].name };
  if (byFirst.length > 1) return { ownerChoices: byFirst };
  if (exact.length > 1) return { ownerChoices: exact };
  return { ownerName: raw };
}

/** The AI's due date (already worked out from the meeting date) → that day, or the next working day */
export function workingDue(due: string | undefined, isWorking: IsWorking): string | undefined {
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return undefined;
  const d = new Date(`${due}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return ymdOf(onOrAfterWorking(d, isWorking));
}

interface CoachItem { calledOut?: boolean; description?: string; decision?: string }
interface CoachInput {
  actionItems: (CoachItem & { assignee?: string; ownerUserId?: string; ownerName?: string; dueDate?: string })[];
  risks: (CoachItem & { owner?: string; ownerUserId?: string; ownerName?: string })[];
  issues: (CoachItem & { owner?: string; ownerUserId?: string; ownerName?: string })[];
  decisions: CoachItem[];
  dependencies: CoachItem[];
}

export interface Scorecard {
  calledOut: number;
  aiOnly: number;
  actions: { total: number; withOwnerAndDate: number };
  risks: { total: number; withOwner: number };
  tips: string[];
  /** share of items called out: this meeting and the project's recent meetings (oldest first, ≤ 4) */
  trend: { recentShare: number | null; meetings: number; previousShare: number | null };
}

const hasOwner = (i: { ownerUserId?: string; ownerName?: string }) => !!(i.ownerUserId || i.ownerName);
const short = (s: string | undefined) => {
  const t = (s || '').trim();
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};
const share = (c: { calledOut: number; aiOnly: number }) =>
  c.calledOut + c.aiOnly === 0 ? null : c.calledOut / (c.calledOut + c.aiOnly);

/**
 * The scorecard shown with the results. `previous` are earlier meetings' scorecards for the same
 * project, newest first. It coaches the meeting; it never names who did badly.
 */
export function buildScorecard(a: CoachInput, previous: Pick<Scorecard, 'calledOut' | 'aiOnly'>[] = []): Scorecard {
  const all: CoachItem[] = [...a.actionItems, ...a.risks, ...a.issues, ...a.decisions, ...a.dependencies];
  const calledOut = all.filter(i => i.calledOut).length;
  const aiOnly = all.length - calledOut;
  const tips: string[] = [];

  for (const x of a.actionItems) {
    if (!hasOwner(x)) tips.push(`"${short(x.description)}" had no owner. Ask "who owns it?" before moving on.`);
    else if (!x.dueDate) tips.push(`"${short(x.description)}" had no date. Ask "by when?" before moving on.`);
  }
  for (const r of a.risks) if (!hasOwner(r)) tips.push(`Risk "${short(r.description)}" has nobody watching it. Ask "who's watching it?"`);
  for (const i of a.issues) if (!i.calledOut) tips.push(`"${short(i.description)}" was discussed but never called out as an issue.`);
  for (const r of a.risks) if (!r.calledOut) tips.push(`"${short(r.description)}" was discussed but never called out as a risk.`);

  const recent = [{ calledOut, aiOnly }, ...previous.slice(0, 3)];
  const older = previous.slice(3, 7);
  const sum = (xs: { calledOut: number; aiOnly: number }[]) =>
    xs.reduce((s, x) => ({ calledOut: s.calledOut + x.calledOut, aiOnly: s.aiOnly + x.aiOnly }), { calledOut: 0, aiOnly: 0 });

  return {
    calledOut,
    aiOnly,
    actions: { total: a.actionItems.length, withOwnerAndDate: a.actionItems.filter(x => hasOwner(x) && !!x.dueDate).length },
    risks: { total: a.risks.length, withOwner: a.risks.filter(hasOwner).length },
    tips: tips.slice(0, 6),
    trend: { recentShare: share(sum(recent)), meetings: recent.length, previousShare: older.length ? share(sum(older)) : null },
  };
}

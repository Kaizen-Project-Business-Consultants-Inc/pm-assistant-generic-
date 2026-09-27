import { describe, it, expect } from 'vitest';
import { buildProjectBriefings, statusSummary, taskLink } from '../../utils/briefingByProject';

const fmt = (d: string) => d;

// Shaped like the staging briefing for michaela@kpbc.ca on 2026-09-27
const briefing = {
  actionItems: { pendingProposals: 0, pendingChangeRequests: [], unreadNotifications: { total: 174, critical: 0, high: 59 } },
  tasksDueToday: [],
  tasksDueThisWeek: [
    { id: 'n1', name: 'Verify new accounts', projectId: 'nswma', projectName: 'NSWMA', projectCode: 'PRJ-006', scheduleId: 's-n', dueDate: '2026-09-29', daysUntil: 2, rowNumber: 2 },
  ],
  overdueTasks: [
    { id: 'l1', name: 'Gate 1 acceptance', projectId: 'loans', projectName: 'DBJ-Loans', projectCode: 'PRJ-002', scheduleId: 's-l', overdueDays: 67, rowNumber: 3 },
    { id: 'm1', name: 'Gate 1 acceptance', projectId: 'lms', projectName: 'DBJ-LMS', projectCode: 'PRJ-012', scheduleId: 's-m', overdueDays: 58, rowNumber: 5 },
    { id: 'm2', name: 'SSD Part-1', projectId: 'lms', projectName: 'DBJ-LMS', projectCode: 'PRJ-012', scheduleId: 's-m', overdueDays: 12, rowNumber: 9 },
  ],
  recentHighRisks: [],
  upcomingMilestones: [],
  raidWatch: [
    { id: 'b1', type: 'blocked_task', label: 'D2 Submission', projectId: 'lms', projectName: 'DBJ-LMS', projectCode: 'PRJ-012', detail: 'blocked by: Gate 1 acceptance', linkTab: 'schedule', rowNumber: 14, scheduleId: 's-m' },
  ],
  projects: [
    { id: 'lms', name: 'DBJ-LMS', code: 'PRJ-012', projectType: 'other', methodology: 'waterfall', counts: { overdue: 2, dueSoon: 0, blocked: 1, openIssues: 0, overdueActions: 0 }, nextMilestone: null },
    { id: 'loans', name: 'DBJ-Loans', code: 'PRJ-002', projectType: 'it', methodology: 'waterfall', counts: { overdue: 1, dueSoon: 0, blocked: 0, openIssues: 0, overdueActions: 0 }, nextMilestone: null },
    { id: 'nswma', name: 'NSWMA', code: 'PRJ-006', projectType: 'app_development', methodology: 'hybrid', counts: { overdue: 0, dueSoon: 1, blocked: 0, openIssues: 0, overdueActions: 0 }, nextMilestone: { name: 'Design sign-off', dueDate: '2026-10-30' } },
    { id: 'quiet', name: 'Aardvark Website', code: 'PRJ-020', projectType: 'web_design', methodology: null, counts: { overdue: 0, dueSoon: 0, blocked: 0, openIssues: 0, overdueActions: 0 }, nextMilestone: null },
  ],
};

describe('buildProjectBriefings', () => {
  const projects = buildProjectBriefings(briefing, { showApprovals: true, formatDate: fmt });

  it('gives every visible project its own block, quiet ones included', () => {
    expect(projects.map(p => p.id).sort()).toEqual(['lms', 'loans', 'nswma', 'quiet']);
  });

  it('puts the project that needs you most first and quiet projects last', () => {
    expect(projects[0].id).toBe('lms'); // 2 late + 1 blocked beats 1 late (67 days)
    expect(projects[projects.length - 1].id).toBe('quiet');
    expect(projects.find(p => p.id === 'quiet')!.quiet).toBe(true);
  });

  it('keeps each project’s items separate, not mixed', () => {
    const lms = projects.find(p => p.id === 'lms')!;
    expect(lms.sections.find(s => s.key === 'late')!.items.map(i => i.id)).toEqual(['m1', 'm2']);
    expect(lms.sections.find(s => s.key === 'blocked')!.items[0].extra).toBe('Waiting on: Gate 1 acceptance');
  });

  it('colours by need: blocked or a week late = red, due only = green', () => {
    expect(projects.find(p => p.id === 'lms')!.level).toBe('red');
    expect(projects.find(p => p.id === 'loans')!.level).toBe('red');
    expect(projects.find(p => p.id === 'nswma')!.level).toBe('green');
  });

  it('uses the server’s true count when the list was capped', () => {
    const capped = buildProjectBriefings(
      { ...briefing, projects: [{ ...briefing.projects[0], counts: { ...briefing.projects[0].counts, overdue: 63 } }] },
      { showApprovals: true, formatDate: fmt },
    );
    const late = capped.find(p => p.id === 'lms')!.sections.find(s => s.key === 'late')!;
    expect(late.count).toBe(63);
    expect(late.moreLink).toBe('/project/lms?tab=schedule&qf=late');
  });

  it('links each task straight to its row on the right schedule', () => {
    const item = projects.find(p => p.id === 'lms')!.sections.find(s => s.key === 'late')!.items[0];
    expect(item.link).toBe('/project/lms?tab=schedule&schedule=s-m&task=m1');
    expect(item.rowNum).toBe(5);
  });

  it('leaves out approvals for viewers', () => {
    const v = buildProjectBriefings(briefing, { showApprovals: false, formatDate: fmt });
    expect(v[0].sections.some(s => s.key === 'approvals')).toBe(false);
  });

  it('still shows a project that has items but is missing from the project list', () => {
    const orphan = buildProjectBriefings({ ...briefing, projects: [] }, { showApprovals: true, formatDate: fmt });
    expect(orphan.map(p => p.id).sort()).toEqual(['lms', 'loans', 'nswma']);
  });

  it('describes the subtitle with the shared project-type labels', () => {
    expect(projects.find(p => p.id === 'nswma')!.subtitle).toBe('PRJ-006 · App Development · Hybrid');
  });
});

describe('statusSummary', () => {
  it('reads like a sentence fragment', () => {
    const [lms] = buildProjectBriefings(briefing, { showApprovals: true, formatDate: fmt });
    expect(statusSummary(lms)).toBe('2 late, 1 blocked');
  });
});

describe('taskLink', () => {
  it('works without a schedule id', () => {
    expect(taskLink('p', undefined, 't')).toBe('/project/p?tab=schedule&task=t');
  });
});

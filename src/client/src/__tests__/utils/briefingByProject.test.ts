import { describe, it, expect } from 'vitest';
import { buildProjectBriefings, statusSummary, taskLink } from '../../utils/briefingByProject';

const TODAY = '2026-09-28';

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

describe('Team follow-up vs Yours to do (Sep 2026)', () => {
  const withMine = {
    ...briefing,
    projects: briefing.projects.map(p => (p.id === 'lms' ? { ...p, canManage: false } : { ...p, canManage: true })),
    stalledTasks: [
      { id: 'st1', name: 'Core LMS configuration', projectId: 'loans', projectName: 'DBJ-Loans', projectCode: 'PRJ-002', scheduleId: 's-l', daysSinceStart: 20, rowNumber: 7, resourceName: 'DBJ / JV' },
    ],
    pendingProposals: [{ id: 'ap1', title: 'Reschedule SSD Part-1', projectId: 'loans', riskLevel: 'high', createdAt: '2026-09-27' }],
    mine: {
      tasks: [
        // late AND mine: must move out of the team list
        { id: 'l1', name: 'Gate 1 acceptance', projectId: 'loans', scheduleId: 's-l', dueDate: '2026-07-22', status: 'in_progress', overdueDays: 67, rowNumber: 3 },
        { id: 'y1', name: 'Kick-off workshop', projectId: 'nswma', scheduleId: 's-n', dueDate: '2026-10-05', status: 'pending', overdueDays: 0 },
        { id: 'y2', name: 'UAT with NSWMA', projectId: 'nswma', scheduleId: 's-n', dueDate: '2027-02-17', status: 'pending', overdueDays: 0 },
      ],
      raidItems: [
        { id: 'r1', title: 'Design sign-off before development', type: 'decision', status: 'pending_decision', severity: 'high', dueDate: null, projectId: 'nswma' },
        { id: 'r2', title: 'Issue inputs request', type: 'action', status: 'open', severity: 'medium', dueDate: '2026-10-16', projectId: 'nswma' },
      ],
    },
  };
  const ps = buildProjectBriefings(withMine, { showApprovals: true, formatDate: (d: string) => d, today: TODAY });
  const get = (id: string) => ps.find(p => p.id === id)!;

  it('shows a late task of yours under Yours, not in the team list', () => {
    const loans = get('loans');
    expect(loans.sections.find(s => s.key === 'late')!.items.map(i => i.id)).not.toContain('l1');
    expect(loans.sections.find(s => s.key === 'late')!.count).toBe(0);
    expect(loans.yours.tasks.map(i => i.id)).toEqual(['l1']);
    expect(loans.yours.tasks[0].tag).toBe('67 days late');
  });

  it('keeps only the next two weeks in Yours and offers the next one after', () => {
    const n = get('nswma');
    expect(n.yours.tasks.map(i => i.id)).toEqual(['y1']);
    expect(n.yours.taskTotal).toBe(2);
    expect(n.yours.allTasksLink).toBe('/project/nswma?tab=schedule&schedule=s-n&qf=my_tasks');
  });

  it('shows the next task when nothing of yours is due soon', () => {
    const later = buildProjectBriefings({ ...withMine, mine: { tasks: [withMine.mine.tasks[2]], raidItems: [] } },
      { showApprovals: true, formatDate: (d: string) => d, today: TODAY });
    const y = later.find(p => p.id === 'nswma')!.yours;
    expect(y.tasks).toEqual([]);
    expect(y.nextUp).toEqual({ label: 'UAT with NSWMA', date: '2027-02-17', link: '/project/nswma?tab=schedule&schedule=s-n&task=y2' });
  });

  it('lists the RAID items you own with what they need', () => {
    const tags = get('nswma').yours.raid.map(r => r.tag);
    expect(tags).toEqual(['Awaiting decision', 'Due 2026-10-16']);
  });

  it('adds stalled tasks and agent proposals to the team list', () => {
    const loans = get('loans');
    expect(loans.sections.find(s => s.key === 'stalled')!.items[0]).toMatchObject({ id: 'st1', resourceName: 'DBJ / JV', extra: 'In progress 20 days, 0% done' });
    expect(loans.sections.find(s => s.key === 'approvals')!.items[0]).toMatchObject({ label: 'Reschedule SSD Part-1', tag: 'Agent proposal' });
  });

  it('does not list a late task again as stalled', () => {
    const dup = buildProjectBriefings({ ...withMine, stalledTasks: [...withMine.stalledTasks,
      { id: 'm2', name: 'SSD Part-1', projectId: 'lms', projectName: 'DBJ-LMS', projectCode: 'PRJ-012', scheduleId: 's-m', daysSinceStart: 30 }] },
      { showApprovals: true, formatDate: (d: string) => d, today: TODAY });
    expect(dup.find(p => p.id === 'lms')!.sections.find(s => s.key === 'stalled')!.count).toBe(0);
  });

  it('judges a project you only view by your own work, not the team list you cannot see', () => {
    const lms = get('lms');
    expect(lms.canManage).toBe(false);
    expect(lms.level).toBe('green');
    expect(lms.quiet).toBe(true);
    expect(statusSummary(lms)).toBe('');
  });

  it('counts your items in the summary', () => {
    expect(statusSummary(get('nswma'))).toContain('3 yours');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards for the 2026-10-04 audit's speed items: work that went one row / one project at a time,
 * a big library loaded with every Schedule tab, missing indexes.
 */
const root = join(__dirname, '..', '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf-8');
const server = (...p: string[]) => read('src', 'server', ...p);
const client = (...p: string[]) => read('src', 'client', 'src', ...p);

describe('speed guards', () => {
  it('moving a task writes its successors in one go', () => {
    const svc = server('services', 'ScheduleService.ts');
    const cascade = svc.slice(svc.indexOf('async cascadeReschedule('), svc.indexOf('What-If Scenarios'));
    expect(cascade).toMatch(/taskRepository\.updateDatesMany\(writes\)/);
    expect(cascade).toMatch(/taskRepository\.logActivities\(/);
    expect(cascade).not.toMatch(/taskRepository\.updateDates\(|this\.logActivity\(/);
  });

  it('task costs are written 100 at a time, not one UPDATE per task', () => {
    const svc = server('services', 'TaskBudgetService.ts');
    expect(svc).toMatch(/budget_allocated = CASE id/);
    expect(svc).not.toMatch(/'UPDATE tasks SET budget_allocated = \?, updated_at = updated_at WHERE id = \?'/);
  });

  it('the Team Planner finds the projects you manage in one query', () => {
    const svc = server('services', 'TeamPlannerService.ts');
    const managed = svc.slice(svc.indexOf('async managedProjectIds('), svc.indexOf('async managedProjectIds(') + 1600);
    expect(managed).not.toMatch(/await checkProjectRoleFor\(/);
    expect(managed).toMatch(/projectRepository\.findManagedIds\(/);
  });

  it('the Friday review runs a few projects at a time', () => {
    expect(server('services', 'scheduling', 'pmWeeklyReviewJob.ts')).toMatch(/i \+= REVIEWS_AT_ONCE/);
  });

  it('the spreadsheet library is loaded only when an import is opened', () => {
    const ws = client('pages', 'ProjectDetailPage', 'schedule-tab', 'ScheduleWorkspace.tsx');
    expect(ws).toMatch(/const ImportModal = lazy\(/);
    expect(client('pages', 'ProjectDetailPage', 'RAIDTab.tsx')).toMatch(/const RAIDImportModal = lazy\(/);
    const picker = client('components', 'templates', 'TemplatePicker.tsx');
    expect(picker).not.toMatch(/^import \* as XLSX from 'xlsx';/m);
    expect(picker).toMatch(/await import\('xlsx'\)/);
  });

  it('the missing indexes are added', () => {
    const sql = server('database', 'tenant-migrations', 'T080_speed_indexes.sql');
    expect(sql).toMatch(/ON time_entries \(schedule_id\)/);
    expect(sql).toMatch(/ON notifications \(user_id, created_at\)/);
    expect(sql).toMatch(/ON tasks \(start_date\)/);
  });
});

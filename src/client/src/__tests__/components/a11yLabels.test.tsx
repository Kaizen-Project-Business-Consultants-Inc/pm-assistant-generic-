// @vitest-environment happy-dom
/**
 * Accessibility audit part 6 (2026-10-05): every control below had no accessible name, so a
 * screen reader said only "edit text" / "checkbox" / "combo box". Each test finds the control
 * the way assistive technology does — by role and name, or by its label.
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';

const RISK = { id: 'k1', recordId: 'R-001', type: 'risk', title: 'Vendor delay', status: 'open', severity: 'high', probability: 3, impact: 4, source: 'manual' };
const RESOURCE = { id: 'p1', name: 'Pat Manager', role: 'PM', email: 'pat@example.com', capacityHoursPerWeek: 40, skills: [], isActive: true };

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, {
    get: (_t, name: string) => vi.fn(async () => {
      if (name === 'getRiskItems') return { data: [RISK] };
      if (name === 'getRaidReview') return { review: null };
      if (name === 'getResources') return { resources: [RESOURCE] };
      return {};
    }),
  }),
}));
vi.mock('../../hooks/useProjectRole', () => ({
  useProjectRole: () => ({ canEdit: true, role: 'pm', isLoading: false }),
}));

// The Table's assignee picker loads people; not needed here
vi.mock('../../components/schedule/ResourcePickerDropdown', () => ({
  ResourcePickerDropdown: () => null,
}));

import { cellEditLabel } from '../../components/schedule/cellEditLabel';
import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { TableView } from '../../components/schedule/TableView';
import { TableBulkActionBar } from '../../components/schedule/table/TableBulkActionBar';
import { useColumnState } from '../../hooks/useColumnState';
import { FilterBarPM } from '../../components/pm/FilterBarPM';
import { SetupChecklist } from '../../components/project/SetupChecklist';
import { RAIDTab } from '../../pages/ProjectDetailPage/RAIDTab';
import { ProfileTab } from '../../pages/settings/ProfileTab';
import { useAuthStore } from '../../stores/authStore';
import { ResourceManagementPage } from '../../pages/ResourceManagementPage';
import { ResourcesTab } from '../../components/project/ResourcesTab';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Plan', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10 },
  { id: 'b', name: 'Build', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20 },
];

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

describe('cellEditLabel', () => {
  it('names the field and the task', () => {
    expect(cellEditLabel('startDate', 'Design review')).toBe('Start date for Design review');
    expect(cellEditLabel('estimatedDurationHours', 'Build')).toBe('Work (hours) for Build');
  });
  it('falls back for an unnamed task and an unknown field', () => {
    expect(cellEditLabel('name', '  ')).toBe('Task name for untitled task');
    expect(cellEditLabel('wbs', 'X')).toBe('wbs for X');
  });
});

describe('Schedule grid inline editors', () => {
  it('Gantt grid: the name editor is "Task name for <task>"', async () => {
    const { container } = wrap(
      <GanttChart tasks={TASKS} scheduleName="S" scheduleId="s-a11y-g" activeTaskId="a"
        onTaskClick={vi.fn()} onTaskSelect={vi.fn()} onTaskUpdate={vi.fn()} />,
    );
    await flush();
    const row = container.querySelector('[data-task-id="a"]')!;
    fireEvent.click(row.querySelectorAll(':scope > div')[1] as HTMLElement);
    await flush();
    expect(screen.getByRole('textbox', { name: 'Task name for Plan' })).toBeTruthy();
  });

  function Table() {
    const columnState = useColumnState('s-a11y-t');
    return <TableView tasks={TASKS} scheduleId="s-a11y-t" onTaskClick={() => {}} columnState={columnState} activeTaskId="b"
      onTaskUpdate={() => {}} onBulkUpdate={async () => {}} />;
  }

  it('Table: the row tick-boxes and the name editor are named', async () => {
    wrap(<Table />);
    await flush();
    expect(screen.getByRole('checkbox', { name: 'Select all tasks' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select Plan' })).toBeTruthy();
    fireEvent.click(screen.getByText('Build').closest('td')!);
    await flush();
    expect(screen.getByRole('textbox', { name: 'Task name for Build' })).toBeTruthy();
  });

  it('Table bulk bar: its dropdowns and box are named', () => {
    render(<TableBulkActionBar selectedCount={2} bulkStatus="" bulkPriority="" bulkAssignee="" bulkMessage=""
      bulkLoading={false} onBulkStatusChange={vi.fn()} onBulkPriorityChange={vi.fn()} onBulkAssigneeChange={vi.fn()}
      onApplyBulkUpdate={vi.fn()} onBulkDelete={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Status for selected tasks' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Priority for selected tasks' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Assign selected tasks to' })).toBeTruthy();
  });
});

describe('Risks & Issues', () => {
  it('row tick-boxes, filters and bulk dropdowns are named', async () => {
    wrap(<RAIDTab projectId="p-a11y" projectName="P" />);
    const box = await screen.findByRole('checkbox', { name: 'Select Vendor delay' });
    expect(screen.getByRole('checkbox', { name: 'Select all items' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByRole('combobox', { name: 'Filter by type' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by severity' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search RAID items' })).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Set status for selected items' })).toBeTruthy());
  });
});

describe('Resources', () => {
  it('Resources page: row tick-boxes are named', async () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'pat', email: 'pat@example.com', fullName: 'Pat', role: 'pmo' } as never });
    wrap(<ResourceManagementPage />);
    expect(await screen.findByRole('checkbox', { name: 'Select Pat Manager' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select all resources' })).toBeTruthy();
  });

  it('project Resources tab: row tick-boxes are named', async () => {
    wrap(<ResourcesTab projectId="p-a11y" />);
    expect(await screen.findByRole('checkbox', { name: 'Select Pat Manager' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select all resources' })).toBeTruthy();
  });
});

describe('Projects page filters', () => {
  it('search box and both dropdowns are named', () => {
    render(<FilterBarPM search="" onSearchChange={vi.fn()} healthFilter="all" onHealthChange={vi.fn()}
      statusFilter="all" onStatusChange={vi.fn()} onClear={vi.fn()} hasActiveFilters={false} />);
    expect(screen.getByRole('textbox', { name: 'Search projects or clients' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by health' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy();
  });
});

describe('Project Overview setup checklist', () => {
  it('the close (X) button has a name and still hides the checklist', async () => {
    wrap(<SetupChecklist project={{ id: 'p-a11y', progress: 0 }} onNavigate={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Hide setup checklist' });
    fireEvent.click(close);
    expect(screen.queryByText('Get Started')).toBeNull();
  });
});

describe('Settings profile', () => {
  it('every field, read-only ones included, is tied to its label', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'pat', email: 'pat@example.com', fullName: 'Pat', role: 'project_manager' } as never });
    wrap(<ProfileTab />);
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('pat');
    expect((screen.getByLabelText('Role') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByLabelText('Account Created')).toBeTruthy();
    expect(screen.getByLabelText('Full Name *')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Current Password')).toBeTruthy();
    expect(screen.getByLabelText('New Password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm New Password')).toBeTruthy();
  });
});

describe('Project page (source checks: the page needs the whole app to render)', () => {
  const src = readFileSync(join(__dirname, '../../pages/ProjectDetailPage.tsx'), 'utf8');

  it('the status pill dropdown is named', () => {
    // The pill is its own component since audit 2 H9 (it no longer saves on an arrow key)
    expect(src).toMatch(/<ProjectStatusSelect\s+value=\{project\.status\}/);
    const select = readFileSync(join(__dirname, '../../components/project/ProjectStatusSelect.tsx'), 'utf8');
    expect(select).toMatch(/<select\s+value=\{shown\}\s+aria-label="Project status"/);
  });

  it('the tablist holds only the tabs; the More menu sits outside it', () => {
    const start = src.indexOf('role="tablist"');
    const more = src.indexOf('<TabOverflow', start);
    const between = src.slice(start, more);
    expect(start).toBeGreaterThan(-1);
    // the tablist's own <div> closes before the More menu starts
    expect(between.trimEnd().endsWith('</div>')).toBe(true);
    expect(between).not.toMatch(/<TabOverflow/);
    expect(src).toMatch(/aria-haspopup="true"\s+aria-expanded=\{open\}/);
  });
});

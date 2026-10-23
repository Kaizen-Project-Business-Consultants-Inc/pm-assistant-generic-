import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActionOutcome, summarizeActions } from '../../components/ai/ActionOutcome';
import { voiceErrorMessage } from '../../hooks/useVoice';
import { deadlineTasks } from '../../utils/deadlineDigest';

/** Round 5 (approved mock https://claude.ai/artifact/PP6uLZfCCZBPRVrWqwMXNC): U57, U56, U55 */

afterEach(() => cleanup());

// What Mjuzi sent back on 2026-10-20 for "make all overdue tasks complete": four refused guesses,
// four look-ups, then four updates
const UAT_ACTIONS = [
  ...[1, 2, 3, 4].map(() => ({ success: false, toolName: 'update_task', summary: "I couldn't tell which project this change is for, so I didn't make it.", error: 'Not allowed' })),
  ...[1, 2, 3, 4].map(i => ({ success: true, toolName: 'list_tasks', summary: `Found 1 tasks in schedule "DBJ-LMS" matching name contains "T${i}" (of 35)`, data: [] })),
  ...['SSD Part-1 Review & Sign-Off', 'SSD Part-2 Review & Sign-Off', 'Data Acquisition', 'Daily & Regulatory Reports'].map((name, i) => ({
    success: true, toolName: 'update_task', summary: `Updated task "${name}" (5b53e832-a68b-45d8-969b-5c5f3396fff${i}): status: completed, progressPercentage: 100`,
    data: { taskId: `t${i}`, name, status: 'completed', scheduleId: 's1', projectId: 'p1' },
  })),
];

describe('U57 — Mjuzi says what it did', () => {
  it('the UAT reply becomes one line: Marked complete (4), with the four names linking to the schedule', () => {
    render(<MemoryRouter><ActionOutcome actions={UAT_ACTIONS} /></MemoryRouter>);
    expect(screen.getByText('Marked complete (4)')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'SSD Part-1 Review & Sign-Off' });
    expect(link).toHaveAttribute('href', '/project/p1?tab=schedule&schedule=s1&task=t0');
    expect(screen.queryByText(/couldn't tell which project/)).toBeNull(); // guesses retried later
    expect(screen.queryByText(/Found 1 tasks/)).toBeNull(); // look-ups are steps
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no ids
    expect(document.body.textContent).not.toMatch(/progressPercentage/);
  });

  it('a change that really failed says so, without ids', () => {
    const o = summarizeActions([{ success: false, toolName: 'update_task', summary: "Only the project's Manager or Owner can change it, so I didn't make that change." }]);
    expect(o.failures).toEqual(["Only the project's Manager or Owner can change it, so I didn't make that change."]);
    expect(o.groups).toEqual([]);
  });

  it('a stored reply (no data, only the kept items) reads the same', () => {
    const o = summarizeActions([{ success: true, toolName: 'update_tasks', summary: 'Updated 2 task(s) (status: completed): "A", "B"', refs: [{ id: 'a', name: 'A', projectId: 'p1' }, { id: 'b', name: 'B', projectId: 'p1' }] } as never]);
    expect(o.groups).toEqual([{ verb: 'Marked complete', items: [{ id: 'a', name: 'A', projectId: 'p1' }, { id: 'b', name: 'B', projectId: 'p1' }], plain: [] }]);
  });

  it('a split names every part (M1), so the chat links each one', () => {
    const pieces = [{ id: 'a', name: 'Review', row: 4 }, { id: 'b', name: 'Revisions', row: 5 }];
    const o = summarizeActions([{ success: true, toolName: 'split_task', summary: 'Split "Gate 1" into 2 tasks', data: { taskId: 'a', scheduleId: 's1', projectId: 'p1', pieces } }]);
    expect(o.groups).toEqual([{ verb: 'Split into', items: [
      { id: 'a', name: 'Review', scheduleId: 's1', projectId: 'p1' },
      { id: 'b', name: 'Revisions', scheduleId: 's1', projectId: 'p1' },
    ], plain: [] }]);
  });

  it('a reply that only looked things up shows no action box', () => {
    const { container } = render(<MemoryRouter><ActionOutcome actions={[{ success: true, toolName: 'get_overdue_tasks', summary: '4 overdue', data: [] }]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('U56 — the mic says why it failed', () => {
  it('blocked, no microphone, nothing heard, the browser service failing; our own stop says nothing', () => {
    expect(voiceErrorMessage('not-allowed')).toMatch(/blocked.*padlock/);
    expect(voiceErrorMessage('service-not-allowed')).toMatch(/blocked/);
    expect(voiceErrorMessage('audio-capture')).toMatch(/No microphone/);
    expect(voiceErrorMessage('no-speech')).toMatch(/didn't hear/);
    expect(voiceErrorMessage('network')).toMatch(/Try Chrome/);
    expect(voiceErrorMessage(undefined)).toMatch(/Try Chrome/);
    expect(voiceErrorMessage('aborted')).toBeNull();
  });
});

describe('U55 — the schedule marks what the email named', () => {
  const today = new Date(2026, 9, 21); // 21 Oct 2026, local
  const tasks = [
    { id: 'late', status: 'in_progress', dueDate: '2026-10-17', assignedTo: 'r-me' },
    { id: 'late-by-finish', status: 'pending', endDate: '2026-10-20', assignedTo: 'r-other' },
    { id: 'today', status: 'pending', endDate: '2026-10-21', assignedTo: 'r-me' },
    { id: 'in6', status: 'pending', endDate: '2026-10-27', assignedTo: 'r-me' },
    { id: 'in7', status: 'pending', endDate: '2026-10-28', assignedTo: 'r-me' },
    { id: 'done', status: 'completed', endDate: '2026-10-10', assignedTo: 'r-me' },
    { id: 'phase', status: 'pending', endDate: '2026-10-10', isSummary: true },
    { id: 'ancient', status: 'pending', endDate: '2026-07-01', assignedTo: 'r-me' }, // more than 60 days late
  ];

  it('the whole plan (the PM): overdue, and due today plus the next six days', () => {
    expect(deadlineTasks(tasks, today)).toEqual({ overdue: ['late', 'late-by-finish'], soon: ['today', 'in6'] });
  });

  it("the person's own (mine): only tasks given to their resource", () => {
    expect(deadlineTasks(tasks, today, new Set(['r-me']))).toEqual({ overdue: ['late'], soon: ['today', 'in6'] });
  });
});

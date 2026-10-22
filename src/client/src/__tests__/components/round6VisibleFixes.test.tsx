import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Round 6 (approved mock https://claude.ai/artifact/D94EMU7a1MfJDvcQPMjeGk): U78, U74, U64, U65, U69 */

const prefs = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../services/api', () => ({
  apiService: {
    getViewPreferences: vi.fn(async () => ({ preferences: prefs.value })),
    updateViewPreferences: vi.fn(async () => ({})),
  },
}));
vi.mock('../../hooks/useCanOpenPage', () => ({ useCanOpenPage: () => () => true }));

import { InfoTip } from '../../components/ui/InfoTip';
import { ScenarioResultView, type ScenarioResult } from '../../components/scenarios/ScenarioResultView';
import { ScenarioSliderPanel } from '../../components/scenarios/ScenarioSliderPanel';
import { OverbookedToggle } from '../../components/schedule/OverbookedToggle';
import { useColumnState } from '../../hooks/useColumnState';

afterEach(() => cleanup());

// The UAT run that printed raw JSON (2026-10-21, DBJ-LMS, budget +50% on a project with no budget)
const UAT: ScenarioResult = {
  scheduleImpact: { originalDays: 240, projectedDays: 216, changePct: -10, explanation: 'Increased budget enables parallel workstreams.' },
  budgetImpact: { originalBudget: 0, projectedBudget: 0, changePct: 50, explanation: 'BAC=0.' },
  resourceImpact: { currentWorkers: 1, projectedWorkers: 2, explanation: '+1 integration specialist.' },
  riskImpact: { currentRiskScore: 25, projectedRiskScore: 18, newRisks: ['Budget burn rate monitoring required'], explanation: 'Risk improves.' },
  affectedTasks: [{ taskName: 'Core LMS Configuration', impact: 'Accelerated by 15%', severity: 'high' }],
  recommendations: ['Hire 1 System Integration Specialist.'],
  confidence: 0.75,
};

describe('U78 — What-If results read as cards, not code', () => {
  it('the UAT result: before → after, no JSON, severity as a word, and "No budget set" instead of $0 → $0', () => {
    render(<ScenarioResultView result={UAT} aiPowered />);
    expect(screen.getByText('240 → 216 days')).toBeInTheDocument();
    expect(screen.getByText('25 → 18')).toBeInTheDocument();
    expect(screen.getByText('1 → 2')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('No budget set')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[{}"]|originalDays|taskName/);
    expect(screen.queryByText('Estimate')).toBeNull(); // the AI answered
  });

  it('the rules-only answer says "Estimate" and how each number was worked out', () => {
    render(<ScenarioResultView result={{ ...UAT, budgetImpact: { ...UAT.budgetImpact, originalBudget: 1000, projectedBudget: 1500 } }} aiPowered={false} />);
    expect(screen.getAllByText('Estimate').length).toBe(4);
    expect(screen.getByText(/Not a re-plan of the Gantt/)).toBeInTheDocument();
    expect(screen.getByText(/does not move dates or cost/)).toBeInTheDocument();
  });
});

describe('U74 — the sliders explain themselves; Workers is now Resources', () => {
  const zero = { budgetChangePct: 0, daysExtension: 0, workerChange: 0, scopeChangePct: 0 };
  it('Resources +/- with its help; no "Workers" anywhere', () => {
    render(<MemoryRouter><ScenarioSliderPanel values={zero} onChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText('Resources +/-')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Workers/);
    fireEvent.click(screen.getByRole('button', { name: 'About Resources +/-' }));
    expect(screen.getByRole('note')).toHaveTextContent(/does not move dates or cost yet/);
  });

  it('no budget: the Budget slider is off and says why', () => {
    render(<MemoryRouter><ScenarioSliderPanel values={zero} onChange={() => {}} budgetSet={false} /></MemoryRouter>);
    expect(screen.getByLabelText('Budget %')).toBeDisabled();
    expect(screen.getByLabelText('Days +/-')).not.toBeDisabled();
    expect(screen.getByText(/No budget set/)).toBeInTheDocument();
  });
});

describe('U64 — the ⓘ help box', () => {
  const tip = () => render(<MemoryRouter><InfoTip title="Working calendar" guide="/help/guide#x">Your project calendar.</InfoTip></MemoryRouter>);

  it('opens on click (and stays), closes on Escape; links to the guide', () => {
    tip();
    const button = screen.getByRole('button', { name: 'About Working calendar' });
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseLeave(button.parentElement!);
    expect(screen.getByRole('note')).toHaveTextContent('Your project calendar.');
    expect(screen.getByRole('link', { name: /More in the user guide/ })).toHaveAttribute('href', '/help/guide#x');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('Escape on the guide link puts keyboard focus back on the ⓘ', () => {
    tip();
    fireEvent.click(screen.getByRole('button', { name: 'About Working calendar' }));
    const link = screen.getByRole('link', { name: /More in the user guide/ });
    link.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: 'About Working calendar' })).toHaveFocus();
  });

  it('opens on hover and closes when the mouse leaves', () => {
    tip();
    const wrap = screen.getByRole('button', { name: 'About Working calendar' }).parentElement!;
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole('note')).toBeInTheDocument();
    fireEvent.mouseLeave(wrap);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('U65 — Overbooked people', () => {
  it('named for what it finds; with nobody assigned it says there is nothing to check', () => {
    render(<OverbookedToggle on onToggle={() => {}} count={0} anyoneAssigned={false} />);
    expect(screen.getByRole('button', { name: /Overbooked people/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/No one is assigned to tasks yet/)).toBeInTheDocument();
    expect(screen.queryByText(/No one over 100%/)).toBeNull();
  });

  it('with people assigned: the count, and the Workload Heatmap link', () => {
    render(<OverbookedToggle on onToggle={() => {}} count={2} anyoneAssigned />);
    expect(screen.getByRole('button', { name: /Overbooked people/ })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: 'See Workload Heatmap' })).toBeInTheDocument();
  });
});

describe('U69 — Successors and Total slack show on plans whose columns were already saved', () => {
  beforeEach(() => { localStorage.clear(); prefs.value = null; });

  it('a plan saved before: both are switched on once', () => {
    localStorage.setItem('tableview-cols:s1', JSON.stringify(['rowNum', 'name', 'startDate']));
    const { result } = renderHook(() => useColumnState('s1'));
    expect(result.current.visibleKeys.has('successor')).toBe(true);
    expect(result.current.visibleKeys.has('totalFloat')).toBe(true);
    expect(result.current.cpmNeeded).toBe(true); // slack needs the critical path
  });

  it('turned off after that, they stay off', () => {
    localStorage.setItem('tableview-cols:s1', JSON.stringify(['rowNum', 'name']));
    localStorage.setItem('tableview-cols-added:s1', JSON.stringify(['successor', 'totalFloat']));
    const { result } = renderHook(() => useColumnState('s1'));
    expect(result.current.visibleKeys.has('successor')).toBe(false);
    expect(result.current.visibleKeys.has('totalFloat')).toBe(false);
  });

  it('the saved state from the server is treated the same way', async () => {
    prefs.value = { columnStates: { s1: { visibleKeys: ['rowNum', 'name'] } } };
    const { result } = renderHook(() => useColumnState('s1'));
    await waitFor(() => expect(result.current.visibleKeys.has('totalFloat')).toBe(true));
    prefs.value = { columnStates: { s2: { visibleKeys: ['rowNum', 'name'], addedDefaults: ['successor', 'totalFloat'] } } };
    const second = renderHook(() => useColumnState('s2'));
    await waitFor(() => expect(second.result.current.visibleKeys.has('name')).toBe(true));
    expect(second.result.current.visibleKeys.has('totalFloat')).toBe(false);
  });
});

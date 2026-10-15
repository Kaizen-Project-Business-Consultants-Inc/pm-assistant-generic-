import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TemplateCustomizeForm } from '../../components/templates/TemplateCustomizeForm';

const raidItems = [
  { type: 'risk', title: 'Scope grows without a change decision', description: 'Log every change.' },
  { type: 'assumption', title: 'The budget is approved for the whole project' },
  { type: 'action', title: 'Agree how progress is reported' },
];

const show = (onSubmit = vi.fn()) => {
  render(
    <TemplateCustomizeForm templateName="Generic" estimatedDurationDays={30} phaseCount={1} taskCount={1}
      tasks={[]} raidItems={raidItems} onBack={() => {}} onSubmit={onSubmit} isSubmitting={false} />,
  );
  return onSubmit;
};

/** U10: "Starter RAID: review" — all ticked; untick any that don't apply */
describe('Starter RAID review when creating from a template', () => {
  afterEach(cleanup);

  it('lists the starter items, all ticked', () => {
    show();
    expect(screen.getByText(/Starter RAID: review \(3\/3 kept\)/)).toBeTruthy();
    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).checked).toBe(true);
  });

  it('sends nothing extra when all are kept, and the kept positions when one is unticked', () => {
    const onSubmit = show();
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
    expect(onSubmit.mock.calls[0][0].selectedRaidIndexes).toBeUndefined();
    fireEvent.click(screen.getByRole('checkbox', { name: /The budget is approved/ }));
    expect(screen.getByText(/2\/3 kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
    expect(onSubmit.mock.calls[1][0].selectedRaidIndexes).toEqual([0, 2]);
  });
});

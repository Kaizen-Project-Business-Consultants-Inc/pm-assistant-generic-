import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ updateProject: vi.fn(async () => ({})) }));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../hooks/useWebSocket', () => ({ sendWsMessage: vi.fn(), useConnectionState: () => 'connected' }));

import { ProjectBriefCard } from '../../components/project/ProjectBriefCard';

const show = (canEdit: boolean) => render(
  <QueryClientProvider client={new QueryClient()}>
    <ProjectBriefCard projectId="p1" description="" canEdit={canEdit} cardClass="" />
  </QueryClientProvider>,
);

/** U16: an empty brief offers a starter outline to the PM, not a blank box */
describe('Project brief — empty', () => {
  afterEach(cleanup);

  it('the PM can start from an outline with the usual headings', () => {
    show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start from an outline' }));
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    for (const h of ['## Purpose', '## Objectives and success criteria', '## In scope', '## Out of scope', '## Key stakeholders', '## Key constraints']) {
      expect(box.value).toContain(h);
    }
  });

  it('clicking away from an outline nobody filled in saves nothing, and the brief stays empty', () => {
    api.updateProject.mockClear();
    show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start from an outline' }));
    fireEvent.blur(screen.getByRole('textbox'));
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start from an outline' })).toBeTruthy();
  });

  it('once the PM writes in it, it is saved', async () => {
    api.updateProject.mockClear();
    show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start from an outline' }));
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: box.value.replace('Why this project exists and the problem it solves.', 'Replace the loan system.') } });
    fireEvent.blur(box);
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ description: expect.stringContaining('Replace the loan system.') })));
  });

  it('or write their own from a blank page', () => {
    show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Write my own' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('anyone else just reads that there is none yet', () => {
    show(false);
    expect(screen.getByText('No project brief yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start from an outline' })).toBeNull();
  });
});

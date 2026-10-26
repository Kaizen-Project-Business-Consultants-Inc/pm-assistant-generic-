import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Under a reply to a typed command (Mjuzi): which path answered, the Confirm button of a delete, and Undo.
 */
const api = vi.hoisted(() => ({ undoScheduleChange: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { TypedCommandReply, ClaudeBadge, typedReplyOf } from '../../components/ai/TypedCommandReply';

const marker = (success: boolean, data: Record<string, unknown>) => ({ success, toolName: 'typed_command', summary: 'x', data: { typed: true, ...data } });

function show(reply: NonNullable<ReturnType<typeof typedReplyOf>>, onConfirmDelete = vi.fn(), busy = false) {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><TypedCommandReply reply={reply} onConfirmDelete={onConfirmDelete} busy={busy} /></QueryClientProvider>);
  return onConfirmDelete;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('typedReplyOf', () => {
  it('finds the marker among the tool results, and is null for a reply Claude gave', () => {
    expect(typedReplyOf([{ success: true, toolName: 'update_task', summary: '' }, marker(true, { undo: { scheduleId: 's', changeId: 'c', projectId: 'p' } })])?.success).toBe(true);
    expect(typedReplyOf([{ success: true, toolName: 'update_task', summary: '' }])).toBeNull();
    expect(typedReplyOf(undefined)).toBeNull();
  });
});

describe('TypedCommandReply', () => {
  it('a delete waits for Confirm: the button sends that task, and Cancel says nothing was deleted', () => {
    const onConfirm = show(typedReplyOf([marker(true, { pending: { taskId: 't1' } })])!);
    expect(screen.getByText('Waiting for your OK · no AI cost')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onConfirm).toHaveBeenCalledWith('t1');
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
    expect(screen.getByText('Done by the app · no AI cost')).toBeInTheDocument();
  });

  it('Cancel leaves the task alone', () => {
    const onConfirm = show(typedReplyOf([marker(true, { pending: { taskId: 't1' } })])!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Cancelled. Nothing was deleted.')).toBeInTheDocument();
  });

  it('while a reply is on its way Confirm is off, so it cannot be pressed twice', () => {
    show(typedReplyOf([marker(true, { pending: { taskId: 't1' } })])!, vi.fn(), true);
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeDisabled();
  });

  it('Undo asks History to undo that change, then says Undone', async () => {
    api.undoScheduleChange.mockResolvedValue({});
    show(typedReplyOf([marker(true, { undo: { scheduleId: 's1', changeId: 'c1', projectId: 'p1' } })])!);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByText('Undone.')).toBeInTheDocument());
    expect(api.undoScheduleChange).toHaveBeenCalledWith('s1', 'c1');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('an Undo the server refuses shows why and can be tried again', async () => {
    api.undoScheduleChange.mockRejectedValue({ response: { data: { message: 'Only the most recent change can be undone.' } } });
    show(typedReplyOf([marker(true, { undo: { scheduleId: 's1', changeId: 'c1', projectId: 'p1' } })])!);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText(/Only the most recent change can be undone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('a command that could not run says nothing changed and offers no Undo', () => {
    show(typedReplyOf([marker(false, {})])!);
    expect(screen.getByText('Nothing changed · no AI cost')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a reply from Claude is labelled as using credits', () => {
    render(<ClaudeBadge />);
    expect(screen.getByText('Asked Claude · uses credits')).toBeInTheDocument();
  });
});

/**
 * Project documents (audit 2, M1, 2026-10-11): AI waits for a click. Uploading only stores a
 * document; the project's Manager/Owner clicks "Analyse with AI" in its panel. Others never see
 * the button (hide, don't disable).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const role = vi.hoisted(() => ({ canEdit: true, aiOnPlan: true }));
vi.mock('../../hooks/useProjectRole', () => ({ useProjectRole: () => ({ canEdit: role.canEdit }) }));
const api = vi.hoisted(() => ({
  getProjectDocuments: vi.fn(async () => ({ canAnalyse: role.aiOnPlan, documents: [{ id: 'd1', projectId: 'p1', originalFilename: 'charter.pdf', processingStatus: 'pending', fileSize: 2048, tags: [] }] })),
  getProjectDocumentFolders: vi.fn(async () => ({ folders: [] })),
  searchProjectDocuments: vi.fn(async () => ({ results: [] })),
  getProjectDocument: vi.fn(async () => ({ document: { id: 'd1', projectId: 'p1', originalFilename: 'charter.pdf', processingStatus: 'pending', fileSize: 2048, createdAt: '2026-10-11', tags: [] }, entityLinks: [] })),
  listStorageConnectors: vi.fn(async () => ({ connectors: [] })),
  reprocessProjectDocument: vi.fn(async () => ({ success: true })),
  uploadProjectDocument: vi.fn(async () => ({ document: { id: 'd2' } })),
  getDocumentDownloadUrl: vi.fn(() => '/dl'),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { DocumentsTab, AnalyseWithAI } from '../../pages/ProjectDetailPage/DocumentsTab';

afterEach(() => { cleanup(); vi.clearAllMocks(); role.canEdit = true; role.aiOnPlan = true; });

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DocumentsTab projectId="p1" /></QueryClientProvider>);
}

describe('Documents — Analyse with AI', () => {
  it('the upload hint says documents are stored as they are, not analysed', async () => {
    renderTab();
    expect(await screen.findByText(/Documents are stored as they are/)).toBeTruthy();
  });

  it("the PM opens a document, sees it isn't analysed, and the click starts the analysis", async () => {
    renderTab();
    fireEvent.click(await screen.findByText('charter.pdf'));
    const button = await screen.findByRole('button', { name: 'Analyse with AI' });
    expect(screen.getByText(/Not analysed yet/)).toBeTruthy();
    expect(api.reprocessProjectDocument).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.reprocessProjectDocument).toHaveBeenCalledWith('p1', 'd1'));
  });

  it('someone who cannot change the project never sees the button', async () => {
    role.canEdit = false;
    renderTab();
    fireEvent.click(await screen.findByText('charter.pdf'));
    await screen.findByText('No description');
    expect(screen.queryByRole('button', { name: /Analyse/ })).toBeNull();
  });

  it('a plan without AI: the button is hidden for the PM too (hide, not disable)', async () => {
    role.aiOnPlan = false;
    renderTab();
    fireEvent.click(await screen.findByText('charter.pdf'));
    await screen.findByText('No description');
    expect(screen.queryByRole('button', { name: /Analyse/ })).toBeNull();
  });

  it('labels: again after a result, busy while analysing, and a refusal is shown in words', () => {
    const { rerender } = render(<AnalyseWithAI status="completed" onAnalyse={() => {}} isStarting={false} />);
    expect(screen.getByRole('button', { name: 'Analyse again with AI' })).toBeTruthy();
    rerender(<AnalyseWithAI status="processing" onAnalyse={() => {}} isStarting={false} />);
    expect((screen.getByRole('button', { name: 'Analysing…' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<AnalyseWithAI status="pending" onAnalyse={() => {}} isStarting={false} error="This is part of Kovarti's paid plans." />);
    expect(screen.getByRole('alert').textContent).toMatch(/paid plans/);
  });
});

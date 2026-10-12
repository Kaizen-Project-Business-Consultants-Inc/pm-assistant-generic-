import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Document analysis state (audit 2 review, 2026-10-11):
 *  - the claim is one conditional UPDATE, so two clicks never both pay for the AI, and a claim
 *    stuck in "processing" for over 10 minutes may be taken over;
 *  - a stale "processing" row reads as failed (so the page stops polling and offers Analyse again);
 *  - the polled list never carries the documents' whole text;
 *  - a re-synced (changed) file loses its earlier analysis and links.
 */
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { projectDocumentRepository, STALE_PROCESSING_MINUTES } from '../../database/ProjectDocumentRepository';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1', project_id: 'p1', filename: 'f', original_filename: 'f.pdf', content_type: 'application/pdf', file_size: 1,
  processing_status: 'processing', processing_stale: 0, error_message: null, created_at: 'x', updated_at: 'x', ...over,
});

describe('project document analysis state', () => {
  beforeEach(() => db.query.mockReset());

  it('claim: one conditional UPDATE; true when it took the row, false when another click already has it', async () => {
    db.query.mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce({ affectedRows: 0 });
    expect(await projectDocumentRepository.claimForAnalysis('d1')).toBe(true);
    expect(await projectDocumentRepository.claimForAnalysis('d1')).toBe(false);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE project_documents SET processing_status = 'processing'/);
    expect(sql).toContain(`WHERE id = ? AND (processing_status <> 'processing' OR updated_at < NOW() - INTERVAL ${STALE_PROCESSING_MINUTES} MINUTE)`);
    expect(params).toEqual(['d1']);
    expect(STALE_PROCESSING_MINUTES).toBe(10);
  });

  it('taking over a stale claim restarts its clock, so the row reads as processing again and a further click loses', async () => {
    // processing → processing changes no value, and ON UPDATE CURRENT_TIMESTAMP only fires on a
    // change: the claim must set updated_at itself (review 2026-10-11)
    db.query.mockResolvedValueOnce({ affectedRows: 1 });
    await projectDocumentRepository.claimForAnalysis('d1');
    expect(db.query.mock.calls[0][0]).toMatch(/SET processing_status = 'processing', error_message = NULL, updated_at = NOW\(\)/);
  });

  it('a "processing" row older than 10 minutes reads as failed, with a plain message; a fresh one stays processing', async () => {
    db.query.mockResolvedValueOnce([row({ processing_stale: 1 })]);
    const stale = await projectDocumentRepository.findById('d1');
    expect(stale!.processingStatus).toBe('failed');
    expect(stale!.errorMessage).toMatch(/didn't finish/);
    expect(db.query.mock.calls[0][0]).toContain("updated_at < NOW() - INTERVAL 10 MINUTE) AS processing_stale");
    db.query.mockResolvedValueOnce([row()]);
    expect((await projectDocumentRepository.findById('d1'))!.processingStatus).toBe('processing');
  });

  it('the list (polled while analysing) leaves out extracted_text but still knows staleness', async () => {
    db.query.mockResolvedValueOnce([row({ processing_stale: 1 })]);
    const docs = await projectDocumentRepository.findByProject('p1');
    const sql: string = db.query.mock.calls[0][0];
    expect(sql).not.toMatch(/SELECT \*/);
    expect(sql).not.toContain('extracted_text');
    expect(docs[0].processingStatus).toBe('failed');
  });

  it("a changed file's re-sync clears its earlier analysis and entity links", async () => {
    db.query.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce([row({ processing_status: 'pending' })]);
    await projectDocumentRepository.upsertFromConnector({
      existingId: 'd1', projectId: 'p1', connectorId: 'c1', externalId: 'e1', externalPath: '/f.pdf', externalModifiedAt: null,
      externalEtag: 'v2', filename: '', originalFilename: 'f.pdf', contentType: 'application/pdf', fileSize: 1, uploadedBy: 'u1',
    });
    const update: string = db.query.mock.calls[0][0];
    expect(update).toMatch(/processing_status = 'pending'/);
    expect(update).toMatch(/extracted_text = NULL, ai_summary = NULL, ai_insights = NULL, tags = NULL/);
    expect(db.query.mock.calls[1]).toEqual(['DELETE FROM document_entity_links WHERE document_id = ?', ['d1']]);
  });
});

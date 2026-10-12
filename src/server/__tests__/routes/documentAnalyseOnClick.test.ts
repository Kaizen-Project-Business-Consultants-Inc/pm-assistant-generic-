import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

/**
 * AI only when a person asks (audit 2, M1, 2026-10-11). Uploading a project document used to call
 * the AI analysis straight away; now the upload only stores it, and the analysis runs when the
 * project's Manager/Owner clicks "Analyse with AI" (POST …/reprocess) on a plan with AI.
 */
const who = vi.hoisted(() => ({ feature: true }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'pm1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({
  requireFeature: () => vi.fn(async (_req: any, reply: any) => {
    if (!who.feature) return reply.status(403).send({ error: 'Upgrade required', message: "This is part of Kovarti's paid plans." });
  }),
  hasFeature: vi.fn(async () => who.feature),
}));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../config', () => ({ config: { UPLOAD_DIR: '/uploads' } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../utils/mimeValidator', () => ({ validateMimeType: () => ({ valid: true }) }));
vi.mock('fs', () => ({ default: { existsSync: () => true, mkdirSync: vi.fn(), createReadStream: vi.fn() } }));
vi.mock('fs/promises', () => ({ default: { writeFile: vi.fn(async () => {}), access: vi.fn(), unlink: vi.fn() } }));
const docs = vi.hoisted(() => ({
  row: { id: 'd1', projectId: 'p1', filename: 'f.txt', originalFilename: 'notes.txt', processingStatus: 'pending', connectorId: null as string | null, externalId: null as string | null },
}));
const repo = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'd1', projectId: 'p1', processingStatus: 'pending' })),
  findById: vi.fn(async () => docs.row),
  findByProject: vi.fn(async () => [docs.row]),
  updateStatus: vi.fn(async () => {}),
  claimForAnalysis: vi.fn(async () => true),
}));
vi.mock('../../database/ProjectDocumentRepository', () => ({ projectDocumentRepository: repo }));
vi.mock('../../database/DocumentEntityLinkRepository', () => ({ documentEntityLinkRepository: { deleteByDocument: vi.fn(async () => {}) } }));
const ai = vi.hoisted(() => ({ processDocument: vi.fn(async () => {}), getFilePath: vi.fn((p: string, f: string) => `/uploads/documents/${p}/${f}`) }));
vi.mock('../../services/DocumentIntelligenceService', () => ({ documentIntelligenceService: ai }));
const storage = vi.hoisted(() => ({ streamFileFromProvider: vi.fn(async () => Buffer.from('from the drive')) }));
vi.mock('../../services/StorageConnectorService', () => ({ storageConnectorService: storage }));

import { documentIntelligenceRoutes } from '../../routes/collaboration/documentIntelligence';

function uploadBody() {
  const boundary = '----kovarti';
  const payload = [`--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="notes.txt"', 'Content-Type: text/plain', '',
    'Meeting notes: we agreed the launch date.', `--${boundary}--`, ''].join('\r\n');
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('project documents: AI analysis waits for a click', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(multipart);
    await app.register(documentIntelligenceRoutes, { prefix: '/api/v1/projects' });
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    who.feature = true;
    docs.row = { ...docs.row, processingStatus: 'pending', connectorId: null, externalId: null };
  });

  it('upload stores the document and makes no AI call', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/documents/upload', ...uploadBody() });
    expect(res.statusCode).toBe(200);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(ai.processDocument).not.toHaveBeenCalled();
  });

  it('"Analyse with AI" runs the analysis on the stored file', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/documents/d1/reprocess' });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('Analysis started');
    expect(repo.claimForAnalysis).toHaveBeenCalledWith('d1');
    expect(ai.processDocument).toHaveBeenCalledWith('p1', 'd1', '/uploads/documents/p1/f.txt', 'pm1');
  });

  it('a document from connected storage is fetched from the drive for the analysis', async () => {
    docs.row = { ...docs.row, connectorId: 'c1', externalId: 'ext-9', filename: '' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/projects/p1/documents/d1/reprocess' })).statusCode).toBe(200);
    const source = (ai.processDocument.mock.calls[0] as unknown[])[2] as () => Promise<Buffer>;
    expect(typeof source).toBe('function');
    expect((await source()).toString()).toBe('from the drive');
    expect(storage.streamFileFromProvider).toHaveBeenCalledWith('c1', 'ext-9');
  });

  it('the document list tells the screen whether the plan has AI (so the button is hidden, not disabled)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p1/documents' })).json().canAnalyse).toBe(true);
    who.feature = false;
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p1/documents' })).json().canAnalyse).toBe(false);
  });

  it('a plan without AI is refused with a plain message, and nothing runs', async () => {
    who.feature = false;
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/documents/d1/reprocess' });
    expect(res.statusCode).toBe(403);
    expect(ai.processDocument).not.toHaveBeenCalled();
  });

  it('a second click while it is still analysing (the claim is lost) does not start another AI call', async () => {
    repo.claimForAnalysis.mockResolvedValueOnce(false);
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/documents/d1/reprocess' });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already being analysed/);
    expect(ai.processDocument).not.toHaveBeenCalled();
  });

  it('two clicks at once: only one AI call (the claim is atomic)', async () => {
    let claimed = false;
    repo.claimForAnalysis.mockImplementation(async () => { if (claimed) return false; claimed = true; return true; });
    const url = '/api/v1/projects/p1/documents/d1/reprocess';
    const [a, b] = await Promise.all([app.inject({ method: 'POST', url }), app.inject({ method: 'POST', url })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(ai.processDocument).toHaveBeenCalledTimes(1);
    repo.claimForAnalysis.mockImplementation(async () => true);
  });

  it('an analysis stuck for over 10 minutes shows as failed and can be analysed again', async () => {
    docs.row = { ...docs.row, processingStatus: 'failed' }; // the repository maps a stale claim to failed
    expect((await app.inject({ method: 'POST', url: '/api/v1/projects/p1/documents/d1/reprocess' })).statusCode).toBe(200);
    expect(ai.processDocument).toHaveBeenCalledTimes(1);
  });
});

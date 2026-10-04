import { describe, it, expect, vi } from 'vitest';

// The knowledge-search agent may only see meeting notes from the project it runs for (2026-10-03:
// it searched every project's meetings).
const h = vi.hoisted(() => ({ search: vi.fn(async (..._a: any[]) => [] as any[]), registered: null as any }));
const search = h.search;
vi.mock('../../services/RagService', () => ({ ragService: { search: (...a: any[]) => h.search(...a), contextFrom: () => '' } }));
vi.mock('../../services/AgentRegistryService', () => ({ agentRegistry: { register: (c: any) => { h.registered = c; } } }));

import '../../services/ragAgentCapability';

describe('rag-context-v1', () => {
  it('searches meeting notes of its own project only', async () => {
    await h.registered.handler({ query: 'risks' }, { projectId: 'p1' });
    expect([...(search.mock.calls[0] as any[])[1].readableProjectIds]).toEqual(['p1']);
  });

  it('with no project, it sees no meeting notes at all', async () => {
    await h.registered.handler({ query: 'risks' });
    expect((search.mock.calls[1] as any[])[1].readableProjectIds.size).toBe(0);
  });
});

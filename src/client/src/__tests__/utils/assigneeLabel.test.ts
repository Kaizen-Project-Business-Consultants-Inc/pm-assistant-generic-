import { describe, it, expect } from 'vitest';
import { assigneeLabel } from '../../utils/resourceLookup';
import { ResourcesApi } from '../../services/apiAreas/resources';

const ID = '8f3c2a1e-5b7d-4c90-a1e2-3d4f5a6b7c8d';

describe('assigneeLabel — a name, never a raw id', () => {
  const names = new Map([[ID, 'Michael A.']]);
  it('shows the person\'s name for their id', () => expect(assigneeLabel(ID, names)).toBe('Michael A.'));
  it('shows an older plain-text name as it is', () => expect(assigneeLabel('Sapphire Team', names)).toBe('Sapphire Team'));
  it('shows "Unknown person" for an id nobody matches', () => expect(assigneeLabel('1b9e7d44-02aa-4f6e-9c13-7e8d6c5b4a30', names)).toBe('Unknown person'));
  it('shows nothing (not "Unknown person") while the people list is still loading', () => expect(assigneeLabel(ID, new Map(), false)).toBe(''));
  it('is empty for no value', () => {
    expect(assigneeLabel(null, names)).toBe('');
    expect(assigneeLabel('  ', names)).toBe('');
  });
  it('treats an upper-case id the same', () => expect(assigneeLabel(ID.toUpperCase(), new Map())).toBe('Unknown person'));
});

describe('getResources reads every page of people', () => {
  const people = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${from + i}`, name: `P${from + i}` }));
  const make = (total: number) => {
    const calls: Array<Record<string, number>> = [];
    const api = new ResourcesApi();
    (api as unknown as { api: unknown }).api = {
      get: async (_url: string, { params }: { params: { limit: number; offset: number } }) => {
        calls.push(params);
        const n = Math.max(0, Math.min(params.limit, total - params.offset));
        return { data: { resources: people(params.offset, n), total } };
      },
    };
    return { api, calls };
  };
  it('asks again until it has everyone (450 people = 3 pages)', async () => {
    const { api, calls } = make(450);
    const r = await api.getResources();
    expect(r.resources).toHaveLength(450);
    expect(calls.map(c => c.offset)).toEqual([0, 200, 400]);
  });
  it('one request when the list is short', async () => {
    const { api, calls } = make(12);
    expect((await api.getResources()).resources).toHaveLength(12);
    expect(calls).toHaveLength(1);
  });
  it('a restricted role gets everyone in one response, whatever the page size: no repeats', async () => {
    const api = new ResourcesApi();
    let calls = 0;
    (api as unknown as { api: unknown }).api = {
      get: async () => { calls++; return { data: { resources: people(0, 250), total: 250 } }; },
    };
    expect((await api.getResources()).resources).toHaveLength(250);
    expect(calls).toBe(1);
  });
  it('exactly one full page does not loop forever', async () => {
    const { api, calls } = make(200);
    expect((await api.getResources()).resources).toHaveLength(200);
    expect(calls).toHaveLength(1);
  });
});

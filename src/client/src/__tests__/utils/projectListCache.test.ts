import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { refreshProjectLists, PROJECT_LIST_KEYS } from '../../utils/projectListCache';

/**
 * Archived projects stayed on the dashboard and unarchived ones never came back (2026-10-11): the
 * archive button refreshed only the Projects page list, and the app never refetches on mount.
 */
describe('refreshProjectLists', () => {
  const client = () => new QueryClient({ defaultOptions: { queries: { staleTime: 600_000, refetchOnMount: false, retry: false } } });

  it('refetches the list on screen, drops the ones on other pages, leaves other data alone', async () => {
    const qc = client();
    let fetches = 0;
    const onScreen = new QueryObserver(qc, { queryKey: ['pm-all-projects', false], queryFn: async () => ++fetches });
    const unsubscribe = onScreen.subscribe(() => {});
    await vi.waitFor(() => expect(qc.getQueryData(['pm-all-projects', false])).toBe(1)); // first load finished
    qc.setQueryData(['pm-projects'], { data: [{ id: 'archived-one' }] });
    qc.setQueryData(['favourite-projects'], { data: [] });
    qc.setQueryData(['tasks', 'p1'], ['t1']);

    refreshProjectLists(qc);

    await vi.waitFor(() => expect(qc.getQueryData(['pm-all-projects', false])).toBe(2));
    expect(qc.getQueryData(['pm-projects'])).toBeUndefined();
    expect(qc.getQueryData(['favourite-projects'])).toBeUndefined();
    expect(qc.getQueryData(['tasks', 'p1'])).toEqual(['t1']);
    unsubscribe();
  });

  it('covers the dashboard, Projects page, sidebar, pickers and portfolio lists', () => {
    const keys = PROJECT_LIST_KEYS.map((k) => k[0]);
    for (const k of ['projects', 'pm-projects', 'pm-all-projects', 'favourite-projects', 'portfolio', 'dashboard-predictions', 'analytics-summary']) {
      expect(keys).toContain(k);
    }
  });

  it('every screen that creates, changes, archives or deletes a project refreshes the lists', () => {
    const root = join(__dirname, '../..');
    const changes = /apiService\.(createProject|createProjectFromChat|applyTemplate|convertIntakeToProject|updateProject|updateProjectStatus|archiveProject|unarchiveProject|deleteProject|loadSampleProject|removeSampleProject|updateProjectGroup|deleteProjectGroup)\(/;
    // the brief card saves only the brief text, which no project list shows
    const exempt = new Set(['components/project/ProjectBriefCard.tsx']);
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'apiAreas') walk(path);
        } else if (/\.tsx?$/.test(name)) {
          const rel = relative(root, path).replace(/\\/g, '/');
          const src = readFileSync(path, 'utf8');
          if (changes.test(src) && !exempt.has(rel) && !src.includes('refreshProjectLists(')) missing.push(rel);
        }
      }
    };
    walk(root);
    expect(missing).toEqual([]);
  });
});

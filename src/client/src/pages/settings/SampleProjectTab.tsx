import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';

/**
 * Settings → Sample project (Oct 2026): the read-only "Sample Web App Development" is optional.
 * New companies start without it. The company owner or an admin loads it to explore every
 * feature filled in, and removes it again — with an in-page confirmation, never a browser dialog.
 */
export function SampleProjectTab() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['sample-project'], queryFn: () => apiService.getSampleProject() });
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loaded = !!q.data?.loaded;

  const refreshEverything = () => {
    queryClient.invalidateQueries({ queryKey: ['sample-project'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
  };

  const run = async (action: 'remove' | 'load') => {
    setError(null); setDone(null); setWorking(true);
    try {
      if (action === 'remove') await apiService.removeSampleProject();
      else await apiService.loadSampleProject();
      const msg = action === 'remove'
        ? 'The sample project and its example people were removed. Your own projects were not touched.'
        : 'The sample project was added. Find "Sample Web App Development" in your project list.';
      setDone(msg); announce(msg);
      setConfirming(false);
      refreshEverything();
    } catch (err) {
      setError(getApiErrorMessage(err, action === 'remove'
        ? 'The sample project could not be removed. Nothing was changed — please try again.'
        : 'The sample project could not be loaded. Nothing was changed — please try again.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sample project</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 max-w-prose">
            "Sample Web App Development" is a read-only example with made-up people, timesheets and costs, so you can see every feature filled in.
            While it is loaded it is left out of every total, report and workload.
          </p>
        </div>

        {q.isLoading && <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Loading…</p>}
        {q.isError && <p className="text-sm text-red-600 dark:text-red-400">Could not check the sample project. Refresh the page to try again.</p>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">{error}</p>}
        {done && <p role="status" className="text-sm text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">{done}</p>}

        {q.data && (
          <div className="divide-y divide-gray-200 dark:divide-gray-700 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sample Web App Development</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">Read-only example project.</p>
              </div>
              <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 border whitespace-nowrap ${loaded
                ? 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-800'
                : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-700'}`}>
                {loaded ? 'Loaded' : 'Not loaded'}
              </span>
            </div>

            {loaded ? (
              <div className="py-3 space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[14rem]">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Remove sample data</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Removes the sample project and its example people, sprints, meetings, timesheets and costs. Your own projects are not touched.</p>
                  </div>
                  {!confirming && (
                    <button type="button" onClick={() => { setConfirming(true); setDone(null); }} disabled={working}
                      className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/40 disabled:opacity-60">
                      Remove…
                    </button>
                  )}
                </div>
                {confirming && (
                  <div role="group" aria-label="Confirm removing the sample project" className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-3">
                    <p className="text-sm text-gray-900 dark:text-gray-100">
                      <strong>Remove the sample project?</strong> This deletes the sample project and its example people from your company. You can load it again later from this page.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setConfirming(false)} disabled={working}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60">
                        Cancel
                      </button>
                      <button type="button" onClick={() => run('remove')} disabled={working}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60">
                        {working && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />}
                        Yes, remove sample data
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-start gap-3 py-3">
                <div className="flex-1 min-w-[14rem]">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Load sample project</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Adds the example project, read-only, for exploring features. You can remove it again any time.</p>
                </div>
                <button type="button" onClick={() => run('load')} disabled={working}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60">
                  {working && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />}
                  Load
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

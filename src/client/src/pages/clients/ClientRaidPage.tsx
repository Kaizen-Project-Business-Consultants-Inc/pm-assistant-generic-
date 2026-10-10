import { useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { routeTo } from '../../routes';
import { ClientBreadcrumb } from './ClientBreadcrumb';
import { formatCalendarDate } from '../../utils/dateUtils';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

type Show = 'open' | 'all' | 'high';

interface ClientRaidItem {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  type: string;
  recordId: string | null;
  title: string;
  severity: string | null;
  status: string | null;
  ownerName: string | null;
  dueDate: string | null;
  overdue: boolean;
}

interface ClientRaidResponse {
  client: { id: string; name: string; color: string };
  projects: Array<{ id: string; name: string; code: string | null }>;
  summary: { openRisks: number; openIssues: number; highCritical: number; overdueActions: number };
  items: ClientRaidItem[];
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

/**
 * A client's risks & issues across all its projects (Oct 2026). Read-only: each project keeps its
 * own register; an item opens in its project's RAID tab to be changed there.
 */
export function ClientRaidPage() {
  const { id } = useParams<{ id: string }>();
  const uid = useId();
  const [show, setShow] = useState<Show>('open');

  const { data, isLoading, error } = useQuery<ClientRaidResponse>({
    queryKey: ['client-raid', id, show],
    queryFn: () => apiService.getClientRaid(id!, show),
    enabled: !!id,
  });

  const name = data?.client?.name || 'Client';
  const items = data?.items || [];
  const summary = data?.summary;

  const tiles: Array<{ label: string; value: number | undefined; warn?: boolean }> = [
    { label: 'Open risks', value: summary?.openRisks },
    { label: 'Open issues', value: summary?.openIssues },
    { label: 'High / critical', value: summary?.highCritical, warn: true },
    { label: 'Overdue actions', value: summary?.overdueActions, warn: true },
  ];

  return (
    <div className="p-6 space-y-6">
      <ClientBreadcrumb name={name} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Risks &amp; issues — all {name} projects</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Each project keeps its own register. This view only reads them together; open an item to change it in its project.
          </p>
        </div>
        <div>
          <label htmlFor={`${uid}-show`} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Show</label>
          <select
            id={`${uid}-show`}
            value={show}
            onChange={e => setShow(e.target.value as Show)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            <option value="open">Open risks &amp; issues</option>
            <option value="all">All RAID items</option>
            <option value="high">High &amp; critical only</option>
          </select>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(error, 'Could not load this client\'s risks and issues. Please try again.')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {tiles.map(t => (
              <div key={t.label} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t.label}</p>
                <p className={`text-2xl font-bold mt-1 ${t.warn && (t.value ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                  {isLoading ? '…' : (t.value ?? 0)}
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Project', 'Type', 'Title', 'Severity', 'Owner', 'Due'].map(h => (
                    <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Nothing to show for this choice.</td></tr>
                ) : items.map(item => (
                  <tr key={`${item.projectId}-${item.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                      {item.projectCode && <><span className="font-mono text-xs text-gray-500 dark:text-gray-400 mr-1.5">{item.projectCode}</span><span className="sr-only"> – </span></>}
                      {item.projectName}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{capitalise(item.type || '')}</td>
                    <td className="px-4 py-3 text-sm">
                      <Link to={routeTo.project(item.projectId, 'raid')} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
                        {item.recordId && <span className="font-mono text-xs mr-1.5">{item.recordId}</span>}
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {item.severity ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_CLASS[item.severity.toLowerCase()] || SEVERITY_CLASS.low}`}>
                          {capitalise(item.severity)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{item.ownerName || '—'}</td>
                    <td className={`px-4 py-3 text-sm ${item.overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>
                      {item.dueDate ? formatCalendarDate(item.dueDate) : '—'}
                      {item.overdue && <span className="sr-only"> (overdue)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Only projects you can open are included.</p>
        </>
      )}
    </div>
  );
}

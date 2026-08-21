import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { List, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { apiService } from '../../services/api';

interface Epic {
  id: string;
  name: string;
  status: string;
  childCount: number;
  completedChildCount: number;
  progress: number;
  totalPoints: number;
  completedPoints: number;
  startDate: string | null;
  endDate: string | null;
}

type SortKey = 'name' | 'status' | 'progress' | 'childCount' | 'totalPoints' | 'startDate' | 'endDate';

const statusBadge: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
  on_hold: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' },
};

function formatDate(d: string | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-CA');
}

export function EpicList({ scheduleId }: { scheduleId: string }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['epics', scheduleId],
    queryFn: () => apiService.getEpics(scheduleId),
    enabled: !!scheduleId,
  });

  const epics: Epic[] = data?.epics || [];

  const sorted = useMemo(() => {
    let list = statusFilter === 'all' ? [...epics] : epics.filter((e) => e.status === statusFilter);
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'progress': cmp = a.progress - b.progress; break;
        case 'childCount': cmp = a.childCount - b.childCount; break;
        case 'totalPoints': cmp = a.totalPoints - b.totalPoints; break;
        case 'startDate': cmp = (a.startDate || '').localeCompare(b.startDate || ''); break;
        case 'endDate': cmp = (a.endDate || '').localeCompare(b.endDate || ''); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [epics, statusFilter, sortKey, sortAsc]);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) { setSortAsc(!sortAsc); }
    else { setSortKey(key); setSortAsc(true); }
  }, [sortKey, sortAsc]);

  const exportCsv = useCallback(() => {
    const header = 'Name,Status,Progress %,Stories,Completed Stories,Points,Completed Points,Start Date,End Date';
    const rows = sorted.map((e) =>
      [e.name, e.status, e.progress, e.childCount, e.completedChildCount, e.totalPoints, e.completedPoints, formatDate(e.startDate), formatDate(e.endDate)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `epics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sorted]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortAsc
      ? <ArrowUp className="w-3 h-3 inline ml-0.5" />
      : <ArrowDown className="w-3 h-3 inline ml-0.5" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
        Failed to load epics
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <List className="w-5 h-5 text-purple-500" />
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Epic List</h4>
          <span className="text-xs text-gray-500 dark:text-gray-400">({sorted.length} epic{sorted.length !== 1 ? 's' : ''})</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1.5 text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          <button
            onClick={exportCsv}
            disabled={sorted.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-8 text-center">
          <List className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No epics found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {([
                  ['name', 'Name'],
                  ['status', 'Status'],
                  ['progress', 'Progress'],
                  ['childCount', 'Stories'],
                  ['totalPoints', 'Points'],
                  ['startDate', 'Start Date'],
                  ['endDate', 'End Date'],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none"
                  >
                    {label}<SortIcon col={key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((epic) => {
                const s = statusBadge[epic.status] || statusBadge.pending;
                return (
                  <tr key={epic.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">{epic.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                        {epic.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${epic.progress === 100 ? 'bg-green-500' : 'bg-purple-500'}`}
                            style={{ width: `${epic.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{epic.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                      {epic.completedChildCount}/{epic.childCount}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                      {epic.completedPoints}/{epic.totalPoints}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{formatDate(epic.startDate)}</td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{formatDate(epic.endDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

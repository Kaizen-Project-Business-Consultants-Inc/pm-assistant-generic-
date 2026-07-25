import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';
import { ChevronLeft, ChevronRight, Filter, Search } from 'lucide-react';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorType: string;
  projectId: string | null;
  source: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

function fmt(date: string) {
  return new Date(date).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
  update: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  delete: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
};

const ACTION_OPTIONS = ['', 'create', 'update', 'delete'];
const ENTITY_OPTIONS = ['', 'task', 'project', 'risk', 'schedule', 'resource', 'sprint', 'comment', 'user', 'change_request'];
const PAGE_SIZE = 50;

export function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-audit', action, entityType, page],
    queryFn: () => apiService.getAdminAudit({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      action: action || undefined,
      entityType: entityType || undefined,
    }),
  });

  const entries: AuditEntry[] = data?.entries ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Client-side text search on visible entries
  const filtered = searchText
    ? entries.filter(e =>
        e.entityType.toLowerCase().includes(searchText.toLowerCase()) ||
        e.entityId.toLowerCase().includes(searchText.toLowerCase()) ||
        e.actorId.toLowerCase().includes(searchText.toLowerCase()) ||
        e.source.toLowerCase().includes(searchText.toLowerCase())
      )
    : entries;

  return (
    <AdminPageWrapper title="Audit Trail" subtitle="Recent activity across all projects">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <Filter className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Filters</span>
        </div>

        <select
          value={action}
          onChange={e => { setAction(e.target.value); setPage(0); }}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.filter(Boolean).map(a => (
            <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
          ))}
        </select>

        <select
          value={entityType}
          onChange={e => { setEntityType(e.target.value); setPage(0); }}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
        >
          <option value="">All entities</option>
          {ENTITY_OPTIONS.filter(Boolean).map(et => (
            <option key={et} value={et}>{et.replace('_', ' ')}</option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search entries..."
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400"
          />
        </div>

        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
          {total.toLocaleString()} entries
        </span>
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading audit trail…</div>}
      {error && <div className="text-center py-12 text-red-500">Failed to load audit trail.</div>}

      {!isLoading && !error && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="pb-3 pr-4">Timestamp</th>
                  <th className="pb-3 pr-4">Action</th>
                  <th className="pb-3 pr-4">Entity</th>
                  <th className="pb-3 pr-4">Actor</th>
                  <th className="pb-3 pr-4">Source</th>
                  <th className="pb-3">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((entry: AuditEntry) => {
                  const colorClass = ACTION_COLORS[entry.action] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-3 pr-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmt(entry.createdAt)}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-gray-900 dark:text-white">{entry.entityType}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{entry.entityId?.slice(0, 8)}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-gray-700 dark:text-gray-200">{entry.actorType}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{entry.actorId?.slice(0, 8)}</div>
                      </td>
                      <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{entry.source}</td>
                      <td className="py-3 text-xs text-gray-400 dark:text-gray-500 font-mono">{entry.projectId?.slice(0, 8) || '\u2014'}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-500 dark:text-gray-400">No audit entries found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </AdminPageWrapper>
  );
}

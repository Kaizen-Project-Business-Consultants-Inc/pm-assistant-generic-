import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  Shield,
  DollarSign,
  Users,
  ShieldAlert,
  Search,
  Download,
  Trash2,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../services/api';
import { renderMarkdown } from '../utils/renderMarkdown';
import { RAIDReportModal } from '../components/risks/RAIDReportModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Report {
  id: string;
  title: string;
  content: string;
  reportType: string;
  createdAt?: string;
  generatedAt?: string;
  projectId?: string | null;
  contextType?: string;
}

interface Project {
  id: string;
  name: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORT_TYPES = [
  { value: 'weekly-status', label: 'Weekly Status', icon: FileBarChart, badgeColor: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  { value: 'risk-assessment', label: 'Risk Assessment', icon: Shield, badgeColor: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  { value: 'budget-forecast', label: 'Budget Forecast', icon: DollarSign, badgeColor: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  { value: 'resource-utilization', label: 'Resource Utilization', icon: Users, badgeColor: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
  { value: 'raid-report', label: 'RAID Report', icon: ShieldAlert, badgeColor: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
] as const;

const badgeColorMap: Record<string, string> = {
  'weekly-status': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  'risk-assessment': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  'budget-forecast': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  'resource-utilization': 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  'raid-report': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  'status-report': 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
  'report': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
};

const labelMap: Record<string, string> = {
  'weekly-status': 'Weekly Status',
  'risk-assessment': 'Risk Assessment',
  'budget-forecast': 'Budget Forecast',
  'resource-utilization': 'Resource Util.',
  'raid-report': 'RAID Report',
  'status-report': 'Status Report',
  'report': 'AI Report',
};

const FILTER_TABS = [
  { value: '', label: 'All' },
  { value: 'report', label: 'AI Reports' },
  { value: 'raid-report', label: 'RAID' },
  { value: 'status-report', label: 'Status' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function isHtmlContent(content: string): boolean {
  return content.trimStart().startsWith('<');
}

// ---------------------------------------------------------------------------
// SortHeader
// ---------------------------------------------------------------------------

const SortHeader: React.FC<{
  label: string;
  column: string;
  currentSort: string;
  currentOrder: 'asc' | 'desc';
  onSort: (col: string) => void;
  className?: string;
}> = ({ label, column, currentSort, currentOrder, onSort, className }) => {
  const isActive = currentSort === column;
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${className || ''}`}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive ? (
          currentOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        ) : (
          <div className="w-3 h-3" />
        )}
      </div>
    </th>
  );
};

// ---------------------------------------------------------------------------
// ReportViewerModal
// ---------------------------------------------------------------------------

const ReportViewerModal: React.FC<{
  report: Report;
  onClose: () => void;
}> = ({ report, onClose }) => {
  const badgeColor = badgeColorMap[report.reportType] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
  const typeLabel = labelMap[report.reportType] || report.reportType;
  const dateStr = report.createdAt || report.generatedAt || '';
  const html = isHtmlContent(report.content);

  const handleDownload = () => {
    const content = html ? report.content : `<html><body>${renderMarkdown(report.content)}</body></html>`;
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{report.title}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}>
                {typeLabel}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <Clock className="w-3 h-3" />
                {formatDate(dateStr)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-4">
            <button
              onClick={handleDownload}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Download"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(report.content) }} />
          ) : (
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-200"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(report.content)) }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ReportsPage
// ---------------------------------------------------------------------------

export const ReportsPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Form state
  const [selectedType, setSelectedType] = useState<typeof REPORT_TYPES[number]['value']>(REPORT_TYPES[0].value);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Modal state
  const [viewingReport, setViewingReport] = useState<Report | null>(null);
  const [showRaidReport, setShowRaidReport] = useState(false);

  // Table state
  const [typeFilter, setTypeFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Debounced search — apply on Enter or blur
  const applySearch = useCallback(() => {
    setSearchQuery(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleSort = useCallback((col: string) => {
    if (sortBy === col) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder(col === 'date' ? 'desc' : 'asc');
    }
    setPage(1);
  }, [sortBy]);

  // ---- Queries ----

  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ['reportHistory', typeFilter, searchQuery, sortBy, sortOrder, page],
    queryFn: () => apiService.getReportHistory({
      type: typeFilter || undefined,
      search: searchQuery || undefined,
      sortBy,
      sortOrder,
      page,
      limit: PAGE_SIZE,
    }),
  });

  const {
    data: projectsData,
    isLoading: projectsLoading,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const reports: Report[] = historyData?.reports || [];
  const total: number = historyData?.total || 0;
  const totalPages: number = historyData?.totalPages || 0;
  const typeCounts: Record<string, number> = historyData?.typeCounts || {};
  const totalAll = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  const projects: Project[] = projectsData?.data || projectsData?.projects || [];

  const { data: membersData } = useQuery({
    queryKey: ['project-members', selectedProjectId],
    queryFn: () => apiService.getProjectMembers(selectedProjectId),
    enabled: !!selectedProjectId && showRaidReport,
  });

  // Project name lookup
  const projectNameMap: Record<string, string> = {};
  for (const p of projects) projectNameMap[p.id] = p.name;

  // ---- Mutations ----

  const generateMutation = useMutation({
    mutationFn: () =>
      apiService.generateReport({
        reportType: selectedType,
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportHistory'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportHistory'] });
    },
  });

  // ---- Loading state ----

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reports</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Generate AI-powered project reports and review past analyses.
        </p>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Report Generator Card                                             */}
      {/* ----------------------------------------------------------------- */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <FileBarChart className="w-4 h-4 text-primary-500" />
          Generate Report
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Report type selector */}
          <div>
            <label htmlFor="report-type" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Report Type
            </label>
            <div className="relative">
              <select
                id="report-type"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as typeof selectedType)}
                className="input w-full appearance-none pr-8"
              >
                {REPORT_TYPES.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
          </div>

          {/* Project selector */}
          <div>
            <label htmlFor="report-project" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Project {selectedType === 'raid-report' ? '(required)' : '(optional)'}
            </label>
            <div className="relative">
              <select
                id="report-project"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="input w-full appearance-none pr-8"
                disabled={projectsLoading}
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
          </div>

          {/* Generate button */}
          <div className="flex items-end">
            <button
              onClick={() => {
                if (selectedType === 'raid-report') {
                  setShowRaidReport(true);
                } else {
                  generateMutation.mutate();
                }
              }}
              disabled={generateMutation.isPending || (selectedType === 'raid-report' && !selectedProjectId)}
              className="btn btn-primary flex items-center gap-2 w-full justify-center"
            >
              {generateMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Generate Report
                </>
              )}
            </button>
          </div>
        </div>

        {/* Generation error */}
        {generateMutation.isError && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Failed to generate report. Please try again.
          </div>
        )}

        {/* Generation success */}
        {generateMutation.isSuccess && (
          <div className="mt-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 flex items-center justify-between">
            <span>Report generated successfully.</span>
            <button
              onClick={() => {
                const generated = generateMutation.data?.report as Report | undefined;
                if (generated) setViewingReport(generated);
              }}
              className="text-green-800 font-medium underline hover:no-underline text-sm"
            >
              View now
            </button>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Report History Table                                              */}
      {/* ----------------------------------------------------------------- */}
      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            Report History
            {totalAll > 0 && (
              <span className="text-xs font-normal text-gray-400">({totalAll})</span>
            )}
          </h2>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applySearch(); }}
              onBlur={applySearch}
              placeholder="Search by title..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 w-52 focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Type filter pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {FILTER_TABS.map(tab => {
            const count = tab.value === '' ? totalAll : (typeCounts[tab.value] || 0);
            if (tab.value && !count) return null;
            const isActive = typeFilter === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => { setTypeFilter(tab.value); setPage(1); }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {tab.label}
                <span className={`text-[10px] ${isActive ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {historyError ? (
          <div className="card text-center py-10">
            <p className="text-sm text-red-600">Failed to load report history.</p>
          </div>
        ) : historyLoading ? (
          <div className="card flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : totalAll === 0 && !searchQuery && !typeFilter ? (
          <div className="card text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No reports yet</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Generate your first report using the form above.
            </p>
          </div>
        ) : reports.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-sm text-gray-500 dark:text-gray-400">No reports match your filter.</p>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <SortHeader label="Title" column="title" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[40%]" />
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Project</th>
                      <SortHeader label="Date" column="date" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                    {reports.map((report) => {
                      const badgeColor = badgeColorMap[report.reportType] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
                      const typeLabel = labelMap[report.reportType] || report.reportType;
                      const projName = report.projectId ? projectNameMap[report.projectId as string] : null;

                      return (
                        <tr
                          key={report.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors cursor-pointer"
                          onClick={() => setViewingReport(report)}
                        >
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">
                              {report.title}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${badgeColor}`}>
                              {typeLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px] block">
                              {projName || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {formatDate(report.createdAt || report.generatedAt || '')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => setViewingReport(report)}
                                className="p-1.5 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                title="View report"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { if (confirm('Delete this report?')) deleteMutation.mutate(report.id); }}
                                className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                title="Delete report"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 px-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="First page"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  {/* Page numbers */}
                  {(() => {
                    const pages: (number | '...')[] = [];
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (page > 3) pages.push('...');
                      const start = Math.max(2, page - 1);
                      const end = Math.min(totalPages - 1, page + 1);
                      for (let i = start; i <= end; i++) pages.push(i);
                      if (page < totalPages - 2) pages.push('...');
                      pages.push(totalPages);
                    }
                    return pages.map((p, idx) =>
                      p === '...' ? (
                        <span key={`dots-${idx}`} className="px-1 text-xs text-gray-400">...</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`min-w-[28px] h-7 text-xs rounded-lg transition-colors ${
                            p === page
                              ? 'bg-primary-600 text-white font-semibold'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    );
                  })()}

                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Last page"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Modals                                                            */}
      {/* ----------------------------------------------------------------- */}
      {viewingReport && (
        <ReportViewerModal
          report={viewingReport}
          onClose={() => setViewingReport(null)}
        />
      )}

      {showRaidReport && selectedProjectId && (
        <RAIDReportModal
          projectId={selectedProjectId}
          projectName={projects.find(p => p.id === selectedProjectId)?.name || 'Project'}
          members={(membersData?.members || membersData?.data || []).map((m: any) => ({
            userId: m.userId || m.id,
            userName: m.userName || m.name || m.email,
            email: m.email,
          }))}
          onClose={() => setShowRaidReport(false)}
        />
      )}
    </div>
  );
};

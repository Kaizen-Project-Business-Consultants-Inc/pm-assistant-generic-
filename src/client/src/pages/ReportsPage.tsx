import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  Search,
  Download,
  Trash2,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  Filter,
  RefreshCw,
  Star,
  Play,
  Pause,
  Pencil,
  Plus,
  CalendarClock,
  AlertCircle,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../services/api';
import { renderMarkdown } from '../utils/renderMarkdown';
import { RAIDReportModal } from '../components/risks/RAIDReportModal';
import { StatusReportModal } from './ProjectDetailPage/StatusReportModal';
import { StrategicRiskScanModal } from './ProjectDetailPage/StrategicRiskScanModal';
import { REPORT_CATALOG, type ReportDefinition } from '../components/reports/reportCatalog';
import { ReportCategorySection } from '../components/reports/ReportCategorySection';
import { ReportTile } from '../components/reports/ReportTile';
import { InstantReportModal } from '../components/reports/InstantReportModal';
import { ReportScheduleModal } from '../components/reports/ReportScheduleModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReportListItem {
  id: string;
  title: string;
  reportType: string;
  createdAt?: string;
  generatedAt?: string;
  projectId?: string | null;
  contextType?: string;
  contentAvailable?: boolean;
}

interface Project {
  id: string;
  name: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const badgeColorMap: Record<string, string> = {
  'risk-assessment': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  'budget-forecast': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  'resource-utilization': 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  'raid-report': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  'status-report': 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
  'weekly-status': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  'report': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
};

const labelMap: Record<string, string> = {
  'risk-assessment': 'Risk Assessment',
  'budget-forecast': 'Budget Forecast',
  'resource-utilization': 'Resource Util.',
  'raid-report': 'RAID Report',
  'status-report': 'Status Report',
  'weekly-status': 'Weekly Status',
  'report': 'AI Report',
};

const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'status-report', label: 'Status Reports' },
  { value: 'report', label: 'AI Reports' },
  { value: 'report:risk-assessment', label: '\u00A0\u00A0\u00A0Risk Assessment' },
  { value: 'report:budget-forecast', label: '\u00A0\u00A0\u00A0Budget Forecast' },
  { value: 'report:resource-utilization', label: '\u00A0\u00A0\u00A0Resource Utilization' },
  { value: 'raid-report', label: 'RAID Reports' },
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
  report: ReportListItem;
  onClose: () => void;
  onRegenerate?: (report: ReportListItem) => void;
}> = ({ report, onClose, onRegenerate }) => {
  const badgeColor = badgeColorMap[report.reportType] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
  const typeLabel = labelMap[report.reportType] || report.reportType;
  const dateStr = report.createdAt || report.generatedAt || '';

  // Fetch full content on demand
  const { data, isLoading, isError } = useQuery({
    queryKey: ['report', report.id],
    queryFn: () => apiService.getReport(report.id),
  });

  const contentPurged: boolean = data?.report?.contentPurged === true;
  const content: string = data?.report?.content || '';
  const html = content ? isHtmlContent(content) : false;

  const handleDownload = () => {
    if (!content) return;
    const downloadContent = html ? content : `<html><body>${renderMarkdown(content)}</body></html>`;
    const blob = new Blob([downloadContent], { type: 'text/html' });
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
              disabled={!content}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30"
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
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : isError ? (
            <div className="text-center py-8 text-sm text-red-600">Failed to load report content.</div>
          ) : contentPurged ? (
            <div className="text-center py-12">
              <Clock className="mx-auto h-10 w-10 text-amber-400 mb-3" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Content Expired</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto mb-4">
                This report's content has been automatically purged to save storage. Only the most recent reports retain full content.
              </p>
              {onRegenerate && (
                <button
                  onClick={() => onRegenerate(report)}
                  className="btn btn-primary inline-flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate Report
                </button>
              )}
            </div>
          ) : !content ? (
            <div className="text-center py-8 text-sm text-gray-500">No content available.</div>
          ) : html ? (
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />
          ) : (
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-200"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(content)) }}
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

  // Project selector
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Category expansion state — initialize from catalog defaults
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(REPORT_CATALOG.filter(c => c.defaultExpanded).map(c => c.id))
  );

  // Modal state
  const [viewingReport, setViewingReport] = useState<ReportListItem | null>(null);
  const [showRaidReport, setShowRaidReport] = useState(false);
  const [showStatusReport, setShowStatusReport] = useState(false);
  const [showRiskScan, setShowRiskScan] = useState(false);
  const [activeInstantReport, setActiveInstantReport] = useState<{ html: string; title: string } | null>(null);
  const [generatingReportType, setGeneratingReportType] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);

  // Favorites
  const [favoriteReportIds, setFavoriteReportIds] = useState<string[]>([]);

  const { data: viewPrefsData } = useQuery({
    queryKey: ['viewPreferences'],
    queryFn: () => apiService.getViewPreferences(),
  });

  useEffect(() => {
    const ids = viewPrefsData?.preferences?.favoriteReportIds;
    if (Array.isArray(ids)) setFavoriteReportIds(ids);
  }, [viewPrefsData]);

  const toggleFavorite = useCallback((reportId: string) => {
    setFavoriteReportIds(prev => {
      const next = prev.includes(reportId)
        ? prev.filter(id => id !== reportId)
        : prev.length >= 10 ? prev : [...prev, reportId];
      apiService.updateViewPreferences({ favoriteReportIds: next });
      return next;
    });
  }, []);

  // Build flat lookup of all reports from catalog
  const allReportsMap = new Map<string, ReportDefinition>();
  for (const cat of REPORT_CATALOG) {
    for (const r of cat.reports) {
      allReportsMap.set(r.id, r);
    }
  }
  const favoriteReports = favoriteReportIds
    .map(id => allReportsMap.get(id))
    .filter((r): r is ReportDefinition => !!r);

  // Table state
  const [typeFilter, setTypeFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [deleteScheduleConfirmId, setDeleteScheduleConfirmId] = useState<string | null>(null);
  const [deleteReportConfirmId, setDeleteReportConfirmId] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  // Debounced search — apply on Enter or blur
  const applySearch = useCallback(() => {
    setSearchQuery(searchInput);
    setPage(1);
  }, [searchInput]);

  const clearFilters = useCallback(() => {
    setTypeFilter('');
    setSearchInput('');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }, []);

  const handleSort = useCallback((col: string) => {
    if (sortBy === col) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder(col === 'date' ? 'desc' : 'asc');
    }
    setPage(1);
  }, [sortBy]);

  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }, []);

  // ---- Queries ----

  const hasHistorySearch = !!(typeFilter || searchQuery || dateFrom || dateTo);

  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ['reportHistory', typeFilter, searchQuery, dateFrom, dateTo, sortBy, sortOrder, page],
    queryFn: () => {
      const [contextType, subType] = typeFilter.includes(':') ? typeFilter.split(':') : [typeFilter, ''];
      return apiService.getReportHistory({
        type: contextType || undefined,
        subType: subType || undefined,
        search: searchQuery || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortBy,
        sortOrder,
        page,
        limit: PAGE_SIZE,
      });
    },
    enabled: showHistory && hasHistorySearch,
  });

  const {
    data: projectsData,
    isLoading: projectsLoading,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const reports: ReportListItem[] = historyData?.reports || [];
  const total: number = historyData?.total || 0;
  const totalPages: number = historyData?.totalPages || 0;
  const projects: Project[] = projectsData?.data || projectsData?.projects || [];

  const { data: membersData } = useQuery({
    queryKey: ['project-members', selectedProjectId],
    queryFn: () => apiService.getProjectMembers(selectedProjectId),
    enabled: !!selectedProjectId && showRaidReport,
  });

  // Scheduled reports
  const { data: schedulesData, isLoading: schedulesLoading } = useQuery({
    queryKey: ['reportSchedules'],
    queryFn: () => apiService.getReportSchedules(),
    enabled: showSchedules,
  });

  const schedules = schedulesData?.schedules || [];

  const toggleScheduleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiService.updateReportSchedule(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reportSchedules'] }),
  });

  const runNowMutation = useMutation({
    mutationFn: (id: string) => apiService.runReportScheduleNow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reportSchedules'] }),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteReportSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reportSchedules'] }),
  });

  // Project name lookup
  const projectNameMap: Record<string, string> = {};
  for (const p of projects) projectNameMap[p.id] = p.name;

  const getScheduleProjectName = (templateId: string) => {
    if (templateId.startsWith('status-report::')) {
      const pid = templateId.replace('status-report::', '');
      return projectNameMap[pid] || 'Unknown Project';
    }
    if (templateId.startsWith('raid-report::')) {
      const pid = templateId.replace('raid-report::', '');
      return projectNameMap[pid] || 'Unknown Project';
    }
    return templateId;
  };

  const getScheduleReportType = (templateId: string) => {
    if (templateId.startsWith('status-report::')) return 'Status Report';
    if (templateId.startsWith('raid-report::')) return 'RAID Report';
    return 'Custom Report';
  };

  const formatFrequency = (s: any) => {
    if (s.frequency === 'daily') return `Daily at ${s.timeOfDay || '08:00'}`;
    if (s.frequency === 'weekly') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `Weekly on ${days[s.dayOfWeek ?? 1]} at ${s.timeOfDay || '08:00'}`;
    }
    return `Monthly on day ${s.dayOfMonth ?? 1} at ${s.timeOfDay || '08:00'}`;
  };

  // ---- Mutations ----

  const generateMutation = useMutation({
    mutationFn: (data: { reportType: string; projectId: string }) =>
      apiService.generateReport(data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportHistory'] });
    },
  });

  // ---- Report tile click handler ----

  const handleReportClick = useCallback(async (report: ReportDefinition) => {
    if (!selectedProjectId) return;

    switch (report.generationType) {
      case 'modal-existing':
        if (report.modalType === 'status') setShowStatusReport(true);
        else if (report.modalType === 'raid') setShowRaidReport(true);
        else if (report.modalType === 'strategic-risk') setShowRiskScan(true);
        break;

      case 'ai-background':
        generateMutation.mutate({ reportType: report.id, projectId: selectedProjectId });
        break;

      case 'instant':
        setGeneratingReportType(report.id);
        try {
          const result = await apiService.generateInstantReport({
            reportType: report.id,
            projectId: selectedProjectId,
          });
          setActiveInstantReport({ html: result.html, title: result.title });
        } catch {
          // Show error in a simple way
          setActiveInstantReport({
            html: '<div style="text-align: center; padding: 40px; color: #dc2626;">Failed to generate report. Please try again.</div>',
            title: report.name,
          });
        } finally {
          setGeneratingReportType(null);
        }
        break;
    }
  }, [selectedProjectId, generateMutation]);

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
          Generate instant and AI-powered project reports.
        </p>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Persistent Project Selector                                       */}
      {/* ----------------------------------------------------------------- */}
      <div className={`card ${!selectedProjectId ? 'ring-2 ring-primary-300 dark:ring-primary-600' : ''}`}>
        <label htmlFor="report-project" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
          <FileBarChart className="w-3.5 h-3.5 inline mr-1.5 text-primary-500" />
          Select Project
        </label>
        <div className="relative max-w-md">
          <select
            id="report-project"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="input w-full appearance-none pr-8"
          >
            <option value="">Select a project to generate reports...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Favorites                                                         */}
      {/* ----------------------------------------------------------------- */}
      {favoriteReports.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Star className="w-4 h-4 text-amber-400 fill-current" />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Favorites</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{favoriteReports.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {favoriteReports.map(report => (
              <ReportTile
                key={report.id}
                report={report}
                disabled={!selectedProjectId}
                loading={generatingReportType === report.id}
                isFavorite={true}
                onToggleFavorite={() => toggleFavorite(report.id)}
                onClick={() => handleReportClick(report)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Scheduled Reports                                                 */}
      {/* ----------------------------------------------------------------- */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5">
          <button
            onClick={() => setShowSchedules(prev => !prev)}
            className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
          >
            {showSchedules ? (
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            )}
            <CalendarClock className="w-4 h-4 text-primary-500 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Scheduled Reports</span>
            {schedules.length > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">{schedules.length}</span>
            )}
          </button>
          <button
            onClick={() => { setEditingScheduleId(null); setShowScheduleModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Schedule Report
          </button>
        </div>

        {showSchedules && (
          <div className="px-5 pb-4">
            {schedulesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : schedules.length === 0 ? (
              <div className="text-center py-6">
                <CalendarClock className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No scheduled reports yet. Click "Schedule Report" to create one.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Report</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Project</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Frequency</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Next Run</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {schedules.map((s: any) => (
                        <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{getScheduleReportType(s.templateId)}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs text-gray-500 dark:text-gray-400">{getScheduleProjectName(s.templateId)}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs text-gray-600 dark:text-gray-300">{formatFrequency(s)}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {s.isActive ? formatDate(s.nextRunAt) : 'Paused'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {s.lastRunStatus === 'error' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400" title={s.lastRunError || 'Error'}>
                                <AlertCircle className="w-3 h-3" />
                                Error
                              </span>
                            ) : s.lastRunStatus === 'success' ? (
                              <span className="text-xs text-green-600 dark:text-green-400">Success</span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { setEditingScheduleId(s.id); setShowScheduleModal(true); }}
                                className="p-1.5 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                title="Edit schedule"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => toggleScheduleMutation.mutate({ id: s.id, isActive: !s.isActive })}
                                className="p-1.5 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                                title={s.isActive ? 'Pause' : 'Resume'}
                              >
                                {s.isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => runNowMutation.mutate(s.id)}
                                disabled={runNowMutation.isPending}
                                className="p-1.5 text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors disabled:opacity-30"
                                title="Run now"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${runNowMutation.isPending ? 'animate-spin' : ''}`} />
                              </button>
                              <button
                                onClick={() => setDeleteScheduleConfirmId(s.id)}
                                className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                title="Delete schedule"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Report Categories                                                 */}
      {/* ----------------------------------------------------------------- */}
      <div className="space-y-3">
        {REPORT_CATALOG.map(category => (
          <ReportCategorySection
            key={category.id}
            category={category}
            expanded={expandedCategories.has(category.id)}
            onToggle={() => toggleCategory(category.id)}
            disabled={!selectedProjectId}
            generatingReportType={generatingReportType}
            onReportClick={handleReportClick}
            favoriteReportIds={favoriteReportIds}
            onToggleFavorite={toggleFavorite}
          />
        ))}
      </div>

      {/* AI generation feedback */}
      {generateMutation.isError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Failed to generate report. Please try again.
        </div>
      )}
      {generateMutation.isSuccess && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
          Report is being generated. You&apos;ll be notified when it&apos;s ready.
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Report History (collapsed by default)                             */}
      {/* ----------------------------------------------------------------- */}
      <div className="card p-0 overflow-hidden">
        <button
          onClick={() => setShowHistory(prev => !prev)}
          className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          {showHistory ? (
            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Report History</span>
        </button>

        {showHistory && <div className="px-5 pb-4">

        {/* Filter bar */}
        <div className="mb-3 py-3 px-4 rounded-lg bg-gray-50 dark:bg-gray-800/50">
          <div className="flex flex-wrap items-end gap-3">
            {/* Type dropdown */}
            <div className="min-w-[160px]">
              <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                <Filter className="w-3 h-3 inline mr-1" />
                Type
              </label>
              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                  className="input w-full text-xs appearance-none pr-7 py-1.5"
                >
                  {TYPE_FILTER_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              </div>
            </div>

            {/* Search */}
            <div className="min-w-[180px] flex-1 max-w-[260px]">
              <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                <Search className="w-3 h-3 inline mr-1" />
                Search
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applySearch(); }}
                  onBlur={applySearch}
                  placeholder="Search by title..."
                  className="input w-full text-xs py-1.5 pr-3"
                />
              </div>
            </div>

            {/* Date From */}
            <div className="min-w-[140px]">
              <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                <Calendar className="w-3 h-3 inline mr-1" />
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                className="input w-full text-xs py-1.5"
              />
            </div>

            {/* Date To */}
            <div className="min-w-[140px]">
              <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPage(1); }}
                min={dateFrom || undefined}
                className="input w-full text-xs py-1.5"
              />
            </div>

            {/* Clear filters */}
            {hasHistorySearch && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors mb-[1px]"
                title="Clear all filters"
              >
                <X className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>

        {!hasHistorySearch ? (
          <div className="text-center py-8">
            <Search className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Search by title, filter by type, or select a date range to find past reports.
            </p>
          </div>
        ) : historyError ? (
          <div className="text-center py-10">
            <p className="text-sm text-red-600">Failed to load report history.</p>
          </div>
        ) : historyLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 dark:text-gray-400">No reports match your search.</p>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
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
                              {report.contentAvailable === false && (
                                <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                  Expired
                                </span>
                              )}
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
                                onClick={() => setDeleteReportConfirmId(report.id)}
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

        </div>}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Modals                                                            */}
      {/* ----------------------------------------------------------------- */}
      {viewingReport && (
        <ReportViewerModal
          report={viewingReport}
          onClose={() => setViewingReport(null)}
          onRegenerate={(r) => {
            setViewingReport(null);
            if (r.contextType === 'status-report' && r.projectId) {
              setSelectedProjectId(r.projectId);
              setShowStatusReport(true);
            } else if (r.contextType === 'report' && r.projectId) {
              setSelectedProjectId(r.projectId);
              const title = r.title || '';
              let reportType = 'weekly-status';
              if (title.startsWith('Risk Assessment')) reportType = 'risk-assessment';
              else if (title.startsWith('Budget Forecast')) reportType = 'budget-forecast';
              else if (title.startsWith('Resource Utilization')) reportType = 'resource-utilization';
              generateMutation.mutate({ reportType, projectId: r.projectId });
            }
          }}
        />
      )}

      {activeInstantReport && (
        <InstantReportModal
          title={activeInstantReport.title}
          html={activeInstantReport.html}
          onClose={() => setActiveInstantReport(null)}
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

      {showStatusReport && selectedProjectId && (
        <StatusReportModal
          projectId={selectedProjectId}
          projectName={projects.find(p => p.id === selectedProjectId)?.name || 'Project'}
          onClose={() => setShowStatusReport(false)}
        />
      )}

      {showScheduleModal && (
        <ReportScheduleModal
          projects={projects}
          initialProjectId={selectedProjectId}
          editScheduleId={editingScheduleId || undefined}
          onClose={() => { setShowScheduleModal(false); setEditingScheduleId(null); }}
        />
      )}

      {showRiskScan && selectedProjectId && (
        <StrategicRiskScanModal
          projectId={selectedProjectId}
          projectName={projects.find(p => p.id === selectedProjectId)?.name || 'Project'}
          onClose={() => setShowRiskScan(false)}
        />
      )}

      {deleteScheduleConfirmId && (
        <ConfirmModal
          title="Delete Schedule"
          message="Delete this report schedule? This cannot be undone."
          confirmLabel="Delete"
          isPending={deleteScheduleMutation.isPending}
          onConfirm={() => { deleteScheduleMutation.mutate(deleteScheduleConfirmId); setDeleteScheduleConfirmId(null); }}
          onCancel={() => setDeleteScheduleConfirmId(null)}
        />
      )}
      {deleteReportConfirmId && (
        <ConfirmModal
          title="Delete Report"
          message="Delete this report? This cannot be undone."
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => { deleteMutation.mutate(deleteReportConfirmId); setDeleteReportConfirmId(null); }}
          onCancel={() => setDeleteReportConfirmId(null)}
        />
      )}
    </div>
  );
};

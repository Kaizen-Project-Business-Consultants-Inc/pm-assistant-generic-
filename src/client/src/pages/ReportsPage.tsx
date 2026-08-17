import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  Clock,
  X,
  ChevronDown,
  FileBarChart,
  Shield,
  DollarSign,
  Users,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../services/api';
import { renderMarkdown } from '../utils/renderMarkdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Report {
  id: string;
  title: string;
  content: string;
  reportType: string;
  createdAt: string;
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
] as const;

const badgeColorMap: Record<string, string> = {
  'weekly-status': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  'risk-assessment': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  'budget-forecast': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  'resource-utilization': 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
};

const labelMap: Record<string, string> = {
  'weekly-status': 'Weekly Status',
  'risk-assessment': 'Risk Assessment',
  'budget-forecast': 'Budget Forecast',
  'resource-utilization': 'Resource Utilization',
};

// ---------------------------------------------------------------------------
// Helper: format a date string for display
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
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

// ---------------------------------------------------------------------------
// ReportViewerModal
// ---------------------------------------------------------------------------

const ReportViewerModal: React.FC<{
  report: Report;
  onClose: () => void;
}> = ({ report, onClose }) => {
  const badgeColor = badgeColorMap[report.reportType] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
  const typeLabel = labelMap[report.reportType] || report.reportType;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative w-full max-w-3xl max-h-[90vh] mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{report.title}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}>
                {typeLabel}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <Clock className="w-3 h-3" />
                {formatDate(report.createdAt)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-200"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(report.content)) }}
          />
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
  const [selectedType, setSelectedType] = useState(REPORT_TYPES[0].value);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Modal state
  const [viewingReport, setViewingReport] = useState<Report | null>(null);

  // ---- Queries ----

  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ['reportHistory'],
    queryFn: () => apiService.getReportHistory(),
  });

  const {
    data: projectsData,
    isLoading: projectsLoading,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const reports: Report[] = historyData?.reports || [];
  const projects: Project[] = projectsData?.data || projectsData?.projects || [];

  // ---- Mutation ----

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

  // ---- Loading state ----

  if (historyLoading || projectsLoading) {
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

          {/* Project selector (optional) */}
          <div>
            <label htmlFor="report-project" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Project (optional)
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
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="btn btn-primary flex items-center gap-2 w-full justify-center"
            >
              {generateMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating…
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
      {/* Report History                                                    */}
      {/* ----------------------------------------------------------------- */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          Report History
        </h2>

        {historyError ? (
          <div className="card text-center py-10">
            <p className="text-sm text-red-600">Failed to load report history.</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="card text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No reports yet</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Generate your first report using the form above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => {
              const badgeColor = badgeColorMap[report.reportType] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
              const typeLabel = labelMap[report.reportType] || report.reportType;

              return (
                <div
                  key={report.id}
                  className="card flex items-center justify-between gap-4 hover:shadow-md transition-shadow duration-200"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {report.title}
                    </h3>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}>
                        {typeLabel}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                        <Clock className="w-3 h-3" />
                        {formatDate(report.createdAt)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setViewingReport(report)}
                    className="btn flex items-center gap-1.5 text-sm flex-shrink-0"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    View
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Report Viewer Modal                                               */}
      {/* ----------------------------------------------------------------- */}
      {viewingReport && (
        <ReportViewerModal
          report={viewingReport}
          onClose={() => setViewingReport(null)}
        />
      )}
    </div>
  );
};

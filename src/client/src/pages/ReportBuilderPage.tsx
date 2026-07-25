import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileBarChart,
  Plus,
  Trash2,
  Eye,
  Activity,
  Clock,
  Lock,
} from 'lucide-react';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ReportDesigner } from '../components/reports/ReportDesigner';
import { ReportPreview } from '../components/reports/ReportPreview';
import { ReportScheduleModal } from '../components/reports/ReportScheduleModal';

type View = 'list' | 'designer' | 'preview';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
  sections: unknown[];
}

export const ReportBuilderPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('list');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const [scheduleTemplate, setScheduleTemplate] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['reportTemplates'],
    queryFn: () => apiService.getReportTemplates(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteReportTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportTemplates'] });
    },
  });

  const templates: ReportTemplate[] = data?.templates || data || [];
  const isSample: boolean = data?.sample || false;

  const handleNewReport = () => {
    setSelectedTemplateId(undefined);
    setView('designer');
  };

  const handleEdit = (id: string) => {
    setSelectedTemplateId(id);
    setView('designer');
  };

  const handleGenerate = (id: string) => {
    setSelectedTemplateId(id);
    setView('preview');
  };

  const handleDelete = (id: string) => setConfirmDeleteId(id);

  const handleDesignerClose = () => {
    setSelectedTemplateId(undefined);
    setView('list');
  };

  const handleDesignerSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['reportTemplates'] });
    setView('list');
    setSelectedTemplateId(undefined);
  };

  const handlePreviewClose = () => {
    setSelectedTemplateId(undefined);
    setView('list');
  };

  if (view === 'designer') {
    return (
      <ReportDesigner
        templateId={selectedTemplateId}
        onClose={handleDesignerClose}
        onSaved={handleDesignerSaved}
      />
    );
  }

  if (view === 'preview' && selectedTemplateId) {
    return (
      <ReportPreview
        templateId={selectedTemplateId}
        onClose={handlePreviewClose}
      />
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
            <FileBarChart className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Report Builder</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Create custom reports with KPIs, charts, and tables</p>
          </div>
        </div>
        {!isSample && (
          <button
            onClick={handleNewReport}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Report
          </button>
        )}
      </div>

      {/* Sample upgrade banner */}
      {isSample && (
        <div className="mb-6 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Report Templates</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                These are sample templates with demo data. Upgrade to a paid plan to create custom reports with KPIs, charts, and tables from your actual project data.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Failed to load report templates. Please try again.
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && templates.length === 0 && (
        <div className="text-center py-20">
          <FileBarChart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-1">No report templates yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Create your first custom report template to get started.</p>
          <button
            onClick={handleNewReport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Report
          </button>
        </div>
      )}

      {/* Template Grid */}
      {!isLoading && templates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary-500" />
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{template.name}</h3>
                </div>
                {template.isShared && (
                  <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Shared
                  </span>
                )}
              </div>

              {template.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{template.description}</p>
              )}

              <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                Created {new Date(template.createdAt).toLocaleDateString()}
                {template.sections && ` \u00b7 ${template.sections.length} section${template.sections.length !== 1 ? 's' : ''}`}
              </p>

              {!isSample && (
                <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                  <button
                    onClick={() => handleEdit(template.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleGenerate(template.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Generate
                  </button>
                  <button
                    onClick={() => setScheduleTemplate({ id: template.id, name: template.name })}
                    className="flex items-center justify-center p-1.5 text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
                    title="Schedule delivery"
                    aria-label="Schedule delivery"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    disabled={deleteMutation.isPending}
                    className="flex items-center justify-center p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    aria-label="Delete template"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {isSample && (
                <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <Lock className="w-3.5 h-3.5" />
                    Upgrade to use
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Schedule Modal */}
      {scheduleTemplate && (
        <ReportScheduleModal
          templateId={scheduleTemplate.id}
          templateName={scheduleTemplate.name}
          onClose={() => setScheduleTemplate(null)}
        />
      )}

      {/* Delete Confirmation */}
      {confirmDeleteId && (
        <ConfirmModal
          title="Delete Report Template"
          message="Are you sure you want to delete this report template?"
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => { deleteMutation.mutate(confirmDeleteId); setConfirmDeleteId(null); }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
};

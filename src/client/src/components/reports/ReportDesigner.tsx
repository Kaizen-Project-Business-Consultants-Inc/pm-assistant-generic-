import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  FileBarChart,
  BarChart3,
  LineChart,
  PieChart,
  Table2,
  Activity,
  ArrowLeft,
} from 'lucide-react';
import { apiService } from '../../services/api';

interface ReportDesignerProps {
  templateId?: string;
  onClose: () => void;
  onSaved: () => void;
}

type SectionType = 'kpi_card' | 'table' | 'bar_chart' | 'line_chart' | 'pie_chart';
type DataSource = 'projects' | 'tasks' | 'time_entries' | 'budgets';

interface ReportSection {
  id: string;
  title: string;
  type: SectionType;
  dataSource: DataSource;
  filters: {
    dateStart: string;
    dateEnd: string;
    projectId: string;
    status: string;
  };
  groupBy: string;
}

interface TemplateFormData {
  name: string;
  description: string;
  isShared: boolean;
  sections: ReportSection[];
  config: Record<string, unknown>;
}

const SECTION_TYPE_OPTIONS: { value: SectionType; label: string; icon: React.ReactNode }[] = [
  { value: 'kpi_card', label: 'KPI Card', icon: <Activity className="w-3.5 h-3.5" /> },
  { value: 'table', label: 'Table', icon: <Table2 className="w-3.5 h-3.5" /> },
  { value: 'bar_chart', label: 'Bar Chart', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { value: 'line_chart', label: 'Line Chart', icon: <LineChart className="w-3.5 h-3.5" /> },
  { value: 'pie_chart', label: 'Pie Chart', icon: <PieChart className="w-3.5 h-3.5" /> },
];

const DATA_SOURCE_OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'projects', label: 'Projects' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'time_entries', label: 'Time Entries' },
  { value: 'budgets', label: 'Budgets' },
];

const GROUP_BY_OPTIONS: Record<DataSource, { value: string; label: string }[]> = {
  projects: [
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
    { value: 'month', label: 'Month' },
  ],
  tasks: [
    { value: 'project', label: 'Project' },
    { value: 'assignee', label: 'Assignee' },
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ],
  time_entries: [
    { value: 'project', label: 'Project' },
    { value: 'resource', label: 'Resource' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ],
  budgets: [
    { value: 'project', label: 'Project' },
    { value: 'status', label: 'Status' },
    { value: 'month', label: 'Month' },
  ],
};

const STATUS_OPTIONS = ['', 'active', 'planning', 'on_hold', 'completed', 'cancelled'];

const TYPE_BADGE_COLORS: Record<SectionType, string> = {
  kpi_card: 'bg-emerald-100 text-emerald-700',
  table: 'bg-blue-100 text-blue-700',
  bar_chart: 'bg-orange-100 text-orange-700',
  line_chart: 'bg-purple-100 text-purple-700',
  pie_chart: 'bg-pink-100 text-pink-700',
};

function generateId(): string {
  return `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptySection(type: SectionType): ReportSection {
  return {
    id: generateId(),
    title: '',
    type,
    dataSource: 'tasks',
    filters: {
      dateStart: '',
      dateEnd: '',
      projectId: '',
      status: '',
    },
    groupBy: '',
  };
}

export function ReportDesigner({ templateId, onClose, onSaved }: ReportDesignerProps) {
  const [form, setForm] = useState<TemplateFormData>({
    name: '',
    description: '',
    isShared: false,
    sections: [],
    config: {},
  });
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Fetch existing template if editing
  const { data: existingTemplate, isLoading: templateLoading } = useQuery({
    queryKey: ['reportTemplate', templateId],
    queryFn: () => apiService.getReportTemplate(templateId!),
    enabled: !!templateId,
  });

  // Fetch projects for the project selector
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const projects = projectsData?.data || projectsData?.projects || projectsData || [];

  // Populate form when editing
  useEffect(() => {
    if (existingTemplate) {
      const t = existingTemplate.template || existingTemplate;
      setForm({
        name: t.name || '',
        description: t.description || '',
        isShared: t.isShared || false,
        config: t.config || {},
        sections: (t.sections || t.config?.sections || []).map((s: any) => ({
          id: s.id || generateId(),
          title: s.title || '',
          type: s.type || 'table',
          dataSource: s.dataSource || 'tasks',
          filters: {
            dateStart: s.filters?.dateStart || '',
            dateEnd: s.filters?.dateEnd || '',
            projectId: s.filters?.projectId || '',
            status: s.filters?.status || '',
          },
          groupBy: s.groupBy || '',
        })),
      });
    }
  }, [existingTemplate]);

  const saveMutation = useMutation({
    mutationFn: (data: TemplateFormData) => {
      const payload = {
        name: data.name,
        description: data.description,
        config: { sections: data.sections },
        isShared: data.isShared,
      };
      if (templateId) {
        return apiService.updateReportTemplate(templateId, payload as unknown as Record<string, unknown>);
      }
      return apiService.createReportTemplate(payload);
    },
    onSuccess: () => {
      onSaved();
    },
  });

  const handleSave = () => {
    if (!form.name.trim()) return;
    saveMutation.mutate(form);
  };

  const removeSection = (id: string) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== id),
    }));
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    setForm((prev) => {
      const newSections = [...prev.sections];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newSections.length) return prev;
      [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];
      return { ...prev, sections: newSections };
    });
  };

  const updateSection = (id: string, updates: Partial<ReportSection>) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, ...updates };
        // Reset groupBy if dataSource changed and current groupBy is invalid
        if (updates.dataSource && updates.dataSource !== s.dataSource) {
          const validOptions = GROUP_BY_OPTIONS[updates.dataSource].map((o) => o.value);
          if (!validOptions.includes(updated.groupBy)) {
            updated.groupBy = '';
          }
        }
        return updated;
      }),
    }));
  };

  const updateSectionFilter = (id: string, filterKey: keyof ReportSection['filters'], value: string) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === id ? { ...s, filters: { ...s.filters, [filterKey]: value } } : s
      ),
    }));
  };

  if (templateLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
          <FileBarChart className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {templateId ? 'Edit Report Template' : 'New Report Template'}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Configure sections with data sources, filters, and visualizations</p>
        </div>
      </div>

      {/* Template Info */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-6">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">Template Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Weekly Status Report"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Brief description of what this report covers..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isShared}
              onChange={(e) => setForm((prev) => ({ ...prev, isShared: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 dark:text-primary-400 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">Share this template with team members</span>
          </label>
        </div>
      </div>

      {/* Sections */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Report Sections ({form.sections.length})
          </h2>
          <div className="relative">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 rounded-lg hover:bg-primary-100 dark:bg-primary-900/40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Section
            </button>
            {showAddMenu && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 w-52">
                {SECTION_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setForm((prev) => ({
                        ...prev,
                        sections: [...prev.sections, createEmptySection(opt.value)],
                      }));
                      setShowAddMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {form.sections.length === 0 && (
          <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
            <Table2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">No sections yet. Add a section to start building your report.</p>
          </div>
        )}

        <div className="space-y-4">
          {form.sections.map((section, index) => (
            <div
              key={section.id}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4"
            >
              {/* Section Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-400 dark:text-gray-500">#{index + 1}</span>
                  <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${TYPE_BADGE_COLORS[section.type]}`}>
                    {SECTION_TYPE_OPTIONS.find((o) => o.value === section.type)?.label}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => moveSection(index, 'up')}
                    disabled={index === 0}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveSection(index, 'down')}
                    disabled={index === form.sections.length - 1}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeSection(section.id)}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Section Title */}
              <div className="mb-3">
                <label className="block text-xs uppercase font-medium text-gray-500 dark:text-gray-400 mb-1 tracking-wider">Section Title</label>
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) => updateSection(section.id, { title: e.target.value })}
                  placeholder="e.g. Task Completion by Status"
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>

              {/* Section Type + Data Source */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs uppercase font-medium text-gray-500 dark:text-gray-400 mb-1 tracking-wider">Type</label>
                  <select
                    value={section.type}
                    onChange={(e) => updateSection(section.id, { type: e.target.value as SectionType })}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-800"
                  >
                    {SECTION_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase font-medium text-gray-500 dark:text-gray-400 mb-1 tracking-wider">Data Source</label>
                  <select
                    value={section.dataSource}
                    onChange={(e) => updateSection(section.id, { dataSource: e.target.value as DataSource })}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-800"
                  >
                    {DATA_SOURCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase font-medium text-gray-500 dark:text-gray-400 mb-1 tracking-wider">Group By</label>
                  <select
                    value={section.groupBy}
                    onChange={(e) => updateSection(section.id, { groupBy: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-800"
                  >
                    <option value="">None</option>
                    {GROUP_BY_OPTIONS[section.dataSource].map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Filters */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <p className="text-xs uppercase font-medium text-gray-500 dark:text-gray-400 mb-2 tracking-wider">Filters</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Start Date</label>
                    <input
                      type="date"
                      value={section.filters.dateStart}
                      onChange={(e) => updateSectionFilter(section.id, 'dateStart', e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">End Date</label>
                    <input
                      type="date"
                      value={section.filters.dateEnd}
                      onChange={(e) => updateSectionFilter(section.id, 'dateEnd', e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Project</label>
                    <select
                      value={section.filters.projectId}
                      onChange={(e) => updateSectionFilter(section.id, 'projectId', e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-800"
                    >
                      <option value="">All Projects</option>
                      {projects.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Status</label>
                    <select
                      value={section.filters.status}
                      onChange={(e) => updateSectionFilter(section.id, 'status', e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-800"
                    >
                      <option value="">All Statuses</option>
                      {STATUS_OPTIONS.filter(Boolean).map((s) => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim() || saveMutation.isPending}
          className="px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saveMutation.isPending ? 'Saving...' : templateId ? 'Update Template' : 'Save Template'}
        </button>
      </div>

      {saveMutation.isError && (
        <p className="mt-3 text-xs text-red-600 text-right">
          Failed to save template. Please try again.
        </p>
      )}
    </div>
  );
}

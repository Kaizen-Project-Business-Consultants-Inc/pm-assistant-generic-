import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Search,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  TrendingUp,
  Database,
  RefreshCw,

  Edit2,
  Trash2,
  CheckCircle,
  Eye,
  Archive,
  Bot,
  User,
  Sparkles,
  ArrowUpCircle,
  BarChart3,
  MoreHorizontal,
} from 'lucide-react';
import { apiService } from '../services/api';
import { PatternCard } from '../components/lessons/PatternCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Lesson {
  id: string;
  title: string;
  description: string;
  category: string;
  impact: 'positive' | 'negative' | 'neutral';
  recommendation: string;
  rootCause?: string | null;
  severity?: 'low' | 'medium' | 'high' | 'critical' | null;
  recurrenceScore?: number;
  isElevated?: boolean;
  projectId?: string;
  projectName?: string;
  createdAt?: string;
  status?: 'draft' | 'reviewed' | 'approved' | 'archived';
  sourceType?: 'manual' | 'ai_extracted' | 'agent' | 'seeded';
  tags?: string[] | null;
  appliedCount?: number;
  effectivenessRating?: number | null;
}

interface Pattern {
  title: string;
  description: string;
  frequency: number;
  projectTypes: string[];
  category: string;
  recommendation: string;
  confidence: number;
}

interface Project {
  id: string;
  name: string;
  type?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'All',
  'Risk Management',
  'Schedule Management',
  'Cost Management',
  'Stakeholder Management',
  'Resource Management',
  'Communication',
  'Quality',
  'Scope Management',
  'Other',
];

const IMPACT_OPTIONS = [
  { value: 'positive', label: 'Positive', color: 'bg-green-100 text-green-700' },
  { value: 'negative', label: 'Negative', color: 'bg-red-100 text-red-700' },
  { value: 'neutral', label: 'Neutral', color: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200' },
];

const STATUS_FILTERS = ['All', 'draft', 'reviewed', 'approved', 'archived', 'pending_elevation'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function impactDot(impact: string) {
  const colors: Record<string, string> = {
    positive: 'bg-green-500',
    negative: 'bg-red-500',
    neutral: 'bg-gray-400',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[impact] || 'bg-gray-400'}`}
      title={impact}
    />
  );
}

function impactBadge(impact: string) {
  const colors: Record<string, string> = {
    positive: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    negative: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    neutral: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200',
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${colors[impact] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
    >
      {impact}
    </span>
  );
}

function statusBadge(status?: string) {
  const colors: Record<string, string> = {
    draft: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
    reviewed: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    approved: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    archived: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    pending_elevation: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  };
  if (!status) return null;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase border ${colors[status] || ''}`}>
      {status}
    </span>
  );
}

function sourceIcon(sourceType?: string) {
  switch (sourceType) {
    case 'ai_extracted': return <span title="AI Extracted"><Sparkles className="w-3 h-3 text-purple-500" /></span>;
    case 'agent': return <span title="Agent Generated"><Bot className="w-3 h-3 text-indigo-500" /></span>;
    case 'seeded': return <span title="Auto-seeded"><Database className="w-3 h-3 text-gray-400" /></span>;
    case 'manual': return <span title="Manual Entry"><User className="w-3 h-3 text-gray-400" /></span>;
    default: return null;
  }
}

function severityBadge(severity?: string | null) {
  if (!severity) return null;
  const colors: Record<string, string> = {
    critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    low: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${colors[severity] || ''}`}>
      {severity}
    </span>
  );
}

const SEVERITY_OPTIONS = ['', 'low', 'medium', 'high', 'critical'] as const;

// ---------------------------------------------------------------------------
// Add Lesson Modal
// ---------------------------------------------------------------------------

const AddLessonModal: React.FC<{
  projects: Project[];
  onClose: () => void;
  onSubmit: (data: any) => void;
  isSubmitting: boolean;
  initial?: { title: string; description: string; category: string; impact: string; recommendation: string; projectId: string; rootCause?: string; severity?: string };
  title?: string;
}> = ({ projects, onClose, onSubmit, isSubmitting, initial, title: modalTitle }) => {
  const [form, setForm] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    category: initial?.category || 'Other',
    impact: (initial?.impact || 'neutral') as 'positive' | 'negative' | 'neutral',
    recommendation: initial?.recommendation || '',
    rootCause: initial?.rootCause || '',
    severity: initial?.severity || '',
    projectId: initial?.projectId || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;
    onSubmit(form);
  };

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary-500" />
            {modalTitle || 'Add Lesson Learned'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} className="input w-full" placeholder="Brief title for the lesson..." required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} className="input w-full resize-y" rows={3} placeholder="Detailed description of what was learned..." required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Category</label>
            <div className="relative">
              <select value={form.category} onChange={(e) => update('category', e.target.value)} className="input w-full appearance-none pr-8">
                {CATEGORIES.filter((c) => c !== 'All').map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Impact</label>
            <div className="flex gap-2">
              {IMPACT_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => update('impact', opt.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${form.impact === opt.value ? `${opt.color} border-transparent ring-2 ring-primary-300` : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Recommendation</label>
            <textarea value={form.recommendation} onChange={(e) => update('recommendation', e.target.value)} className="input w-full resize-y" rows={2} placeholder="What should teams do differently..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Root Cause</label>
            <textarea value={form.rootCause} onChange={(e) => update('rootCause', e.target.value)} className="input w-full resize-y" rows={2} placeholder="Underlying reason this issue occurred..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Severity</label>
            <div className="relative">
              <select value={form.severity} onChange={(e) => update('severity', e.target.value)} className="input w-full appearance-none pr-8">
                {SEVERITY_OPTIONS.map((s) => (<option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'None'}</option>))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Project</label>
            <div className="relative">
              <select value={form.projectId} onChange={(e) => update('projectId', e.target.value)} className="input w-full appearance-none pr-8">
                <option value="">None</option>
                {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
          </div>
          <div className="pt-2">
            <button type="submit" disabled={!form.title.trim() || !form.description.trim() || isSubmitting}
              className="btn btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {isSubmitting ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</>) : (<><Plus className="w-4 h-4" />Add Lesson</>)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export const LessonsLearnedPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Project scope
  const [selectedProjectId, setSelectedProjectId] = useState('');

  // Filter state
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Expand/collapse state
  const [expandedLessons, setExpandedLessons] = useState<Set<string>>(new Set());
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showPMOReport, setShowPMOReport] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);

  // Pagination state
  const [allLessonsAccum, setAllLessonsAccum] = useState<Lesson[]>([]);
  const [lessonsTotal, setLessonsTotal] = useState(0);
  const [lessonsOffset, setLessonsOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const LESSONS_PAGE_SIZE = 20;

  const toggleLesson = (id: string) => {
    setExpandedLessons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- Queries ----

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const { data: lessonsData, isLoading: lessonsLoading } = useQuery({
    queryKey: ['lessons', selectedProjectId],
    queryFn: () => apiService.getLessons(LESSONS_PAGE_SIZE, 0, selectedProjectId || undefined),
    enabled: !!selectedProjectId,
  });

  // Reset pagination when project changes
  useEffect(() => {
    setAllLessonsAccum([]);
    setLessonsTotal(0);
    setLessonsOffset(0);
    setExpandedLessons(new Set());
  }, [selectedProjectId]);

  // Sync initial query into accumulated state
  useEffect(() => {
    if (lessonsData) {
      const items: Lesson[] = lessonsData.lessons || [];
      setAllLessonsAccum(items);
      setLessonsTotal(lessonsData.total ?? items.length);
      setLessonsOffset(items.length);
    }
  }, [lessonsData]);

  const { data: patternsData } = useQuery({
    queryKey: ['patterns'],
    queryFn: () => apiService.getPatterns(),
  });

  const { data: reportData, isLoading: reportLoading } = useQuery({
    queryKey: ['lessonsReport'],
    queryFn: () => apiService.getLessonsReport(),
    enabled: showPMOReport,
  });

  const projects: Project[] = projectsData?.data || projectsData?.projects || [];
  const allLessons: Lesson[] = allLessonsAccum;
  const patterns: Pattern[] = patternsData?.patterns || [];
  const report = reportData?.data;

  const handleLoadMoreLessons = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await apiService.getLessons(LESSONS_PAGE_SIZE, lessonsOffset, selectedProjectId || undefined);
      const items: Lesson[] = res?.lessons || [];
      setAllLessonsAccum(prev => [...prev, ...items]);
      setLessonsOffset(prev => prev + items.length);
      if (res?.total !== undefined) setLessonsTotal(res.total);
    } catch { /* non-critical */ }
    setLoadingMore(false);
  }, [lessonsOffset, selectedProjectId]);

  // ---- Filtered lessons ----

  const filteredLessons = useMemo(() => {
    return allLessons.filter((lesson) => {
      if (filterCategory !== 'All' && lesson.category !== filterCategory) return false;
      if (filterStatus !== 'All' && lesson.status !== filterStatus) return false;
      return true;
    });
  }, [allLessons, filterCategory, filterStatus]);

  // ---- Counts ----

  const draftCount = useMemo(() => allLessons.filter(l => l.status === 'draft').length, [allLessons]);
  const positiveCount = useMemo(() => allLessons.filter(l => l.impact === 'positive').length, [allLessons]);
  const negativeCount = useMemo(() => allLessons.filter(l => l.impact === 'negative').length, [allLessons]);

  // ---- Mutations ----

  const addLessonMutation = useMutation({
    mutationFn: (data: Parameters<typeof apiService.addLesson>[0]) => apiService.addLesson(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lessons'] }); setShowAddModal(false); },
  });

  const updateLessonMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiService.updateLesson(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lessons'] }); setEditingLesson(null); },
  });

  const deleteLessonMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteLesson(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lessons'] }); setConfirmDeleteId(null); },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiService.updateLessonStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lessons'] }); },
  });

  const elevateMutation = useMutation({
    mutationFn: (id: string) => apiService.elevateLesson(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lessons'] }); },
  });

  const extractLessonsMutation = useMutation({
    mutationFn: (projectId: string) => apiService.extractLessons(projectId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lessons'] }); queryClient.invalidateQueries({ queryKey: ['patterns'] }); },
  });

  const detectPatternsMutation = useMutation({
    mutationFn: () => apiService.detectPatterns(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['patterns'] }); },
  });

  const seedMutation = useMutation({
    mutationFn: () => apiService.seedLessons(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lessons'] }); queryClient.invalidateQueries({ queryKey: ['patterns'] }); },
  });

  const hasActiveFilters = filterCategory !== 'All' || filterStatus !== 'All';
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="space-y-4">
      {/* Header — title + project selector + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <BookOpen className="w-5 h-5 text-primary-500" />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Lessons Learned</h1>
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="input appearance-none pr-8 text-sm py-1.5"
            >
              <option value="">Select a project...</option>
              {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          </div>
          {/* Compact inline stats — only when project selected */}
          {selectedProjectId && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">{allLessons.length}</span> total
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-green-600 dark:text-green-400">{positiveCount}</span> positive
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-red-600 dark:text-red-400">{negativeCount}</span> negative
              {patterns.length > 0 && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-amber-600 dark:text-amber-400">{patterns.length}</span> patterns
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedProjectId && (
            <button onClick={() => setShowAddModal(true)} className="btn btn-primary flex items-center gap-1.5 text-sm">
              <Plus className="w-4 h-4" />
              Add Lesson
            </button>
          )}
          {/* Actions dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowActionsMenu(!showActionsMenu)}
              className="btn btn-secondary flex items-center gap-1.5 text-sm"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showActionsMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowActionsMenu(false)} />
                <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1">
                  <button
                    onClick={() => { seedMutation.mutate(); setShowActionsMenu(false); }}
                    disabled={seedMutation.isPending}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    <Database className="w-4 h-4 text-gray-400" />
                    Seed Knowledge Base
                  </button>
                  <button
                    onClick={() => { detectPatternsMutation.mutate(); setShowActionsMenu(false); }}
                    disabled={detectPatternsMutation.isPending}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4 text-gray-400" />
                    Detect Patterns
                  </button>
                  <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                  <button
                    onClick={() => { setShowPMOReport(!showPMOReport); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <BarChart3 className="w-4 h-4 text-gray-400" />
                    {showPMOReport ? 'Hide' : 'Show'} PMO Report
                  </button>
                  {patterns.length > 0 && (
                    <button
                      onClick={() => { setShowPatterns(!showPatterns); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <TrendingUp className="w-4 h-4 text-gray-400" />
                      {showPatterns ? 'Hide' : 'Show'} Patterns
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* No project selected — empty state */}
      {!selectedProjectId && (
        <div className="card text-center py-16">
          <BookOpen className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Select a project</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Choose a project above to view its lessons learned.
          </p>
        </div>
      )}

      {/* Mobile stats (visible only on small screens) */}
      {selectedProjectId && (
        <div className="flex sm:hidden items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-900 dark:text-white">{allLessons.length}</span> total
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="text-green-600 dark:text-green-400">{positiveCount}</span> positive
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="text-red-600 dark:text-red-400">{negativeCount}</span> negative
        </div>
      )}

      {/* Draft review banner */}
      {selectedProjectId && draftCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <Eye className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <p className="text-xs text-yellow-800 dark:text-yellow-300">
            <span className="font-semibold">{draftCount}</span> pending review
          </p>
          <button onClick={() => setFilterStatus('draft')} className="ml-auto text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline whitespace-nowrap">
            Show drafts
          </button>
        </div>
      )}

      {/* Extract lessons — uses selected project */}
      {selectedProjectId && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => extractLessonsMutation.mutate(selectedProjectId)}
            disabled={extractLessonsMutation.isPending}
            className="btn btn-secondary flex items-center gap-1.5 text-xs py-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
            {extractLessonsMutation.isPending ? <div className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin" /> : <Lightbulb className="w-3.5 h-3.5" />}
            Extract Lessons from {selectedProject?.name || 'Project'}
          </button>
          {extractLessonsMutation.isSuccess && <span className="text-xs text-green-600 font-medium">Extracted as drafts</span>}
          {seedMutation.isSuccess && <span className="text-xs text-green-600 font-medium">Knowledge base seeded</span>}
          {detectPatternsMutation.isSuccess && <span className="text-xs text-green-600 font-medium">Patterns detected</span>}
        </div>
      )}

      {/* PMO Report — toggled from actions menu */}
      {selectedProjectId && showPMOReport && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              PMO Lessons Report
            </h3>
            <button onClick={() => setShowPMOReport(false)} className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          {reportLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            </div>
          ) : report ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-2.5 text-center">
                  <p className="text-base font-bold text-gray-900 dark:text-white">{report.totalLessons}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">Total</p>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2.5 text-center">
                  <p className="text-base font-bold text-amber-700 dark:text-amber-300">{report.elevated}</p>
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 uppercase">Elevated</p>
                </div>
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-2.5 text-center">
                  <p className="text-base font-bold text-red-700 dark:text-red-300">{(report.bySeverity?.critical || 0) + (report.bySeverity?.high || 0)}</p>
                  <p className="text-[10px] text-red-600 dark:text-red-400 uppercase">High/Critical</p>
                </div>
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-2.5 text-center">
                  <p className="text-base font-bold text-green-700 dark:text-green-300">{report.byImpact?.positive || 0}</p>
                  <p className="text-[10px] text-green-600 dark:text-green-400 uppercase">Positive</p>
                </div>
              </div>
              {report.trendingCategories?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1.5">Trending (30 Days)</h4>
                  <div className="space-y-1">
                    {report.trendingCategories.filter((t: any) => t.recentCount > 0).slice(0, 5).map((t: any) => (
                      <div key={t.category} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600 dark:text-gray-300">{t.category}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 dark:text-gray-500">{t.count}</span>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400">+{t.recentCount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {report.elevatedLessons?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1.5 flex items-center gap-1.5">
                    <ArrowUpCircle className="w-3.5 h-3.5 text-amber-500" />
                    Elevated
                  </h4>
                  <div className="space-y-1">
                    {report.elevatedLessons.map((l: any) => (
                      <div key={l.id} className="flex items-center gap-2 text-xs rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800 px-3 py-1.5">
                        {severityBadge(l.severity)}
                        <span className="text-gray-900 dark:text-white font-medium truncate">{l.title}</span>
                        <span className="text-gray-400 dark:text-gray-500 ml-auto whitespace-nowrap">{l.projectName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">No report data available</p>
          )}
        </div>
      )}

      {/* Patterns section — toggled */}
      {selectedProjectId && showPatterns && patterns.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-500" />
              Detected Patterns
            </h2>
            <button onClick={() => setShowPatterns(false)} className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {patterns.map((pattern, idx) => (<PatternCard key={idx} pattern={pattern} />))}
          </div>
        </div>
      )}

      {/* Filter bar + lessons list */}
      {selectedProjectId && <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <div className="relative">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input appearance-none pr-7 text-xs py-1.5">
              {STATUS_FILTERS.map((s) => (<option key={s} value={s}>{s === 'All' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          </div>
          <div className="relative">
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="input appearance-none pr-7 text-xs py-1.5">
              {CATEGORIES.map((c) => (<option key={c} value={c}>{c === 'All' ? 'All Categories' : c}</option>))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500">{filteredLessons.length} lessons</span>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterCategory('All'); setFilterStatus('All'); }}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Lessons list */}
        {lessonsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : filteredLessons.length === 0 ? (
          <div className="card text-center py-10">
            <BookOpen className="mx-auto h-10 w-10 text-gray-300 mb-2" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No lessons found</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Add your first lesson or seed the knowledge base.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLessons.map((lesson) => {
              const isExpanded = expandedLessons.has(lesson.id);
              return (
                <div
                  key={lesson.id}
                  className={`card !py-0 !px-0 overflow-hidden transition-shadow duration-200 hover:shadow-md ${lesson.status === 'draft' ? 'border-l-4 border-l-yellow-400' : lesson.status === 'archived' ? 'opacity-60' : ''}`}
                >
                  {/* Collapsed row */}
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
                    onClick={() => toggleLesson(lesson.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLesson(lesson.id); } }}
                  >
                    <ChevronRight className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
                    {impactDot(lesson.impact)}
                    {sourceIcon(lesson.sourceType)}
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate flex-1 min-w-0">{lesson.title}</h3>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {lesson.isElevated && (
                        <span title="Elevated to org-wide"><ArrowUpCircle className="w-3.5 h-3.5 text-amber-500" /></span>
                      )}
                      {statusBadge(lesson.status)}
                      {severityBadge(lesson.severity)}
                      <span className="hidden sm:inline-block rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2 py-0.5 text-[10px] font-medium">
                        {lesson.category}
                      </span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-3 border-t border-gray-100 dark:border-gray-700">
                      <div className="pt-3 space-y-2">
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{lesson.description}</p>
                        {lesson.rootCause && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-semibold text-red-600 dark:text-red-400">Root Cause:</span> {lesson.rootCause}
                          </p>
                        )}
                        {lesson.recommendation && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-semibold text-amber-600 dark:text-amber-400">Recommendation:</span> {lesson.recommendation}
                          </p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                            {lesson.projectName && <span>Project: {lesson.projectName}</span>}
                            {(lesson.appliedCount ?? 0) > 0 && <span>Applied {lesson.appliedCount}x</span>}
                            {lesson.effectivenessRating != null && <span>Effectiveness: {lesson.effectivenessRating}%</span>}
                            <span className="sm:hidden rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2 py-0.5 text-[10px] font-medium">
                              {lesson.category}
                            </span>
                            {impactBadge(lesson.impact)}
                          </div>
                          <div className="flex items-center gap-0.5">
                            {lesson.status === 'draft' && (
                              <button onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: lesson.id, status: 'approved' }); }}
                                className="p-1.5 rounded text-green-500 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/30" title="Approve">
                                <CheckCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {lesson.status === 'approved' && !lesson.isElevated && (
                              <button onClick={(e) => { e.stopPropagation(); elevateMutation.mutate(lesson.id); }}
                                className="p-1.5 rounded text-amber-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30" title="Elevate to org-wide">
                                <ArrowUpCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {lesson.status === 'approved' && (
                              <button onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: lesson.id, status: 'archived' }); }}
                                className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" title="Archive">
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); setEditingLesson(lesson); }} className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(lesson.id); }} className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Load More + Count */}
        {lessonsTotal > 0 && (
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Showing {allLessons.length} of {lessonsTotal}</p>
            {allLessons.length < lessonsTotal && (
              <button onClick={handleLoadMoreLessons} disabled={loadingMore}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 border border-primary-200 hover:bg-primary-100 dark:hover:bg-primary-900/40 rounded-lg transition-colors disabled:opacity-50">
                {loadingMore ? <div className="w-3.5 h-3.5 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" /> : null}
                Load More
              </button>
            )}
          </div>
        )}
      </div>}

      {/* Add Lesson Modal */}
      {showAddModal && (
        <AddLessonModal projects={projects} onClose={() => setShowAddModal(false)} onSubmit={(data) => addLessonMutation.mutate(data)} isSubmitting={addLessonMutation.isPending} />
      )}

      {/* Edit Lesson Modal */}
      {editingLesson && (
        <AddLessonModal projects={projects}
          initial={{ title: editingLesson.title, description: editingLesson.description, category: editingLesson.category, impact: editingLesson.impact, recommendation: editingLesson.recommendation, rootCause: editingLesson.rootCause || '', severity: editingLesson.severity || '', projectId: editingLesson.projectId || '' }}
          title="Edit Lesson" onClose={() => setEditingLesson(null)} onSubmit={(data) => updateLessonMutation.mutate({ id: editingLesson.id, data })} isSubmitting={updateLessonMutation.isPending} />
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmDeleteId(null)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Delete Lesson</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Are you sure you want to delete this lesson? This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={() => deleteLessonMutation.mutate(confirmDeleteId)} disabled={deleteLessonMutation.isPending} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                {deleteLessonMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

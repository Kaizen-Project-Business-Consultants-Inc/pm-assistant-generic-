import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Search,
  Plus,
  X,
  ChevronDown,
  Lightbulb,
  TrendingUp,
  Database,
  RefreshCw,
  Brain,
  Edit2,
  Trash2,
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
  projectId?: string;
  projectName?: string;
  createdAt?: string;
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

const PROJECT_TYPES = [
  'All',
  'Construction',
  'IT',
  'Infrastructure',
  'Research',
  'Manufacturing',
  'Other',
];

const IMPACT_OPTIONS = [
  { value: 'positive', label: 'Positive', color: 'bg-green-100 text-green-700' },
  { value: 'negative', label: 'Negative', color: 'bg-red-100 text-red-700' },
  { value: 'neutral', label: 'Neutral', color: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Add Lesson Modal
// ---------------------------------------------------------------------------

const AddLessonModal: React.FC<{
  projects: Project[];
  onClose: () => void;
  onSubmit: (data: any) => void;
  isSubmitting: boolean;
  initial?: { title: string; description: string; category: string; impact: string; recommendation: string; projectId: string };
  title?: string;
}> = ({ projects, onClose, onSubmit, isSubmitting, initial, title: modalTitle }) => {
  const [form, setForm] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    category: initial?.category || 'Other',
    impact: (initial?.impact || 'neutral') as 'positive' | 'negative' | 'neutral',
    recommendation: initial?.recommendation || '',
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
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              className="input w-full"
              placeholder="Brief title for the lesson..."
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              className="input w-full resize-y"
              rows={3}
              placeholder="Detailed description of what was learned..."
              required
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Category</label>
            <div className="relative">
              <select
                value={form.category}
                onChange={(e) => update('category', e.target.value)}
                className="input w-full appearance-none pr-8"
              >
                {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
          </div>

          {/* Impact */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Impact</label>
            <div className="flex gap-2">
              {IMPACT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('impact', opt.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                    form.impact === opt.value
                      ? `${opt.color} border-transparent ring-2 ring-primary-300`
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recommendation */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Recommendation</label>
            <textarea
              value={form.recommendation}
              onChange={(e) => update('recommendation', e.target.value)}
              className="input w-full resize-y"
              rows={2}
              placeholder="What should teams do differently..."
            />
          </div>

          {/* Project */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Project</label>
            <div className="relative">
              <select
                value={form.projectId}
                onChange={(e) => update('projectId', e.target.value)}
                className="input w-full appearance-none pr-8"
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={!form.title.trim() || !form.description.trim() || isSubmitting}
              className="btn btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add Lesson
                </>
              )}
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

  // Filter state
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterProjectType, setFilterProjectType] = useState('All');

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Pagination state
  const [allLessonsAccum, setAllLessonsAccum] = useState<Lesson[]>([]);
  const [lessonsTotal, setLessonsTotal] = useState(0);
  const [lessonsOffset, setLessonsOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const LESSONS_PAGE_SIZE = 20;

  // Extract lessons selector
  const [extractProjectId, setExtractProjectId] = useState('');

  // ---- Queries ----

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const { data: lessonsData, isLoading: lessonsLoading } = useQuery({
    queryKey: ['lessons'],
    queryFn: () => apiService.getLessons(LESSONS_PAGE_SIZE, 0),
  });

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

  const projects: Project[] = projectsData?.data || projectsData?.projects || [];
  const allLessons: Lesson[] = allLessonsAccum;
  const patterns: Pattern[] = patternsData?.patterns || [];

  const handleLoadMoreLessons = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await apiService.getLessons(LESSONS_PAGE_SIZE, lessonsOffset);
      const items: Lesson[] = res?.lessons || [];
      setAllLessonsAccum(prev => [...prev, ...items]);
      setLessonsOffset(prev => prev + items.length);
      if (res?.total !== undefined) setLessonsTotal(res.total);
    } catch { /* non-critical */ }
    setLoadingMore(false);
  }, [lessonsOffset]);

  // ---- Filtered lessons ----

  const filteredLessons = useMemo(() => {
    return allLessons.filter((lesson) => {
      if (filterCategory !== 'All' && lesson.category !== filterCategory) return false;
      // Project type filtering (if lesson has project type info)
      if (filterProjectType !== 'All') {
        const proj = projects.find((p) => p.id === lesson.projectId);
        if (proj && proj.type && proj.type !== filterProjectType) return false;
      }
      return true;
    });
  }, [allLessons, filterCategory, filterProjectType, projects]);

  // ---- Category breakdown ----

  const categoryBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    allLessons.forEach((l) => {
      counts[l.category] = (counts[l.category] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [allLessons]);

  // ---- Mutations ----

  const addLessonMutation = useMutation({
    mutationFn: (data: Parameters<typeof apiService.addLesson>[0]) => apiService.addLesson(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      setShowAddModal(false);
    },
  });

  const updateLessonMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiService.updateLesson(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      setEditingLesson(null);
    },
  });

  const deleteLessonMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteLesson(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      setConfirmDeleteId(null);
    },
  });

  const extractLessonsMutation = useMutation({
    mutationFn: (projectId: string) => apiService.extractLessons(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
    },
  });

  const detectPatternsMutation = useMutation({
    mutationFn: () => apiService.detectPatterns(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
    },
  });

  const seedMutation = useMutation({
    mutationFn: () => apiService.seedLessons(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary-500" />
            Lessons Learned
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Knowledge base of project lessons, patterns, and recommendations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="btn btn-secondary flex items-center gap-1.5 text-sm"
          >
            {seedMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            Seed Knowledge Base
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary flex items-center gap-1.5 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Lesson
          </button>
        </div>
      </div>

      {/* Dashboard cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total lessons */}
        <div className="card flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{allLessons.length}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Lessons</p>
          </div>
        </div>

        {/* Category breakdown */}
        <div className="card">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide mb-2">
            Categories
          </p>
          {categoryBreakdown.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">No data</p>
          ) : (
            <div className="space-y-1.5">
              {categoryBreakdown.slice(0, 5).map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-600 dark:text-gray-300 truncate">{cat}</span>
                      <span className="text-gray-500 dark:text-gray-400 font-medium">{count}</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full"
                        style={{
                          width: `${allLessons.length > 0 ? (count / allLessons.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Patterns */}
        <div className="card flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center">
            <Brain className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{patterns.length}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Patterns Detected</p>
          </div>
        </div>
      </div>

      {/* Action buttons row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Extract lessons */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={extractProjectId}
              onChange={(e) => setExtractProjectId(e.target.value)}
              className="input appearance-none pr-8 text-sm py-1.5"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          </div>
          <button
            onClick={() => {
              if (extractProjectId) extractLessonsMutation.mutate(extractProjectId);
            }}
            disabled={!extractProjectId || extractLessonsMutation.isPending}
            className="btn btn-secondary flex items-center gap-1.5 text-sm py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {extractLessonsMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin" />
            ) : (
              <Lightbulb className="w-4 h-4" />
            )}
            Extract Lessons
          </button>
        </div>

        {/* Detect patterns */}
        <button
          onClick={() => detectPatternsMutation.mutate()}
          disabled={detectPatternsMutation.isPending}
          className="btn btn-secondary flex items-center gap-1.5 text-sm py-1.5"
        >
          {detectPatternsMutation.isPending ? (
            <div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Detect Patterns
        </button>

        {/* Success messages */}
        {extractLessonsMutation.isSuccess && (
          <span className="text-xs text-green-600 font-medium">Lessons extracted.</span>
        )}
        {detectPatternsMutation.isSuccess && (
          <span className="text-xs text-green-600 font-medium">Patterns detected.</span>
        )}
        {seedMutation.isSuccess && (
          <span className="text-xs text-green-600 font-medium">Knowledge base seeded.</span>
        )}
      </div>

      {/* Patterns section */}
      {patterns.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-amber-500" />
            Detected Patterns
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {patterns.map((pattern, idx) => (
              <PatternCard key={idx} pattern={pattern} />
            ))}
          </div>
        </div>
      )}

      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Filters:</span>
        </div>

        {/* Project type filter */}
        <div className="relative">
          <select
            value={filterProjectType}
            onChange={(e) => setFilterProjectType(e.target.value)}
            className="input appearance-none pr-8 text-sm py-1.5"
          >
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'All' ? 'All Project Types' : t}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        </div>

        {/* Category filter */}
        <div className="relative">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="input appearance-none pr-8 text-sm py-1.5"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === 'All' ? 'All Categories' : c}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        </div>

        <span className="text-xs text-gray-400 dark:text-gray-500">{filteredLessons.length} lessons</span>
      </div>

      {/* Lessons list */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          Lessons
        </h2>

        {lessonsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : filteredLessons.length === 0 ? (
          <div className="card text-center py-12">
            <BookOpen className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No lessons found</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Add your first lesson or seed the knowledge base to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLessons.map((lesson) => (
              <div
                key={lesson.id}
                className="card hover:shadow-md transition-shadow duration-200"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{lesson.title}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {impactBadge(lesson.impact)}
                    <span className="inline-block rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2 py-0.5 text-xs font-medium">
                      {lesson.category}
                    </span>
                    <button onClick={() => setEditingLesson(lesson)} className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setConfirmDeleteId(lesson.id)} className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-2">{lesson.description}</p>
                {lesson.recommendation && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 px-3 py-2 mb-2">
                    <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                      <span>{lesson.recommendation}</span>
                    </p>
                  </div>
                )}
                {lesson.projectName && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Project: {lesson.projectName}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Load More + Count */}
        {lessonsTotal > 0 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">Showing {allLessons.length} of {lessonsTotal}</p>
            {allLessons.length < lessonsTotal && (
              <button
                onClick={handleLoadMoreLessons}
                disabled={loadingMore}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 border border-primary-200 hover:bg-primary-100 dark:bg-primary-900/40 rounded-lg transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <div className="w-3.5 h-3.5 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
                ) : null}
                Load More
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add Lesson Modal */}
      {showAddModal && (
        <AddLessonModal
          projects={projects}
          onClose={() => setShowAddModal(false)}
          onSubmit={(data) => addLessonMutation.mutate(data)}
          isSubmitting={addLessonMutation.isPending}
        />
      )}

      {/* Edit Lesson Modal */}
      {editingLesson && (
        <AddLessonModal
          projects={projects}
          initial={{
            title: editingLesson.title,
            description: editingLesson.description,
            category: editingLesson.category,
            impact: editingLesson.impact,
            recommendation: editingLesson.recommendation,
            projectId: editingLesson.projectId || '',
          }}
          title="Edit Lesson"
          onClose={() => setEditingLesson(null)}
          onSubmit={(data) => updateLessonMutation.mutate({ id: editingLesson.id, data })}
          isSubmitting={updateLessonMutation.isPending}
        />
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

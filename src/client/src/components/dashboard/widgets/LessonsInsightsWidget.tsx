import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, TrendingUp, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../../../services/api';

interface Lesson {
  id: string;
  title: string;
  category: string;
  impact: string;
  recommendation: string;
  projectName?: string;
}

interface Pattern {
  pattern: string;
  frequency: number;
  category: string;
  recommendation: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  schedule: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  budget: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  resource: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  technical: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  stakeholder: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  risk: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export function LessonsInsightsWidget() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: lessonsData, isLoading: lessonsLoading } = useQuery({
    queryKey: ['lessons-widget'],
    queryFn: () => apiService.getLessons(5, 0),
    staleTime: 120_000,
  });

  const { data: patternsData, isLoading: patternsLoading } = useQuery({
    queryKey: ['lessons-patterns-widget'],
    queryFn: () => apiService.detectPatterns(),
    staleTime: 300_000,
  });

  const isLoading = lessonsLoading || patternsLoading;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-gray-300 dark:text-gray-600" />
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700/50 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const lessons: Lesson[] = (lessonsData?.lessons || []).slice(0, 5);
  const patterns: Pattern[] = (patternsData?.patterns || []).slice(0, 3);
  const hasContent = lessons.length > 0 || patterns.length > 0;

  if (!hasContent) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Lessons & Insights</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
          No lessons captured yet. Complete a project to start building your knowledge base.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Lessons & Insights</h3>
        </div>
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Knowledge Base</span>
      </div>

      {/* Patterns section */}
      {patterns.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Trending Patterns</span>
          </div>
          <div className="space-y-1.5">
            {patterns.map((p, i) => (
              <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-amber-50/50 dark:bg-amber-900/10">
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">{p.frequency}x</span>
                <span className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2">{p.pattern}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent lessons */}
      {lessons.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="h-3.5 w-3.5 text-primary-500" />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Recent Lessons</span>
          </div>
          <div className="space-y-1">
            {lessons.map(lesson => (
              <button
                key={lesson.id}
                type="button"
                onClick={() => setExpanded(expanded === lesson.id ? null : lesson.id)}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-800 dark:text-gray-200 font-medium truncate">{lesson.title}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[lesson.category] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                      {lesson.category}
                    </span>
                    {expanded === lesson.id ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
                  </div>
                </div>
                {expanded === lesson.id && (
                  <div className="mt-1.5 space-y-1">
                    {lesson.projectName && (
                      <p className="text-[10px] text-gray-400">From: {lesson.projectName}</p>
                    )}
                    <p className="text-xs text-gray-600 dark:text-gray-400">{lesson.recommendation}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

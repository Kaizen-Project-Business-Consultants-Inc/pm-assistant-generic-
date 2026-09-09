import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { BookOpen, ChevronDown, ChevronRight, Lightbulb, ArrowUpCircle, ThumbsUp, X } from 'lucide-react';
import { apiService } from '../../services/api';

interface LessonsPanelProps {
  projectId: string;
  category?: string;
}

interface Lesson {
  id: string;
  title: string;
  description: string;
  category: string;
  impact: string;
  recommendation: string;
  severity?: string | null;
  isElevated?: boolean;
  confidence?: number;
  projectName?: string;
}

export function LessonsPanel({ projectId, category }: LessonsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['relevantLessons', projectId, category],
    queryFn: () => apiService.getRelevantLessons(undefined, category),
    staleTime: 5 * 60 * 1000,
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ lessonId, action }: { lessonId: string; action: 'helpful' | 'dismissed' }) =>
      apiService.submitLessonFeedback(lessonId, action, undefined, category || 'general'),
  });

  const handleDismiss = (lessonId: string) => {
    setDismissed(prev => new Set(prev).add(lessonId));
    feedbackMutation.mutate({ lessonId, action: 'dismissed' });
  };

  const handleHelpful = (lessonId: string) => {
    feedbackMutation.mutate({ lessonId, action: 'helpful' });
  };

  const lessons: Lesson[] = (data?.lessons || []).filter((l: Lesson) => !dismissed.has(l.id));
  if (lessons.length === 0) return null;

  const shown = expanded ? lessons : lessons.slice(0, 3);

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        type="button"
      >
        <BookOpen className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide flex-1">
          Lessons from Past Projects ({lessons.length})
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-amber-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-amber-500" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {shown.map((lesson) => (
            <div
              key={lesson.id}
              className={`rounded-md bg-white dark:bg-gray-800 border px-3 py-2 ${
                lesson.isElevated
                  ? 'border-amber-300 dark:border-amber-700'
                  : 'border-gray-200 dark:border-gray-600'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {lesson.isElevated && (
                  <span title="Elevated to org-wide"><ArrowUpCircle className="w-3 h-3 text-amber-500 flex-shrink-0" /></span>
                )}
                <span className="text-xs font-medium text-gray-900 dark:text-white truncate flex-1">
                  {lesson.title}
                </span>
                {lesson.severity && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                    lesson.severity === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    lesson.severity === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                    lesson.severity === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                    'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}>
                    {lesson.severity}
                  </span>
                )}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleHelpful(lesson.id); }}
                    className="p-0.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors"
                    title="Helpful"
                  >
                    <ThumbsUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDismiss(lesson.id); }}
                    className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                    title="Not relevant"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {lesson.recommendation && (
                <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                  <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
                  <span>{lesson.recommendation}</span>
                </p>
              )}
              {lesson.projectName && (
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">From: {lesson.projectName}</p>
              )}
            </div>
          ))}
          {lessons.length > 3 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-amber-700 dark:text-amber-300 hover:underline"
            >
              Show {lessons.length - 3} more...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

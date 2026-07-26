import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, FileText } from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../../services/api';
import { renderMarkdown } from '../../utils/renderMarkdown';

interface ProjectBriefCardProps {
  projectId: string;
  description: string | null | undefined;
  canEdit: boolean;
  cardClass: string;
}

export function ProjectBriefCard({ projectId, description, canEdit, cardClass }: ProjectBriefCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft when description changes externally (and we're not editing)
  useEffect(() => {
    if (!editing) {
      setDraft(description ?? '');
    }
  }, [description, editing]);

  // Auto-resize textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [editing, draft]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const mutation = useMutation({
    mutationFn: (desc: string) => apiService.updateProject(projectId, { description: desc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: () => {
      setSaveStatus('idle');
    },
  });

  const scheduleSave = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSaveStatus('saving');
      mutation.mutate(value);
    }, 1500);
  }, [mutation]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (value: string) => {
    setDraft(value);
    scheduleSave(value);
  };

  const exitEdit = () => {
    setEditing(false);
    // Flush any pending save immediately
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      if (draft !== (description ?? '')) {
        setSaveStatus('saving');
        mutation.mutate(draft);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      exitEdit();
    }
  };

  const isEmpty = !draft.trim();

  return (
    <div className={`${cardClass} ${editing ? 'ring-2 ring-primary-400 dark:ring-primary-600' : ''} group relative`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Project Brief</h3>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && (
            <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-green-500 dark:text-green-400">Saved</span>
          )}
          {canEdit && !editing && !isEmpty && (
            <button
              onClick={() => setEditing(true)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Edit brief"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Edit mode */}
      {editing && (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={exitEdit}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-sm text-gray-700 dark:text-gray-200 leading-relaxed resize-none outline-none font-mono placeholder-gray-400 dark:placeholder-gray-500 min-h-[100px]"
          placeholder="Write your project brief using markdown..."
        />
      )}

      {/* View mode */}
      {!editing && !isEmpty && (
        <div
          className={`prose-sm max-w-none ${canEdit ? 'cursor-pointer' : ''}`}
          onClick={canEdit ? () => setEditing(true) : undefined}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(draft)) }}
        />
      )}

      {/* Empty state */}
      {!editing && isEmpty && (
        <div
          className={`flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500 ${canEdit ? 'cursor-pointer hover:text-gray-500 dark:hover:text-gray-400' : ''}`}
          onClick={canEdit ? () => setEditing(true) : undefined}
        >
          <FileText className="w-8 h-8 mb-2" />
          <span className="text-sm">
            {canEdit ? 'Click to add a project brief...' : 'No project brief yet.'}
          </span>
        </div>
      )}
    </div>
  );
}

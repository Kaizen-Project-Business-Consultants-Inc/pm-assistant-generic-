import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, FileText, Bold, Italic, Heading2, List, Link2, Code } from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../../services/api';
import { renderMarkdown } from '../../utils/renderMarkdown';
import { sendWsMessage } from '../../hooks/useWebSocket';

interface ProjectBriefCardProps {
  projectId: string;
  description: string | null | undefined;
  canEdit: boolean;
  cardClass: string;
  presenceEditors?: { userId: string; username: string; field: string }[];
  currentUserId?: string;
  updatedAt?: string;
}

export function ProjectBriefCard({ projectId, description, canEdit, cardClass, presenceEditors, currentUserId, updatedAt }: ProjectBriefCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for unmount flush (N1) and optimistic locking (P2)
  const draftRef = useRef(draft);
  const descriptionRef = useRef(description ?? '');
  const updatedAtRef = useRef(updatedAt);

  // Keep refs in sync
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { descriptionRef.current = description ?? ''; }, [description]);
  useEffect(() => { updatedAtRef.current = updatedAt; }, [updatedAt]);

  // Other users editing the brief (exclude self)
  const otherBriefEditors = (presenceEditors || []).filter(
    (e) => e.field === 'description' && e.userId !== currentUserId
  );

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

  // Send presence editing signals
  useEffect(() => {
    if (editing) {
      sendWsMessage({ type: 'presence:editing', field: 'description' });
    } else {
      sendWsMessage({ type: 'presence:stop_editing' });
    }
  }, [editing]);

  const mutation = useMutation({
    mutationFn: (payload: { description: string; expectedUpdatedAt?: string }) =>
      apiService.updateProject(projectId, payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      // Update updatedAt ref from response for next save
      const newUpdatedAt = data?.project?.updatedAt || data?.project?.updated_at;
      if (newUpdatedAt) updatedAtRef.current = newUpdatedAt;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        setSaveStatus('conflict');
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 5000);
      }
    },
  });

  const doSave = useCallback((value: string) => {
    setSaveStatus('saving');
    const payload: { description: string; expectedUpdatedAt?: string } = { description: value };
    if (updatedAtRef.current) payload.expectedUpdatedAt = updatedAtRef.current;
    mutation.mutate(payload);
  }, [mutation]);

  const scheduleSave = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSave(value);
    }, 1500);
  }, [doSave]);

  // Cleanup debounce on unmount — flush pending save (N1)
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        // Flush: if draft differs from last-known description, save it
        if (draftRef.current !== descriptionRef.current) {
          const payload: Record<string, string> = { description: draftRef.current };
          if (updatedAtRef.current) payload.expectedUpdatedAt = updatedAtRef.current;
          apiService.updateProject(projectId, payload).catch(() => {});
        }
      }
    };
  }, [projectId]);

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
        doSave(draft);
      }
    }
  };

  // N4: Escape cancels without saving
  const cancelEdit = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDraft(description ?? '');
    setEditing(false);
  };

  const enterEdit = () => {
    if (canEdit) setEditing(true);
  };

  // N3: Keyboard handler for view-mode divs
  const handleViewKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterEdit();
    }
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = draft.slice(start, end) || placeholder;
    const newText = draft.slice(0, start) + before + selected + after + draft.slice(end);
    handleChange(newText);
    // Restore cursor around the inserted/selected text
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + selected.length;
    });
  };

  const insertLinePrefix = (prefix: string, placeholder: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    // Find the beginning of the current line
    const lineStart = draft.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = draft.indexOf('\n', start);
    const currentLine = draft.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const newLine = currentLine.trim() ? `${prefix}${currentLine}` : `${prefix}${placeholder}`;
    const newText = draft.slice(0, lineStart) + newLine + draft.slice(lineEnd === -1 ? draft.length : lineEnd);
    handleChange(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = lineStart + prefix.length;
      ta.selectionEnd = lineStart + newLine.length;
    });
  };

  const toolbarButtons = [
    { icon: Bold, title: 'Bold (Ctrl+B)', action: () => wrapSelection('**', '**', 'bold text') },
    { icon: Italic, title: 'Italic (Ctrl+I)', action: () => wrapSelection('*', '*', 'italic text') },
    { icon: Heading2, title: 'Heading', action: () => insertLinePrefix('## ', 'Heading') },
    { icon: List, title: 'Bullet list', action: () => insertLinePrefix('- ', 'List item') },
    { icon: Link2, title: 'Link', action: () => wrapSelection('[', '](url)', 'link text') },
    { icon: Code, title: 'Inline code', action: () => wrapSelection('`', '`', 'code') },
  ];

  const isEmpty = !draft.trim();

  return (
    <div className={`${cardClass} ${editing ? 'ring-2 ring-primary-400 dark:ring-primary-600' : ''} group relative`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Project Brief</h3>
        <div className="flex items-center gap-2">
          {otherBriefEditors.length > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="truncate max-w-[120px] sm:max-w-none">{otherBriefEditors.map((e) => e.username).join(', ')}</span> editing
            </span>
          )}
          {saveStatus === 'saving' && (
            <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-green-500 dark:text-green-400">Saved</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
              Save failed
              <button onClick={() => doSave(draft)} className="underline">Retry</button>
            </span>
          )}
          {saveStatus === 'conflict' && (
            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              Someone else saved
              <button onClick={() => { queryClient.invalidateQueries({ queryKey: ['project', projectId] }); setSaveStatus('idle'); }} className="underline">Refresh</button>
            </span>
          )}
          {canEdit && !editing && !isEmpty && (
            <button
              onClick={enterEdit}
              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Edit brief"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Edit mode */}
      {editing && (
        <div>
          <div className="flex flex-wrap items-center gap-0.5 mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
            {toolbarButtons.map(({ icon: Icon, title, action }) => (
              <button
                key={title}
                type="button"
                title={title}
                onMouseDown={(e) => { e.preventDefault(); action(); }}
                className="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={exitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { cancelEdit(); return; }
              if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); wrapSelection('**', '**', 'bold text'); return; }
              if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); wrapSelection('*', '*', 'italic text'); return; }
            }}
            className="w-full bg-transparent text-sm text-gray-700 dark:text-gray-200 leading-relaxed resize-none outline-none font-mono placeholder-gray-400 dark:placeholder-gray-500 min-h-[100px] max-h-[50vh] overflow-y-auto"
            placeholder="Write your project brief using markdown..."
          />
        </div>
      )}

      {/* View mode */}
      {!editing && !isEmpty && (
        <div
          className={`prose-sm max-w-none ${canEdit ? 'cursor-pointer' : ''}`}
          onClick={canEdit ? enterEdit : undefined}
          tabIndex={canEdit ? 0 : undefined}
          role={canEdit ? 'button' : undefined}
          aria-label={canEdit ? 'Edit project brief' : undefined}
          onKeyDown={canEdit ? handleViewKeyDown : undefined}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(draft)) }}
        />
      )}

      {/* Empty state */}
      {!editing && isEmpty && (
        <div
          className={`flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500 ${canEdit ? 'cursor-pointer hover:text-gray-500 dark:hover:text-gray-400' : ''}`}
          onClick={canEdit ? enterEdit : undefined}
          tabIndex={canEdit ? 0 : undefined}
          role={canEdit ? 'button' : undefined}
          aria-label={canEdit ? 'Add project brief' : undefined}
          onKeyDown={canEdit ? handleViewKeyDown : undefined}
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

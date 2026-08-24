import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, FileText, Bold, Italic, Heading2, List, Link2, Code } from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../../services/api';
import { renderMarkdown } from '../../utils/renderMarkdown';
import { analyzeReadingLevel } from '../../utils/readingLevel';
import { sendWsMessage, useConnectionState } from '../../hooks/useWebSocket';
import { PresenceIndicator } from '../presence/PresenceIndicator';
import { ReadingLevelBadge } from '../accessibility/ReadingLevelBadge';

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
  const [recoveredDraft, setRecoveredDraft] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);

  // Reading level badge (computed from current description, not draft)
  const readingLevel = useMemo(() => {
    const text = description?.trim();
    if (!text || text.length < 20) return null;
    return analyzeReadingLevel(text);
  }, [description]);

  // Refs for unmount flush and optimistic locking
  const draftRef = useRef(draft);
  const descriptionRef = useRef(description ?? '');
  const updatedAtRef = useRef(updatedAt);

  // Keep refs in sync
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { descriptionRef.current = description ?? ''; }, [description]);
  useEffect(() => { updatedAtRef.current = updatedAt; }, [updatedAt]);

  // F5: Re-send editing state on reconnect
  const wsConnectionState = useConnectionState();

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

  // F5: Send presence editing signals — re-fire on reconnect
  useEffect(() => {
    if (wsConnectionState !== 'connected') return;
    if (editing) {
      sendWsMessage({ type: 'presence:editing', field: 'description' });
    } else {
      sendWsMessage({ type: 'presence:stop_editing' });
    }
  }, [editing, wsConnectionState]);

  // F4: SessionStorage recovery on mount — only if draft differs from server
  const STORAGE_KEY = `brief-draft-${projectId}`;
  useEffect(() => {
    const recovered = sessionStorage.getItem(STORAGE_KEY);
    if (recovered !== null && canEdit && recovered !== (description ?? '')) {
      setRecoveredDraft(recovered);
    } else if (recovered !== null) {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [projectId]);

  // F4: Unmount flush — persist draft to sessionStorage, attempt save
  useEffect(() => {
    return () => {
      if (draftRef.current !== descriptionRef.current) {
        sessionStorage.setItem(STORAGE_KEY, draftRef.current);
        const payload: Record<string, string> = { description: draftRef.current };
        if (updatedAtRef.current) payload.expectedUpdatedAt = updatedAtRef.current;
        apiService.updateProject(projectId, payload)
          .then(() => { sessionStorage.removeItem(STORAGE_KEY); })
          .catch(() => { /* draft stays in sessionStorage for recovery */ });
      }
    };
  }, [projectId]);

  // F4: beforeunload warning when editing with unsaved changes
  useEffect(() => {
    if (!editing) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (draftRef.current !== descriptionRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editing]);

  const mutation = useMutation({
    mutationFn: (payload: { description: string; expectedUpdatedAt?: string }) =>
      apiService.updateProject(projectId, payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      const newUpdatedAt = data?.project?.updatedAt || data?.project?.updated_at;
      if (newUpdatedAt) updatedAtRef.current = newUpdatedAt;
      sessionStorage.removeItem(STORAGE_KEY);
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

  // 2.3: Debounced checkpoint to sessionStorage (crash protection, no network)
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChange = (value: string) => {
    setDraft(value);
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    checkpointTimerRef.current = setTimeout(() => {
      if (value !== (description ?? '')) {
        sessionStorage.setItem(STORAGE_KEY, value);
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }, 2000);
  };

  // F2: Save on blur (explicit exit), skip if cancelled
  const exitEdit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    setEditing(false);
    if (draft !== (description ?? '')) {
      doSave(draft);
    }
  };

  // F2: Escape cancels — honest revert, nothing was saved mid-edit
  const cancelEdit = () => {
    cancelledRef.current = true;
    setDraft(description ?? '');
    setEditing(false);
  };

  const enterEdit = () => {
    if (canEdit) setEditing(true);
  };

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
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Project Brief</h3>
          {readingLevel && <ReadingLevelBadge score={readingLevel.score} level={readingLevel.level} grade={readingLevel.grade} />}
        </div>
        <div className="flex items-center gap-2">
          {otherBriefEditors.length > 0 && (
            <PresenceIndicator variant="chip" users={otherBriefEditors} />
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

      {/* Draft recovery bar */}
      {recoveredDraft !== null && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm">
          <span className="text-amber-800 dark:text-amber-300 flex-1">Restored unsaved changes from earlier</span>
          <button
            onClick={() => { setDraft(recoveredDraft); setEditing(true); setRecoveredDraft(null); sessionStorage.removeItem(STORAGE_KEY); }}
            className="px-2 py-1 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700"
          >
            Keep
          </button>
          <button
            onClick={() => { setRecoveredDraft(null); sessionStorage.removeItem(STORAGE_KEY); }}
            className="px-2 py-1 text-xs font-medium rounded text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/30"
          >
            Discard
          </button>
        </div>
      )}

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
          onClick={canEdit ? (e) => {
            if ((e.target as HTMLElement).closest('a')) return;
            enterEdit();
          } : undefined}
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

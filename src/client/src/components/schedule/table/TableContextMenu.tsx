import React from 'react';
import { PlusCircle, Pencil, Trash2, CornerDownLeft, CornerDownRight } from 'lucide-react';
import type { GanttTask } from './types';

interface TableContextMenuProps {
  x: number;
  y: number;
  task: GanttTask;
  selectedIds: Set<string>;
  visibleSorted: GanttTask[];
  onInsertBefore?: (taskId: string, parentTaskId?: string) => void;
  onInsertAfter?: (taskId: string, parentTaskId?: string) => void;
  onInlineInsert?: (afterTaskId: string, parentTaskId?: string) => void;
  onTaskClick: (task: GanttTask) => void;
  onOutdent: (taskId: string) => void;
  onIndent: (taskId: string, aboveTaskId: string) => void;
  onDelete: (taskIds: string[]) => void;
  onClose: () => void;
}

export const TableContextMenu = React.memo(function TableContextMenu({
  x,
  y,
  task,
  selectedIds,
  visibleSorted,
  onInsertBefore,
  onInsertAfter,
  onInlineInsert,
  onTaskClick,
  onOutdent,
  onIndent,
  onDelete,
  onClose,
}: TableContextMenuProps) {
  const idx = visibleSorted.findIndex(t => t.id === task.id);

  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {onInsertBefore && (
        <button
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onInsertBefore(task.id, task.parentTaskId || undefined); onClose(); }}
        >
          <PlusCircle className="w-3.5 h-3.5" /> Insert Before
        </button>
      )}
      {(onInlineInsert || onInsertAfter) && (
        <button
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => {
            if (onInlineInsert) {
              onInlineInsert(task.id, task.parentTaskId || undefined);
            } else {
              onInsertAfter!(task.id, task.parentTaskId || undefined);
            }
            onClose();
          }}
        >
          <PlusCircle className="w-3.5 h-3.5" /> Insert After
        </button>
      )}
      <button
        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
        onClick={() => { onTaskClick(task); onClose(); }}
      >
        <Pencil className="w-3.5 h-3.5" /> Edit Task
      </button>
      {task.parentTaskId && (
        <button
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onOutdent(task.id); onClose(); }}
        >
          <CornerDownLeft className="w-3.5 h-3.5" /> Outdent
        </button>
      )}
      {idx > 0 && (
        <button
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onIndent(task.id, visibleSorted[idx - 1].id); onClose(); }}
        >
          <CornerDownRight className="w-3.5 h-3.5" /> Indent
        </button>
      )}
      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
      <button
        className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
        onClick={() => {
          const ids = new Set(selectedIds);
          ids.add(task.id);
          onDelete(Array.from(ids));
          onClose();
        }}
      >
        <Trash2 className="w-3.5 h-3.5" />
        {selectedIds.size > 0 && !selectedIds.has(task.id)
          ? `Delete ${selectedIds.size + 1} Tasks`
          : selectedIds.size > 1
          ? `Delete ${selectedIds.size} Tasks`
          : 'Delete Task'}
      </button>
    </div>
  );
});

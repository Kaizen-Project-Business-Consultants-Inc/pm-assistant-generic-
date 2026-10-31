import React, { useRef } from 'react';
import { PlusCircle, Pencil, Trash2, CornerDownLeft, CornerDownRight } from 'lucide-react';
import type { GanttTask } from './types';
import { useMenuKeyboard } from '../shared/hooks/useMenuKeyboard';
import type { IndentDirection } from '../shared/indentPlan';

interface TableContextMenuProps {
  x: number;
  y: number;
  task: GanttTask;
  selectedIds: Set<string>;
  onInsertBefore?: (taskId: string, parentTaskId?: string) => void;
  onInsertAfter?: (taskId: string, parentTaskId?: string) => void;
  onInlineInsert?: (afterTaskId: string, parentTaskId?: string) => void;
  onTaskClick: (task: GanttTask) => void;
  /** Which of Outdent / Indent apply to the right-clicked row (or the selection it is in) */
  indentItems: { outdent: boolean; indent: boolean };
  onIndent: (direction: IndentDirection) => void;
  onDelete: (taskIds: string[]) => void;
  onClose: () => void;
}

export const TableContextMenu = React.memo(function TableContextMenu({
  x,
  y,
  task,
  selectedIds,
  onInsertBefore,
  onInsertAfter,
  onInlineInsert,
  onTaskClick,
  indentItems,
  onIndent,
  onDelete,
  onClose,
}: TableContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useMenuKeyboard(menuRef, onClose);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Row menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {onInsertBefore && (
        <button
          type="button"
          role="menuitem"
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onInsertBefore(task.id, task.parentTaskId || undefined); onClose(); }}
        >
          <PlusCircle className="w-3.5 h-3.5" /> Insert Before
        </button>
      )}
      {(onInlineInsert || onInsertAfter) && (
        <button
          type="button"
          role="menuitem"
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
          type="button"
          role="menuitem"
        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
        onClick={() => { onTaskClick(task); onClose(); }}
      >
        <Pencil className="w-3.5 h-3.5" /> Edit Task
      </button>
      {indentItems.outdent && (
        <button
          type="button"
          role="menuitem"
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onIndent('outdent'); onClose(); }}
        >
          <CornerDownLeft className="w-3.5 h-3.5" /> Outdent
        </button>
      )}
      {indentItems.indent && (
        <button
          type="button"
          role="menuitem"
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onIndent('indent'); onClose(); }}
        >
          <CornerDownRight className="w-3.5 h-3.5" /> Indent
        </button>
      )}
      <div role="separator" className="border-t border-gray-200 dark:border-gray-700 my-1" />
      <button
          type="button"
          role="menuitem"
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

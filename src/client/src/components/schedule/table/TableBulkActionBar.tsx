import React from 'react';
import { CheckSquare, Trash2, X } from 'lucide-react';
import { statusOptions, priorityOptions } from './types';

interface TableBulkActionBarProps {
  selectedCount: number;
  bulkStatus: string;
  bulkPriority: string;
  bulkAssignee: string;
  bulkMessage: string;
  bulkLoading: boolean;
  onBulkStatusChange: (value: string) => void;
  onBulkPriorityChange: (value: string) => void;
  onBulkAssigneeChange: (value: string) => void;
  onApplyBulkUpdate: (field: string, value: string) => void;
  onBulkDelete: () => void;
  onClear: () => void;
}

export const TableBulkActionBar = React.memo(function TableBulkActionBar({
  selectedCount,
  bulkStatus,
  bulkPriority,
  bulkAssignee,
  bulkMessage,
  bulkLoading,
  onBulkStatusChange,
  onBulkPriorityChange,
  onBulkAssigneeChange,
  onApplyBulkUpdate,
  onBulkDelete,
  onClear,
}: TableBulkActionBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-primary-50 border border-primary-200 rounded-lg p-3 m-2 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <CheckSquare className="w-4 h-4 text-primary-600" />
        <span className="text-xs font-semibold text-primary-700">{selectedCount} selected</span>
      </div>

      <div className="h-4 w-px bg-primary-200" />

      <div className="flex items-center gap-1">
        <select
          className="text-xs px-2 py-1 rounded border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={bulkStatus}
          onChange={e => onBulkStatusChange(e.target.value)}
          disabled={bulkLoading}
        >
          <option value="">Status...</option>
          {statusOptions.map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        {bulkStatus && (
          <button
            className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50"
            onClick={() => onApplyBulkUpdate('status', bulkStatus)}
            disabled={bulkLoading}
          >
            Apply
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <select
          className="text-xs px-2 py-1 rounded border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={bulkPriority}
          onChange={e => onBulkPriorityChange(e.target.value)}
          disabled={bulkLoading}
        >
          <option value="">Priority...</option>
          {priorityOptions.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {bulkPriority && (
          <button
            className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50"
            onClick={() => onApplyBulkUpdate('priority', bulkPriority)}
            disabled={bulkLoading}
          >
            Apply
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <input
          type="text"
          placeholder="Assign to..."
          className="text-xs px-2 py-1 rounded border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400 w-28"
          value={bulkAssignee}
          onChange={e => onBulkAssigneeChange(e.target.value)}
          disabled={bulkLoading}
          onKeyDown={e => { if (e.key === 'Enter' && bulkAssignee) onApplyBulkUpdate('assignedTo', bulkAssignee); }}
        />
        {bulkAssignee && (
          <button
            className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50"
            onClick={() => onApplyBulkUpdate('assignedTo', bulkAssignee)}
            disabled={bulkLoading}
          >
            Apply
          </button>
        )}
      </div>

      <div className="h-4 w-px bg-primary-200" />

      <button
        className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 flex items-center gap-1"
        onClick={onBulkDelete}
        disabled={bulkLoading}
      >
        <Trash2 className="w-3 h-3" />
        Delete
      </button>

      <button
        className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center gap-1 ml-auto"
        onClick={onClear}
      >
        <X className="w-3 h-3" />
        Clear
      </button>

      {bulkMessage && (
        <span className="text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
          {bulkMessage}
        </span>
      )}
    </div>
  );
});

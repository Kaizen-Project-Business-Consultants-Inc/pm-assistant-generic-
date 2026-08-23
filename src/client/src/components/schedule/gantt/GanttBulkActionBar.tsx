import React from 'react';
import { statusOptions, priorityOptions } from './types';

interface GanttBulkActionBarProps {
  selectedCount: number;
  bulkStatus: string;
  bulkPriority: string;
  bulkAssignee: string;
  bulkMessage: string;
  bulkLoading: boolean;
  setBulkStatus: (v: string) => void;
  setBulkPriority: (v: string) => void;
  setBulkAssignee: (v: string) => void;
  applyBulkUpdate: (field: string, value: string) => void;
  handleBulkDelete: () => void;
  clearBulkState: () => void;
  hasOnBulkUpdate: boolean;
  hasOnBulkDelete: boolean;
}

export const GanttBulkActionBar = React.memo(function GanttBulkActionBar({
  selectedCount,
  bulkStatus,
  bulkPriority,
  bulkAssignee,
  bulkMessage,
  bulkLoading,
  setBulkStatus,
  setBulkPriority,
  setBulkAssignee,
  applyBulkUpdate,
  handleBulkDelete,
  clearBulkState,
  hasOnBulkDelete,
}: GanttBulkActionBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-200 dark:border-primary-800 px-4 py-2 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-primary-700">{selectedCount} selected</span>
      </div>
      <div className="h-4 w-px bg-primary-200" />
      <div className="flex items-center gap-1">
        <select
          aria-label="Bulk set status"
          className="text-xs px-2 py-1 rounded border border-primary-200 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={bulkStatus}
          onChange={e => setBulkStatus(e.target.value)}
          disabled={bulkLoading}
        >
          <option value="">Status...</option>
          {statusOptions.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        {bulkStatus && (
          <button className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50" onClick={() => applyBulkUpdate('status', bulkStatus)} disabled={bulkLoading}>Apply</button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <select
          aria-label="Bulk set priority"
          className="text-xs px-2 py-1 rounded border border-primary-200 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={bulkPriority}
          onChange={e => setBulkPriority(e.target.value)}
          disabled={bulkLoading}
        >
          <option value="">Priority...</option>
          {priorityOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {bulkPriority && (
          <button className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50" onClick={() => applyBulkUpdate('priority', bulkPriority)} disabled={bulkLoading}>Apply</button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          aria-label="Bulk assign to"
          placeholder="Assign to..."
          className="text-xs px-2 py-1 rounded border border-primary-200 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400 w-28"
          value={bulkAssignee}
          onChange={e => setBulkAssignee(e.target.value)}
          disabled={bulkLoading}
          onKeyDown={e => { if (e.key === 'Enter' && bulkAssignee) applyBulkUpdate('assignedTo', bulkAssignee); }}
        />
        {bulkAssignee && (
          <button className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50" onClick={() => applyBulkUpdate('assignedTo', bulkAssignee)} disabled={bulkLoading}>Apply</button>
        )}
      </div>
      {hasOnBulkDelete && (
        <>
          <div className="h-4 w-px bg-primary-200" />
          <button
            className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 flex items-center gap-1"
            onClick={handleBulkDelete}
            disabled={bulkLoading}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Delete
          </button>
        </>
      )}
      <button
        className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 ml-auto"
        onClick={clearBulkState}
      >
        Clear
      </button>
      {bulkMessage && (
        <span className={`text-xs font-medium ${bulkMessage.includes('fail') ? 'text-red-600' : 'text-green-600'}`}>
          {bulkMessage}
        </span>
      )}
    </div>
  );
});

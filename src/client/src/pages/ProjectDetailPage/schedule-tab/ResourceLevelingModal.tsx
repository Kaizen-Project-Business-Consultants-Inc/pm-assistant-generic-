import React from 'react';
import { X } from 'lucide-react';

interface ResourceLevelingModalProps {
  result: any[];
  onClose: () => void;
  onApply: () => void;
}

export const ResourceLevelingModal = React.memo(function ResourceLevelingModal({ result, onClose, onApply }: ResourceLevelingModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Resource Leveling</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No resource conflicts detected — schedule is already balanced.</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{result.length} task(s) need date adjustments to resolve resource over-allocations:</p>
              <div className="space-y-2">
                {result.map((adj: any) => (
                  <div key={adj.taskId} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3 text-xs">
                    <p className="font-medium text-gray-900 dark:text-white">{adj.taskName}</p>
                    <div className="flex items-center gap-2 mt-1 text-gray-500 dark:text-gray-400">
                      <span>{adj.originalStart?.slice(0, 10)}</span>
                      <span>→</span>
                      <span className="text-orange-600 dark:text-orange-400 font-medium">{adj.newStart?.slice(0, 10)}</span>
                    </div>
                    {adj.reason && <p className="mt-1 text-gray-400 dark:text-gray-500 italic">{adj.reason}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {result.length > 0 && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={onApply}
              className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-md"
            >
              Apply All
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

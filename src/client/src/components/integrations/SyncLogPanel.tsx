import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  RefreshCw,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { apiService } from '../../services/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncLogPanelProps {
  integrationId: string;
  onClose: () => void;
}

interface SyncLogEntry {
  id: string;
  integrationId: string;
  direction: 'push' | 'pull';
  status: 'success' | 'partial' | 'failed';
  itemsSynced: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

const STATUS_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  success: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', label: 'Success' },
  partial: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', label: 'Partial' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Failed' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SyncLogPanel: React.FC<SyncLogPanelProps> = ({
  integrationId,
  onClose,
}) => {
  const queryClient = useQueryClient();

  const {
    data: logData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['integration-sync-log', integrationId],
    queryFn: () => apiService.getIntegrationSyncLog(integrationId),
  });

  const entries: SyncLogEntry[] = logData?.entries ?? logData?.logs ?? [];

  const syncMutation = useMutation({
    mutationFn: () => apiService.syncIntegration(integrationId, 'pull'),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integration-sync-log', integrationId],
      });
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Sync History
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  syncMutation.isPending ? 'animate-spin' : ''
                }`}
              />
              Sync Now
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500 dark:text-gray-400">Loading sync history…</span>
            </div>
          )}

          {isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400 text-sm">
              Failed to load sync history. Please try again.
            </div>
          )}

          {!isLoading && !isError && entries.length === 0 && (
            <div className="text-center py-12">
              <Clock className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">No sync history yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                Click "Sync Now" to run the first synchronization.
              </p>
            </div>
          )}

          {!isLoading && !isError && entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      Direction
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      Items
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      Started
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      Completed
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const statusStyle = STATUS_STYLES[entry.status] ??
                      STATUS_STYLES.failed;

                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {/* Direction */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            {entry.direction === 'push' ? (
                              <ArrowUpRight className="h-4 w-4 text-blue-500" />
                            ) : (
                              <ArrowDownLeft className="h-4 w-4 text-green-500" />
                            )}
                            <span className="capitalize text-gray-700 dark:text-gray-300">
                              {entry.direction}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                          >
                            {entry.status === 'success' && (
                              <Check className="h-3 w-3" />
                            )}
                            {entry.status === 'partial' && (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {entry.status === 'failed' && (
                              <X className="h-3 w-3" />
                            )}
                            {statusStyle.label}
                          </span>
                        </td>

                        {/* Items synced */}
                        <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">
                          {entry.itemsSynced}
                        </td>

                        {/* Started */}
                        <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400">
                          {formatDateTime(entry.startedAt)}
                        </td>

                        {/* Completed */}
                        <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400">
                          {formatDateTime(entry.completedAt)}
                        </td>

                        {/* Error */}
                        <td className="py-2.5 px-3">
                          {entry.errorMessage ? (
                            <span className="text-red-600 dark:text-red-400 text-xs">
                              {entry.errorMessage}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

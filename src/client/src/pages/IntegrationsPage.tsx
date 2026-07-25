import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plug,
  RefreshCw,
  Check,
  Settings,
  Unplug,
  Clock,
  History,
} from 'lucide-react';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { IntegrationConfigModal } from '../components/integrations/IntegrationConfigModal';
import { SyncLogPanel } from '../components/integrations/SyncLogPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Integration {
  id: string;
  provider: string;
  config: Record<string, unknown>;
  enabled: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  name: string;
  description: string;
  color: string;
  letter: string;
}

const PROVIDERS: Record<string, ProviderMeta> = {
  jira: {
    name: 'Jira',
    description: 'Sync tasks with Jira issues',
    color: '#0052CC',
    letter: 'J',
  },
  github: {
    name: 'GitHub',
    description: 'Link GitHub issues to project tasks',
    color: '#333333',
    letter: 'G',
  },
  slack: {
    name: 'Slack',
    description: 'Send project notifications to Slack',
    color: '#4A154B',
    letter: 'S',
  },
  trello: {
    name: 'Trello',
    description: 'Sync Trello cards with tasks',
    color: '#0079BF',
    letter: 'T',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const IntegrationsPage: React.FC = () => {
  const queryClient = useQueryClient();

  const [configModal, setConfigModal] = useState<{
    provider: string;
    integrationId?: string;
  } | null>(null);

  const [syncLogId, setSyncLogId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<{ id: string; name: string } | null>(null);

  // Fetch integrations
  const {
    data: integrationsData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiService.getIntegrations(),
  });

  const integrations: Integration[] = integrationsData?.integrations ?? [];

  // Build a map: provider -> integration (if connected)
  const connectedMap = new Map<string, Integration>();
  for (const integ of integrations) {
    connectedMap.set(integ.provider, integ);
  }

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: (integrationId: string) =>
      apiService.syncIntegration(integrationId, 'pull'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: (integrationId: string) =>
      apiService.deleteIntegration(integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const handleDisconnect = (integrationId: string, providerName: string) => {
    setConfirmDisconnect({ id: integrationId, name: providerName });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Plug className="h-7 w-7 text-primary-600 dark:text-primary-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            External Integrations
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          Connect your favorite tools to sync tasks, issues, and notifications.
        </p>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          <span className="ml-2 text-gray-500 dark:text-gray-400">Loading integrations…</span>
        </div>
      )}

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load integrations. Please try again later.
        </div>
      )}

      {/* Provider Cards Grid */}
      {!isLoading && !isError && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {Object.entries(PROVIDERS).map(([providerKey, meta]) => {
            const connected = connectedMap.get(providerKey);

            return (
              <div
                key={providerKey}
                className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/30 hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  {/* Top row: icon + name + badge */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-xl"
                        style={{ backgroundColor: meta.color }}
                      >
                        {meta.letter}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {meta.name}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {meta.description}
                        </p>
                      </div>
                    </div>
                    {connected && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <Check className="h-3 w-3" />
                        Connected
                      </span>
                    )}
                  </div>

                  {/* Connected state */}
                  {connected ? (
                    <>
                      {/* Last sync */}
                      <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-4">
                        <Clock className="h-4 w-4" />
                        <span>
                          Last synced:{' '}
                          {formatRelativeTime(connected.lastSyncAt)}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => syncMutation.mutate(connected.id)}
                          disabled={syncMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${
                              syncMutation.isPending ? 'animate-spin' : ''
                            }`}
                          />
                          Sync
                        </button>

                        <button
                          onClick={() =>
                            setConfigModal({
                              provider: providerKey,
                              integrationId: connected.id,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 transition-colors"
                        >
                          <Settings className="h-4 w-4" />
                          Configure
                        </button>

                        <button
                          onClick={() => setSyncLogId(connected.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 transition-colors"
                        >
                          <History className="h-4 w-4" />
                          History
                        </button>

                        <button
                          onClick={() =>
                            handleDisconnect(connected.id, meta.name)
                          }
                          disabled={disconnectMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
                        >
                          <Unplug className="h-4 w-4" />
                          Disconnect
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Not connected state */
                    <button
                      onClick={() => setConfigModal({ provider: providerKey })}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors hover:opacity-90"
                      style={{ backgroundColor: meta.color }}
                    >
                      <Plug className="h-4 w-4" />
                      Connect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Config Modal */}
      {configModal && (
        <IntegrationConfigModal
          provider={configModal.provider}
          integrationId={configModal.integrationId}
          onClose={() => setConfigModal(null)}
          onSaved={() => {
            setConfigModal(null);
            queryClient.invalidateQueries({ queryKey: ['integrations'] });
          }}
        />
      )}

      {/* Sync Log Panel */}
      {syncLogId && (
        <SyncLogPanel
          integrationId={syncLogId}
          onClose={() => setSyncLogId(null)}
        />
      )}

      {/* Disconnect Confirmation */}
      {confirmDisconnect && (
        <ConfirmModal
          title="Disconnect Integration"
          message={`Are you sure you want to disconnect ${confirmDisconnect.name}? This will remove all integration settings.`}
          confirmLabel="Disconnect"
          isPending={disconnectMutation.isPending}
          onConfirm={() => { disconnectMutation.mutate(confirmDisconnect.id); setConfirmDisconnect(null); }}
          onCancel={() => setConfirmDisconnect(null)}
        />
      )}
    </div>
  );
};

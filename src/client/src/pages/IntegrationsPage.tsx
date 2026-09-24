import React, { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plug,
  RefreshCw,
  Check,
  Settings,
  Unplug,
  Clock,
  History,
  Plus,
  ExternalLink,
  AlertCircle,
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
  projectId: string | null;
  config: Record<string, unknown>;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

// Providers that support multiple connections (one per project)
const MULTI_CONNECTION_PROVIDERS = new Set(['slack', 'msteams']);
// Notification-only providers: events are pushed out, never pulled/synced,
// so Sync and sync History are meaningless for them.
const PUSH_ONLY_PROVIDERS = new Set(['slack', 'msteams']);

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
  google_calendar: {
    name: 'Google Calendar',
    description: 'Sync task deadlines with Google Calendar',
    color: '#4285F4',
    letter: 'C',
  },
  trello: {
    name: 'Trello',
    description: 'Sync Trello cards with tasks',
    color: '#0079BF',
    letter: 'T',
  },
  msteams: {
    name: 'Microsoft Teams',
    description: 'Send project notifications to a Teams channel',
    color: '#5059C9',
    letter: 'MT',
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

  // Anything that goes wrong has to be visible. Previously an install that
  // failed — a provider not configured on the site, or a blocked popup — only
  // reached the browser console, so the button simply appeared to do nothing.
  const [banner, setBanner] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  // Fetch integrations
  const {
    data: integrationsData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiService.getIntegrations(),
  });

  // Fetch projects (for resolving project names on Slack integrations)
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const integrations: Integration[] = integrationsData?.integrations ?? [];
  const projects: { id: string; name: string }[] = projectsData?.projects || projectsData?.data || [];
  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]));

  // Build maps: for single-connection providers use first match, for multi keep all
  const connectedMap = new Map<string, Integration>();
  const multiConnectedMap = new Map<string, Integration[]>();
  for (const integ of integrations) {
    if (MULTI_CONNECTION_PROVIDERS.has(integ.provider)) {
      const list = multiConnectedMap.get(integ.provider) || [];
      list.push(integ);
      multiConnectedMap.set(integ.provider, list);
    } else {
      if (!connectedMap.has(integ.provider)) {
        connectedMap.set(integ.provider, integ);
      }
    }
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
    onError: (err: any) => {
      setBanner({
        kind: 'error',
        text: err?.response?.data?.message || 'We could not disconnect that. Please try again.',
      });
    },
  });

  const handleDisconnect = (integrationId: string, providerName: string) => {
    setConfirmDisconnect({ id: integrationId, name: providerName });
  };

  const OAUTH_PROVIDERS = new Set(['slack', 'google_calendar', 'msteams']);

  const handleOAuthConnect = useCallback(async (provider: string) => {
    setBanner(null);
    const label = PROVIDERS[provider]?.name ?? provider;
    try {
      let data;
      if (provider === 'slack') {
        data = await apiService.getSlackInstallUrl();
      } else if (provider === 'google_calendar') {
        data = await apiService.getCalendarConnectUrl();
      } else if (provider === 'msteams') {
        data = await apiService.getTeamsInstallUrl();
      }
      if (!data?.url) {
        setBanner({ kind: 'error', text: `${label} could not be started. Please try again.` });
        return;
      }
      const popup = window.open(data.url, '_blank', 'width=600,height=700');
      // A blocked popup is the single most common reason "nothing happens".
      if (!popup || popup.closed) {
        setBanner({
          kind: 'error',
          text: `Your browser blocked the ${label} window. Allow pop-ups for this site and try again.`,
        });
      }
    } catch (err: any) {
      setBanner({
        kind: 'error',
        text: err?.response?.data?.message || `We could not start the ${label} connection. Please try again.`,
      });
    }
  }, []);

  /**
   * The authorisation happens in a separate window, so this page has to be told
   * when it finished. Without this the customer completes the install and the
   * card still says "Install" until they reload — which reads as a failure.
   */
  useEffect(() => {
    const handleResult = (data: any) => {
      if (data?.type !== 'oauth-callback') return;
      const label = PROVIDERS[data.provider]?.name ?? data.provider ?? 'The service';
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['integrations'] });
        setBanner({
          kind: 'success',
          text: (data.provider === 'slack' || data.provider === 'msteams')
            ? `${label} is connected. Open Configure to choose the channel and which events get posted.`
            : `${label} is connected.`,
        });
      } else if (data.error) {
        setBanner({ kind: 'error', text: `${label} was not connected: ${data.error}` });
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      handleResult(event.data);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'oauth-callback-result' || !event.newValue) return;
      try { handleResult(JSON.parse(event.newValue)); } catch { /* ignore */ }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
    };
  }, [queryClient]);

  // Render action buttons for a single integration
  const renderActions = (integ: Integration, providerKey: string, meta: ProviderMeta, compact = false) => (
    <div className={`flex items-center gap-2 flex-wrap ${compact ? '' : 'mt-4'}`}>
      {!PUSH_ONLY_PROVIDERS.has(providerKey) && (
        <button
          onClick={() => syncMutation.mutate(integ.id)}
          disabled={syncMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          Sync
        </button>
      )}
      <button
        onClick={() => setConfigModal({ provider: providerKey, integrationId: integ.id })}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
      >
        <Settings className="h-4 w-4" />
        Configure
      </button>
      {!PUSH_ONLY_PROVIDERS.has(providerKey) && (
        <button
          onClick={() => setSyncLogId(integ.id)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          <History className="h-4 w-4" />
          History
        </button>
      )}
      <button
        onClick={() => handleDisconnect(integ.id, meta.name)}
        disabled={disconnectMutation.isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
      >
        <Unplug className="h-4 w-4" />
        Disconnect
      </button>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Plug className="h-7 w-7 text-primary-600 dark:text-primary-400" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            External Integrations
          </h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          Connect your favorite tools to sync tasks, issues, and notifications.
        </p>
      </div>

      {/* Result of the last action — installs happen in another window, so this
          is the only place the outcome can be reported. */}
      {banner && (
        <div
          role="status"
          aria-live="polite"
          className={`mb-6 flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
            banner.kind === 'error'
              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
          }`}
        >
          {banner.kind === 'error' ? (
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <Check className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <span className="flex-1">{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-500 dark:text-gray-500" />
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
            const isMulti = MULTI_CONNECTION_PROVIDERS.has(providerKey);
            const singleConnected = connectedMap.get(providerKey);
            const multiConnected = multiConnectedMap.get(providerKey) || [];
            const hasAnyConnection = isMulti ? multiConnected.length > 0 : !!singleConnected;

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
                    {hasAnyConnection && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        <Check className="h-3 w-3" />
                        {isMulti ? `${multiConnected.length} Connected` : 'Connected'}
                      </span>
                    )}
                  </div>

                  {/* Multi-connection providers (Slack) */}
                  {isMulti ? (
                    <>
                      {multiConnected.length > 0 && (
                        <div className="space-y-3 mb-4">
                          {multiConnected.map((integ) => {
                            const projectName = integ.projectId
                              ? projectNameMap.get(integ.projectId) || 'Unknown Project'
                              : 'All Projects';
                            const channel = (integ.config?.channel as string) || (integ.config?.channelName as string) || '';
                            return (
                              <div
                                key={integ.id}
                                className="border border-gray-100 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div>
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                                      {projectName}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      {channel || 'No channel chosen yet — open Configure'}
                                    </p>
                                  </div>
                                  {/* Slack is never "synced" — it's pushed to. Saying
                                      "Last synced: Never" on a working connection
                                      reads as broken, so name what it really is. */}
                                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-500">
                                    <Clock className="h-3 w-3" />
                                    {integ.lastSyncAt
                                      ? `Last message ${formatRelativeTime(integ.lastSyncAt)}`
                                      : 'No messages yet'}
                                  </div>
                                </div>
                                {renderActions(integ, providerKey, meta, true)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Always show "Add" button for multi-connection providers */}
                      <button
                        onClick={() => OAUTH_PROVIDERS.has(providerKey)
                          ? handleOAuthConnect(providerKey)
                          : setConfigModal({ provider: providerKey })
                        }
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:opacity-90"
                        style={{
                          backgroundColor: hasAnyConnection ? undefined : meta.color,
                          color: hasAnyConnection ? meta.color : 'white',
                          border: hasAnyConnection ? `1px solid ${meta.color}` : undefined,
                        }}
                      >
                        {hasAnyConnection ? <Plus className="h-4 w-4" /> : OAUTH_PROVIDERS.has(providerKey) ? <ExternalLink className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                        {/* This starts a whole new authorisation — it does not
                            add a channel, which "Add Another Channel" led
                            people to expect. Channels are picked in Configure. */}
                        {hasAnyConnection ? 'Connect Another Account' : OAUTH_PROVIDERS.has(providerKey) ? `Connect ${meta.name}` : 'Connect'}
                      </button>
                      {OAUTH_PROVIDERS.has(providerKey) && !hasAnyConnection && (
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                          Opens {meta.name} so you can approve access. Start here, not from {meta.name}&apos;s own app page.
                        </p>
                      )}
                    </>
                  ) : (
                    /* Single-connection providers (Jira, GitHub, Trello) */
                    singleConnected ? (
                      <>
                        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-4">
                          <Clock className="h-4 w-4" />
                          <span>Last synced: {formatRelativeTime(singleConnected.lastSyncAt)}</span>
                        </div>
                        {renderActions(singleConnected, providerKey, meta)}
                      </>
                    ) : (
                      <button
                        onClick={() => OAUTH_PROVIDERS.has(providerKey)
                          ? handleOAuthConnect(providerKey)
                          : setConfigModal({ provider: providerKey })
                        }
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors hover:opacity-90"
                        style={{ backgroundColor: meta.color }}
                      >
                        {OAUTH_PROVIDERS.has(providerKey) ? <ExternalLink className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                        {OAUTH_PROVIDERS.has(providerKey) ? 'Install' : 'Connect'}
                      </button>
                    )
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

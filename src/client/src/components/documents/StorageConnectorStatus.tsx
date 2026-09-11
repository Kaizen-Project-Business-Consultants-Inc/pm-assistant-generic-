import { Cloud, RefreshCw, Trash2, Pause, Play, AlertTriangle } from 'lucide-react';

interface StorageConnector {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  errorMessage: string | null;
  lastSyncAt: string | null;
  syncIntervalMinutes: number;
}

interface StorageConnectorStatusProps {
  connector: StorageConnector;
  onSync: () => void;
  onTogglePause: () => void;
  onDisconnect: () => void;
  isSyncing?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  disconnected: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export function StorageConnectorStatus({ connector, onSync, onTogglePause, onDisconnect, isSyncing }: StorageConnectorStatusProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <Cloud className="w-4 h-4 text-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{connector.displayName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[connector.status] || STATUS_COLORS.disconnected}`}>
            {connector.status}
          </span>
        </div>
        {connector.lastSyncAt && (
          <p className="text-xs text-gray-400">
            Last sync: {new Date(connector.lastSyncAt).toLocaleString()}
          </p>
        )}
        {connector.status === 'error' && connector.errorMessage && (
          <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
            <AlertTriangle className="w-3 h-3" />
            {connector.errorMessage}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          title="Sync now"
          onClick={onSync}
          disabled={isSyncing}
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        </button>
        <button
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          title={connector.status === 'paused' ? 'Resume' : 'Pause'}
          onClick={onTogglePause}
        >
          {connector.status === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
        <button
          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
          title="Disconnect"
          onClick={onDisconnect}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

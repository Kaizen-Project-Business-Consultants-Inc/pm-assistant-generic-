import { useState, useEffect, useCallback } from 'react';
import { X, Cloud, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { OneDriveFolderPicker } from './OneDriveFolderPicker';

interface OneDriveConnectModalProps {
  projectId: string;
  onClose: () => void;
}

type Step = 'connect' | 'authorizing' | 'folders' | 'done';

export function OneDriveConnectModal({ projectId, onClose }: OneDriveConnectModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('connect');
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authMutation = useMutation({
    mutationFn: () => apiService.initiateOneDriveAuth(projectId),
    onSuccess: (data) => {
      setStep('authorizing');
      // Open OAuth popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.innerWidth - width) / 2;
      const top = window.screenY + (window.innerHeight - height) / 2;
      window.open(
        data.authUrl,
        'onedrive-auth',
        `width=${width},height=${height},left=${left},top=${top},popup=yes`,
      );
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || err.message);
    },
  });

  const folderMutation = useMutation({
    mutationFn: (folderIds: string[]) =>
      apiService.setConnectorFolders(projectId, connectorId!, folderIds),
    onSuccess: () => {
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['storage-connectors', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      // Auto-close after brief delay
      setTimeout(onClose, 1500);
    },
  });

  // Handle OAuth callback result (from postMessage or localStorage)
  const handleOAuthResult = useCallback((data: any) => {
    if (data?.type !== 'oauth-callback') return;
    if (data.success && data.connectorId) {
      setConnectorId(data.connectorId);
      setStep('folders');
      queryClient.invalidateQueries({ queryKey: ['storage-connectors', projectId] });
    } else {
      setError(data.error || 'Authorization failed');
      setStep('connect');
    }
  }, [projectId, queryClient]);

  useEffect(() => {
    // Listen for postMessage (works if opener survived cross-origin nav)
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      handleOAuthResult(event.data);
    };

    // Listen for localStorage (fallback when opener is null)
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'oauth-callback-result' || !event.newValue) return;
      try {
        handleOAuthResult(JSON.parse(event.newValue));
      } catch { /* ignore parse errors */ }
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
    };
  }, [handleOAuthResult]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-500" />
            Connect OneDrive
          </h2>
          <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {step === 'connect' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Connect your OneDrive account to automatically sync documents to this project.
              Kovarti will only read your files — never modify or delete them.
            </p>
            <ul className="text-xs text-gray-500 space-y-1">
              <li>Supported: PDF, DOCX, DOC, TXT, CSV, MD (max 10MB)</li>
              <li>Documents are processed with AI classification and search</li>
              <li>Syncs automatically based on your chosen interval</li>
            </ul>
            <button
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium"
              onClick={() => { setError(null); authMutation.mutate(); }}
              disabled={authMutation.isPending}
            >
              {authMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Cloud className="w-4 h-4" />
              )}
              Sign in with Microsoft
            </button>
          </div>
        )}

        {step === 'authorizing' && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 mx-auto text-blue-500 animate-spin mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Waiting for authorization...
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Complete sign-in in the popup window
            </p>
          </div>
        )}

        {step === 'folders' && connectorId && (
          <OneDriveFolderPicker
            projectId={projectId}
            connectorId={connectorId}
            onSave={(folderIds) => folderMutation.mutate(folderIds)}
            onCancel={() => {
              // Save with empty selection (sync all)
              folderMutation.mutate([]);
            }}
          />
        )}

        {step === 'done' && (
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <Cloud className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              OneDrive connected!
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Initial sync will begin shortly.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

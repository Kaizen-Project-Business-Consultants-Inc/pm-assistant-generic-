import { useState, useEffect, useCallback } from 'react';
import { X, Cloud, Loader2, HardDrive, Link2, FolderOpen } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { FolderPicker } from './FolderPicker';

interface StorageConnectModalProps {
  projectId: string;
  onClose: () => void;
}

type Step = 'provider' | 'onedriveChoice' | 'shareLink' | 'siteUrl' | 'authorizing' | 'folders' | 'done';

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
}

const PROVIDER_ICONS: Record<string, string> = {
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
  google_drive: 'Google Drive',
  dropbox: 'Dropbox',
};

const PROVIDER_COLORS: Record<string, string> = {
  onedrive: 'border-blue-300 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20',
  sharepoint: 'border-teal-300 hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20',
  google_drive: 'border-green-300 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20',
  dropbox: 'border-indigo-300 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20',
};

export function StorageConnectModal({ projectId, onClose }: StorageConnectModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('provider');
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteUrl, setSiteUrl] = useState('');
  const [shareUrl, setShareUrl] = useState('');

  const { data: providersData } = useQuery({
    queryKey: ['storage-providers', projectId],
    queryFn: () => apiService.getAvailableProviders(projectId),
    staleTime: 60_000,
  });
  const providers: ProviderInfo[] = providersData?.providers || [];

  const authMutation = useMutation({
    mutationFn: (params: { provider: string; extra?: Record<string, string> }) =>
      apiService.initiateStorageAuth(projectId, params.provider, params.extra),
    onSuccess: (data) => {
      setStep('authorizing');
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.innerWidth - width) / 2;
      const top = window.screenY + (window.innerHeight - height) / 2;
      window.open(
        data.authUrl,
        'storage-auth',
        `width=${width},height=${height},left=${left},top=${top},popup=yes`,
      );
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || err.message);
      setStep('provider');
    },
  });

  const folderMutation = useMutation({
    mutationFn: (folderIds: string[]) =>
      apiService.setConnectorFolders(projectId, connectorId!, folderIds),
    onSuccess: () => {
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['storage-connectors', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      setTimeout(onClose, 1500);
    },
  });

  // Handle OAuth callback result
  const handleOAuthResult = useCallback((data: any) => {
    if (data?.type !== 'oauth-callback') return;
    if (data.success && data.connectorId) {
      setConnectorId(data.connectorId);
      setStep('folders');
      queryClient.invalidateQueries({ queryKey: ['storage-connectors', projectId] });
    } else {
      setError(data.error || 'Authorization failed');
      setStep('provider');
    }
  }, [projectId, queryClient]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      handleOAuthResult(event.data);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'oauth-callback-result' || !event.newValue) return;
      try { handleOAuthResult(JSON.parse(event.newValue)); } catch { /* ignore */ }
    };
    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
    };
  }, [handleOAuthResult]);

  const selectProvider = (providerId: string) => {
    setError(null);
    if (providerId === 'sharepoint') {
      setStep('siteUrl');
    } else if (providerId === 'onedrive') {
      setStep('onedriveChoice');
    } else {
      authMutation.mutate({ provider: providerId });
    }
  };

  const submitSiteUrl = () => {
    if (!siteUrl.trim()) {
      setError('Please enter a SharePoint site URL');
      return;
    }
    authMutation.mutate({ provider: 'sharepoint', extra: { siteUrl: siteUrl.trim() } });
  };

  const submitShareLink = () => {
    if (!shareUrl.trim()) {
      setError('Please paste a OneDrive sharing link');
      return;
    }
    authMutation.mutate({ provider: 'onedrive', extra: { shareUrl: shareUrl.trim() } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-500" />
            Connect Storage
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

        {step === 'provider' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Connect a cloud storage provider to automatically sync documents to this project.
              Kovarti will only read your files — never modify or delete them.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {providers.map((p) => (
                <button
                  key={p.id}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                    p.configured
                      ? PROVIDER_COLORS[p.id] || 'border-gray-300 hover:border-gray-500'
                      : 'border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed'
                  }`}
                  onClick={() => p.configured && selectProvider(p.id)}
                  disabled={!p.configured || authMutation.isPending}
                >
                  <HardDrive className={`w-8 h-8 ${p.configured ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`} />
                  <span className={`text-sm font-medium ${p.configured ? '' : 'text-gray-400'}`}>
                    {PROVIDER_ICONS[p.id] || p.label}
                  </span>
                  {!p.configured && (
                    <span className="text-xs text-gray-400">Not configured</span>
                  )}
                </button>
              ))}
            </div>
            <ul className="text-xs text-gray-500 space-y-1">
              <li>Supported: PDF, DOCX, DOC, TXT, CSV, MD (max 10MB)</li>
              <li>Documents are processed with AI classification and search</li>
              <li>Syncs automatically based on your chosen interval</li>
            </ul>
            {authMutation.isPending && (
              <div className="flex items-center justify-center gap-2 text-sm text-primary-600">
                <Loader2 className="w-4 h-4 animate-spin" /> Preparing...
              </div>
            )}
          </div>
        )}

        {step === 'onedriveChoice' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              How would you like to connect OneDrive?
            </p>
            <div className="space-y-3">
              <button
                className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-blue-200 hover:border-blue-500 hover:bg-blue-50 dark:border-blue-800 dark:hover:border-blue-500 dark:hover:bg-blue-900/20 transition-colors text-left"
                onClick={() => authMutation.mutate({ provider: 'onedrive' })}
                disabled={authMutation.isPending}
              >
                <FolderOpen className="w-6 h-6 text-blue-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">My OneDrive</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Connect your own OneDrive storage</p>
                </div>
              </button>
              <button
                className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-purple-200 hover:border-purple-500 hover:bg-purple-50 dark:border-purple-800 dark:hover:border-purple-500 dark:hover:bg-purple-900/20 transition-colors text-left"
                onClick={() => setStep('shareLink')}
                disabled={authMutation.isPending}
              >
                <Link2 className="w-6 h-6 text-purple-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Shared Folder Link</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Paste a OneDrive sharing link from a coworker</p>
                </div>
              </button>
            </div>
            <button
              className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              onClick={() => setStep('provider')}
            >
              &larr; Back
            </button>
            {authMutation.isPending && (
              <div className="flex items-center justify-center gap-2 text-sm text-primary-600">
                <Loader2 className="w-4 h-4 animate-spin" /> Preparing...
              </div>
            )}
          </div>
        )}

        {step === 'shareLink' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Paste the OneDrive sharing link for the folder you want to connect.
            </p>
            <input
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-700 dark:border-gray-600"
              placeholder="https://...sharepoint.com/:f:/g/personal/..."
              value={shareUrl}
              onChange={(e) => setShareUrl(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') submitShareLink(); }}
            />
            <p className="text-xs text-gray-400">
              You must have access to this shared folder with your Microsoft account.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                onClick={() => { setStep('onedriveChoice'); setShareUrl(''); }}
              >
                Back
              </button>
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                onClick={submitShareLink}
                disabled={authMutation.isPending}
              >
                {authMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'siteUrl' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Enter your SharePoint site URL to connect.
            </p>
            <input
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-700 dark:border-gray-600"
              placeholder="https://yourcompany.sharepoint.com/sites/YourSite"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') submitSiteUrl(); }}
            />
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                onClick={() => { setStep('provider'); setSiteUrl(''); }}
              >
                Back
              </button>
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                onClick={submitSiteUrl}
                disabled={authMutation.isPending}
              >
                {authMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Continue
              </button>
            </div>
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
          <FolderPicker
            projectId={projectId}
            connectorId={connectorId}
            onSave={(folderIds) => folderMutation.mutate(folderIds)}
            onCancel={() => folderMutation.mutate([])}
          />
        )}

        {step === 'done' && (
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <Cloud className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Storage connected!
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

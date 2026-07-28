import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Check, Lock } from 'lucide-react';
import { apiService } from '../../services/api';
import { ConfirmModal } from '../../components/ui/ConfirmModal';

export const ApiKeysTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['read', 'write']);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiService.listApiKeys(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; scopes: string[] }) => apiService.createApiKey(data),
    onSuccess: (result: any) => {
      setCreatedKey(result.apiKey?.key || result.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiService.revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    createMutation.mutate({ name: newKeyName.trim(), scopes: newKeyScopes });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const keys = data?.apiKeys || [];
  const isApiKeysSample: boolean = data?.sample || false;

  return (
    <div className="space-y-6">
      {isApiKeysSample && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample API Keys</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                These are sample API keys. Upgrade to a paid plan to create real API keys for external integrations, CI/CD pipelines, and AI agents.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">API Keys</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Create API keys to allow external AI agents and integrations to access your data.</p>
          </div>
          {!isApiKeysSample && (
            <button
              onClick={() => { setShowCreate(true); setCreatedKey(null); }}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create Key
            </button>
          )}
        </div>

        {/* Create Key Form */}
        {showCreate && (
          <div className="mb-6 p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20">
            {createdKey ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-medium">API key created! Copy it now — it won't be shown again.</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-700 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-mono break-all dark:text-gray-100">{createdKey}</code>
                  <button onClick={() => handleCopy(createdKey)} className="flex items-center gap-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-600 dark:text-gray-200">
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button onClick={() => { setShowCreate(false); setCreatedKey(null); }} className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700">Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Key Name</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., My AI Agent"
                    className="w-full max-w-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Scopes</label>
                  <div className="flex gap-2">
                    {['read', 'write', 'admin'].map((scope) => (
                      <button
                        key={scope}
                        onClick={() => toggleScope(scope)}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                          newKeyScopes.includes(scope) ? 'border-primary-600 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={!newKeyName.trim() || createMutation.isPending} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
                    {createMutation.isPending ? 'Creating…' : 'Create'}
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Keys List */}
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading API keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No API keys yet. Create one to get started.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {keys.map((key: any) => (
              <div key={key.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{key.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <code className="text-xs text-gray-500 dark:text-gray-400 font-mono">{key.keyPrefix}...</code>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      Scopes: {(key.scopes || []).join(', ')}
                    </span>
                    {key.lastUsedAt && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setConfirmRevokeId(key.id)}
                  className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                    key.isActive ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800' : 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }`}
                  disabled={!key.isActive}
                >
                  {key.isActive ? 'Revoke' : 'Revoked'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage Info */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Using API Keys</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Include your API key in the <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Authorization</code> header:</p>
        <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm font-mono">
          <span className="text-green-400">curl</span> -H <span className="text-yellow-300">"Authorization: Bearer kpm_your_key_here"</span> \<br />
          &nbsp;&nbsp;{window.location.origin}/api/v1/projects
        </div>
        <p className="text-xs text-gray-400 mt-3">Rate limit: 100 requests/minute per key. Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset</p>
      </div>

      {confirmRevokeId && (
        <ConfirmModal
          title="Revoke API Key"
          message="Revoke this API key? Any agents using it will lose access."
          confirmLabel="Revoke"
          isPending={revokeMutation.isPending}
          onConfirm={() => { revokeMutation.mutate(confirmRevokeId); setConfirmRevokeId(null); }}
          onCancel={() => setConfirmRevokeId(null)}
        />
      )}
    </div>
  );
};

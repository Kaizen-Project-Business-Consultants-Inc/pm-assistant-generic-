import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Check, Send, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { ConfirmModal } from '../../components/ui/ConfirmModal';

const WEBHOOK_EVENTS = [
  'task.created', 'task.updated', 'task.deleted',
  'project.created', 'project.updated',
  'proposal.created', 'proposal.accepted',
  'agent.scan_completed',
];

export const WebhooksTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [confirmDeleteWhId, setConfirmDeleteWhId] = useState<string | null>(null);
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiService.listWebhooks(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { url: string; events: string[] }) => apiService.createWebhook(data),
    onSuccess: (result: any) => {
      setCreatedSecret(result.webhook?.secret || null);
      setNewUrl('');
      setNewEvents([]);
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteWebhook(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiService.testWebhook(id),
  });

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreate = () => {
    if (!newUrl.trim() || newEvents.length === 0) return;
    createMutation.mutate({ url: newUrl.trim(), events: newEvents });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const webhooks = data?.webhooks || [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Webhooks</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Receive HTTP POST notifications when events occur in your projects.</p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setCreatedSecret(null); }}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Webhook
          </button>
        </div>

        {/* Create Webhook Form */}
        {showCreate && (
          <div className="mb-6 p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20">
            {createdSecret ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-medium">Webhook created! Save the signing secret — it won't be shown again.</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-700 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-mono break-all dark:text-gray-100">{createdSecret}</code>
                  <button onClick={() => handleCopy(createdSecret)} className="flex items-center gap-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-600">
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => { setShowCreate(false); setCreatedSecret(null); }} className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700">Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payload URL</label>
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://your-server.com/webhook"
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Events</label>
                  <div className="flex flex-wrap gap-2">
                    {WEBHOOK_EVENTS.map((event) => (
                      <button
                        key={event}
                        onClick={() => toggleEvent(event)}
                        className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                          newEvents.includes(event) ? 'border-primary-600 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {event}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={!newUrl.trim() || newEvents.length === 0 || createMutation.isPending} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
                    {createMutation.isPending ? 'Creating…' : 'Create'}
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Webhooks List */}
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading webhooks…</p>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No webhooks configured.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {webhooks.map((wh: any) => (
              <div key={wh.id} className="py-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{wh.url}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(wh.events || []).map((e: string) => (
                        <span key={e} className="inline-block px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{e}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                      <span className={wh.isActive ? 'text-green-600' : 'text-red-500'}>{wh.isActive ? 'Active' : 'Inactive'}</span>
                      {wh.failureCount > 0 && <span className="text-amber-600">{wh.failureCount} failures</span>}
                      {wh.lastTriggeredAt && <span>Last triggered: {new Date(wh.lastTriggeredAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button onClick={() => testMutation.mutate(wh.id)} disabled={testMutation.isPending} className="text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" title="Send test ping" aria-label="Send test ping">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteWhId(wh.id)}
                      className="text-sm px-3 py-1.5 rounded-md border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhook Verification Info */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Verifying Webhooks</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Each webhook delivery includes an <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">X-Webhook-Signature</code> header (HMAC-SHA256 of the request body using your secret).</p>
        <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm font-mono">
          <span className="text-gray-500">// Verify signature (Node.js example)</span><br />
          <span className="text-blue-400">const</span> expected = crypto.createHmac(<span className="text-yellow-300">'sha256'</span>, secret)<br />
          &nbsp;&nbsp;.update(requestBody).digest(<span className="text-yellow-300">'hex'</span>);<br />
          <span className="text-blue-400">const</span> valid = signature === expected;
        </div>
      </div>

      {confirmDeleteWhId && (
        <ConfirmModal
          title="Delete Webhook"
          message="Delete this webhook? It will stop receiving events immediately."
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => { deleteMutation.mutate(confirmDeleteWhId); setConfirmDeleteWhId(null); }}
          onCancel={() => setConfirmDeleteWhId(null)}
        />
      )}
    </div>
  );
};

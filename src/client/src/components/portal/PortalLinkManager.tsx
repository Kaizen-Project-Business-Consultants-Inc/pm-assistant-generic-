import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Copy,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { apiService } from '../../services/api';

interface PortalLink {
  id: string;
  label: string;
  token: string;
  is_active: boolean;
  expires_at: string | null;
  permissions: {
    canViewGantt: boolean;
    canViewBudget: boolean;
    canComment: boolean;
    canViewReports: boolean;
  };
  created_at: string;
}

interface CreateLinkForm {
  label: string;
  canViewGantt: boolean;
  canViewBudget: boolean;
  canComment: boolean;
  canViewReports: boolean;
  expiresAt: string;
}

const defaultForm: CreateLinkForm = {
  label: '',
  canViewGantt: true,
  canViewBudget: false,
  canComment: true,
  canViewReports: false,
  expiresAt: '',
};

export function PortalLinkManager({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState<CreateLinkForm>(defaultForm);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['portalLinks', projectId],
    queryFn: () => apiService.getPortalLinks(projectId),
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      label: string;
      permissions: Record<string, boolean>;
      expiresAt?: string;
    }) => apiService.createPortalLink(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portalLinks', projectId] });
      setShowCreateForm(false);
      setForm(defaultForm);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ linkId, isActive }: { linkId: string; isActive: boolean }) =>
      apiService.updatePortalLink(linkId, { is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portalLinks', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (linkId: string) =>
      apiService.deletePortalLink(linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portalLinks', projectId] });
      setDeleteConfirmId(null);
    },
  });

  const links: PortalLink[] = data?.links ?? data ?? [];
  const isSample: boolean = data?.sample || false;

  const handleCreate = () => {
    createMutation.mutate({
      label: form.label,
      permissions: {
        canViewGantt: form.canViewGantt,
        canViewBudget: form.canViewBudget,
        canComment: form.canComment,
        canViewReports: form.canViewReports,
      } as Record<string, boolean>,
      expiresAt: form.expiresAt || undefined,
    });
  };

  const copyLink = async (token: string, linkId: string) => {
    const url = `${window.location.origin}/portal/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(linkId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(linkId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const truncateToken = (token: string) =>
    token.length > 12 ? `${token.slice(0, 6)}...${token.slice(-4)}` : token;

  const permissionSummary = (perms: PortalLink['permissions']) => {
    const parts: string[] = [];
    if (perms.canViewGantt) parts.push('Gantt');
    if (perms.canViewBudget) parts.push('Budget');
    if (perms.canComment) parts.push('Comments');
    if (perms.canViewReports) parts.push('Reports');
    return parts.length > 0 ? parts.join(', ') : 'View only';
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link className="w-4 h-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Client Portal Links</h3>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-gray-100 dark:bg-gray-700 rounded" />
          <div className="h-8 bg-gray-100 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link className="w-4 h-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Client Portal Links</h3>
        </div>
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load portal links.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Link className="w-4 h-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Client Portal Links</h3>
        </div>
        {!isSample && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            {showCreateForm ? 'Cancel' : 'Create Link'}
          </button>
        )}
      </div>

      {isSample && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Portal Links</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                These are sample portal links. Upgrade to a paid plan to create shareable project portals for stakeholders.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Link Label
            </label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Client Review Link"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Permissions
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'canViewGantt' as const, label: 'View Gantt' },
                { key: 'canViewBudget' as const, label: 'View Budget' },
                { key: 'canComment' as const, label: 'Comment' },
                { key: 'canViewReports' as const, label: 'View Reports' },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Expires At (optional)
            </label>
            <input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={!form.label.trim() || createMutation.isPending}
            className="w-full text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md py-1.5 transition-colors"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Portal Link'}
          </button>
          {createMutation.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Failed to create link. Please try again.
            </p>
          )}
        </div>
      )}

      {/* Links List */}
      {links.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
          No portal links yet. Create one to share project status with clients.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <div
              key={link.id}
              className={`p-2.5 rounded-lg border text-xs ${
                link.is_active
                  ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 opacity-60'
              }`}
            >
              {/* Top row: label + token */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white">{link.label}</span>
                  <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-400 font-mono">
                    {truncateToken(link.token)}
                  </code>
                </div>
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                    link.is_active
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {link.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Permissions + expiry */}
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-2">
                <span>{permissionSummary(link.permissions)}</span>
                {link.expires_at && (
                  <span>
                    Expires: {new Date(link.expires_at).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => copyLink(link.token, link.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-gray-600 dark:text-gray-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  title="Copy link"
                >
                  {copiedId === link.id ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-green-600" />
                      <span className="text-green-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() =>
                    toggleMutation.mutate({
                      linkId: link.id,
                      isActive: !link.is_active,
                    })
                  }
                  className="flex items-center gap-1 px-2 py-1 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title={link.is_active ? 'Deactivate' : 'Activate'}
                >
                  {link.is_active ? (
                    <>
                      <EyeOff className="w-3 h-3" />
                      <span>Disable</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3 h-3" />
                      <span>Enable</span>
                    </>
                  )}
                </button>

                {deleteConfirmId === link.id ? (
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-red-600">Delete?</span>
                    <button
                      onClick={() => deleteMutation.mutate(link.id)}
                      disabled={deleteMutation.isPending}
                      className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(link.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-colors ml-auto"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

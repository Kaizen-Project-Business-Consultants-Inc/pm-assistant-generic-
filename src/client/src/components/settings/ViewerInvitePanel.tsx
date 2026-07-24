import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { Send, Trash2, Users, AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';

const STATUS_BADGES: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400', icon: Clock },
  accepted: { label: 'Accepted', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', icon: CheckCircle2 },
  expired: { label: 'Expired', color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400', icon: XCircle },
  revoked: { label: 'Revoked', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', icon: XCircle },
};

export function ViewerInvitePanel() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['invites'],
    queryFn: () => apiService.listInvites(),
  });

  const createMutation = useMutation({
    mutationFn: (inviteEmail: string) => apiService.createInvite({ email: inviteEmail }),
    onSuccess: () => {
      setEmail('');
      setSuccess('Invitation sent!');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'Failed to send invitation');
      setSuccess(null);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiService.revokeInvite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    createMutation.mutate(email.trim());
  };

  const invites = data?.invites || [];
  const activeViewers = invites.filter((i: any) => i.status === 'accepted').length;
  const pendingCount = invites.filter((i: any) => i.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Users className="w-5 h-5" />
          Viewer Invites
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Invite clients or stakeholders to view your projects for free.
        </p>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm">
        <span className="text-gray-600 dark:text-gray-300">
          <strong>{activeViewers}</strong> active viewer{activeViewers !== 1 ? 's' : ''}
        </span>
        {pendingCount > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            <strong>{pendingCount}</strong> pending
          </span>
        )}
      </div>

      {/* Invite form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter email address"
          className="input flex-1"
          required
        />
        <button
          type="submit"
          disabled={createMutation.isPending || !email.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
        >
          {createMutation.isPending ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          Invite
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Invite list */}
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      ) : invites.length > 0 ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
          {invites.map((invite: any) => {
            const badge = STATUS_BADGES[invite.status] || STATUS_BADGES.pending;
            const BadgeIcon = badge.icon;
            return (
              <div key={invite.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{invite.email}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Invited {new Date(invite.createdAt || invite.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                    <BadgeIcon className="w-3 h-3" />
                    {badge.label}
                  </span>
                  {invite.status === 'pending' && (
                    <button
                      onClick={() => revokeMutation.mutate(invite.id)}
                      disabled={revokeMutation.isPending}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="Revoke invite"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          No invitations yet. Invite a client to get started.
        </p>
      )}
    </div>
  );
}

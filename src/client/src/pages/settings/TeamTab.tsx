import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Shield, Send, X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { apiService } from '../../services/api';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { ViewerInvitePanel } from '../../components/settings/ViewerInvitePanel';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

const ROLE_OPTIONS = [
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'team_member', label: 'Team Member' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'scrum_master', label: 'Scrum Master' },
  { value: 'executive', label: 'Executive' },
  { value: 'finance_officer', label: 'Finance Officer' },
  { value: 'risk_manager', label: 'Risk Manager' },
  { value: 'pmo', label: 'PMO' },
  { value: 'ba', label: 'Business Analyst' },
  { value: 'qa', label: 'QA' },
  { value: 'tester', label: 'Tester' },
  { value: 'devops', label: 'DevOps' },
  { value: 'claude_sme', label: 'Claude SME' },
];

interface OrgMember {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export const TeamTab: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<OrgMember | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['org-members'],
    queryFn: async () => {
      return await apiService.getOrgMembers() as { organization: { id: string; name: string }; members: OrgMember[]; maxUsers: number };
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      return await apiService.inviteOrgMember(email, role);
    },
    onSuccess: (data: any) => {
      setInviteMsg({ type: 'success', text: data.message });
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    },
    onError: (err: unknown) => {
      setInviteMsg({ type: 'error', text: getApiErrorMessage(err, 'Failed to invite user') });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      return await apiService.updateOrgMemberRole(memberId, role);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      return await apiService.removeOrgMember(memberId);
    },
    onSuccess: () => {
      setConfirmRemove(null);
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    },
  });

  if (isLoading) return <div className="text-gray-500 dark:text-gray-400">Loading team…</div>;
  if (error) return <div className="text-red-500">Failed to load team members. You may not be part of an organization.</div>;

  const members = data?.members ?? [];
  const maxUsers = data?.maxUsers ?? 0;
  const orgName = data?.organization?.name ?? 'Organization';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{orgName} Team</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{members.length} / {maxUsers} members</p>
        </div>
      </div>

      {/* Invite Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Invite Member
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button
            onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
            disabled={!inviteEmail || inviteMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {inviteMutation.isPending ? 'Sending…' : 'Invite'}
          </button>
        </div>
        {inviteMsg && (
          <p className={`mt-2 text-sm ${inviteMsg.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {inviteMsg.text}
          </p>
        )}
      </div>

      {/* Members Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {members.map((m) => {
              const isMe = m.id === user?.id;
              return (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                    {m.fullName || m.username}
                    {isMe && <span className="ml-2 text-xs text-primary-600 dark:text-primary-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{m.email}</td>
                  <td className="px-4 py-3 text-sm">
                    {isMe ? (
                      <span className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300">
                        <Shield className="w-3 h-3" />
                        {ROLE_OPTIONS.find(r => r.value === m.role)?.label || m.role}
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => updateRoleMutation.mutate({ memberId: m.id, role: e.target.value })}
                        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                      >
                        {ROLE_OPTIONS.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      m.isActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      {m.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {!isMe && (
                      <button
                        onClick={() => setConfirmRemove(m)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        title="Remove member"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmRemove && (
        <ConfirmModal
          title="Remove Member"
          message={`Remove ${confirmRemove.fullName || confirmRemove.email} from the organization? They will lose access to all projects.`}
          confirmLabel="Remove"
          variant="danger"
          onConfirm={() => removeMutation.mutate(confirmRemove.id)}
          onCancel={() => setConfirmRemove(null)}
          isPending={removeMutation.isPending}
        />
      )}

      {/* Viewer Invites — invite clients as free viewers */}
      <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
        <ViewerInvitePanel />
      </div>
    </div>
  );
};

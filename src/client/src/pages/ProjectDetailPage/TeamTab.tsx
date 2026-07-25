import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Trash2, Activity } from 'lucide-react';
import { apiService } from '../../services/api';
import { WorkloadHeatmap } from '../../components/resources/WorkloadHeatmap';
import { AvailabilityCalendar } from '../../components/resources/AvailabilityCalendar';
import { ResourceForecastPanel } from '../../components/resources/ResourceForecastPanel';
import { RebalanceSuggestions } from '../../components/resources/RebalanceSuggestions';
import { CapacityChart } from '../../components/resources/CapacityChart';

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  );
}

function ResourceAvailabilitySection({ resources }: { resources: any[] }) {
  const [selectedResourceId, setSelectedResourceId] = useState(resources[0]?.id || '');
  const selectedResource = resources.find((r: any) => r.id === selectedResourceId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Availability for:</label>
        <select
          value={selectedResourceId}
          onChange={e => setSelectedResourceId(e.target.value)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {resources.map((r: any) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      {selectedResource && (
        <AvailabilityCalendar
          resourceId={selectedResource.id}
          resourceName={selectedResource.name}
        />
      )}
    </div>
  );
}

function ResourceOptimizerSection({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['resourceForecast', projectId],
    queryFn: () => apiService.getResourceForecast(projectId),
    enabled: !!projectId,
  });

  const forecast = data?.result;

  if (isLoading) return <SectionSpinner />;
  if (error || !forecast) return null;

  return (
    <>
      <ResourceForecastPanel projectId={projectId} />

      {forecast.capacityForecast?.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Capacity Forecast</h3>
          <CapacityChart data={forecast.capacityForecast} />
        </div>
      )}

      {forecast.rebalanceSuggestions?.length > 0 && (
        <RebalanceSuggestions suggestions={forecast.rebalanceSuggestions} />
      )}
    </>
  );
}

export function TeamTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  const { data: workloadData, isLoading: workloadLoading } = useQuery({
    queryKey: ['resourceWorkload', projectId],
    queryFn: () => apiService.getResourceWorkload(projectId),
    enabled: !!projectId,
  });

  const { data: resourcesData, isLoading: resourcesLoading } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
  });

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['projectMembers', projectId],
    queryFn: () => apiService.getProjectMembers(projectId),
    enabled: !!projectId,
  });

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['auditTrail', projectId],
    queryFn: () => apiService.getAuditTrail(projectId),
    enabled: !!projectId,
  });

  const [showAddMember, setShowAddMember] = useState(false);
  const [newMember, setNewMember] = useState({ userName: '', email: '', role: 'editor' });

  const addMemberMutation = useMutation({
    mutationFn: (data: { userId?: string; userName: string; email: string; role: string }) =>
      apiService.addProjectMember(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
      setShowAddMember(false);
      setNewMember({ userName: '', email: '', role: 'editor' });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => apiService.removeProjectMember(projectId, memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] }),
  });

  const workload = workloadData?.workload || [];
  const resources = resourcesData?.resources || [];
  const members = membersData?.members || [];
  const auditActivities = auditData?.activities || [];

  const roleColors: Record<string, string> = {
    owner: 'bg-purple-100 text-purple-700',
    manager: 'bg-blue-100 text-blue-700',
    editor: 'bg-green-100 text-green-700',
    viewer: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
  };

  const handleAddMember = () => {
    if (!newMember.userName.trim() || !newMember.email.trim()) return;
    addMemberMutation.mutate({
      userName: newMember.userName,
      email: newMember.email,
      role: newMember.role,
    });
  };

  return (
    <div className="space-y-6">
      {/* Team Members Section */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-500" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Team Members</h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">({members.length})</span>
          </div>
          <button
            onClick={() => setShowAddMember(!showAddMember)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-100 dark:bg-primary-900/40 rounded-md transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Member
          </button>
        </div>

        {/* Add member form */}
        {showAddMember && (
          <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                type="text"
                placeholder="Name"
                value={newMember.userName}
                onChange={e => setNewMember({ ...newMember, userName: e.target.value })}
                className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <input
                type="email"
                placeholder="Email"
                value={newMember.email}
                onChange={e => setNewMember({ ...newMember, email: e.target.value })}
                className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <select
                value={newMember.role}
                onChange={e => setNewMember({ ...newMember, role: e.target.value })}
                className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
              <button
                onClick={handleAddMember}
                disabled={addMemberMutation.isPending}
                className="text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {addMemberMutation.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {membersLoading ? (
          <SectionSpinner />
        ) : (
          <div className="space-y-2">
            {members.map((member: any) => (
              <div key={member.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
                    <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                      {member.userName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{member.userName}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{member.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${roleColors[member.role] || roleColors.viewer}`}>
                    {member.role}
                  </span>
                  {member.role !== 'owner' && (
                    <button
                      onClick={() => removeMemberMutation.mutate(member.id)}
                      className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                      title="Remove member"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Log Section */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-green-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Activity Log</h3>
        </div>

        {auditLoading ? (
          <SectionSpinner />
        ) : auditActivities.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No activity recorded yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {auditActivities.map((entry: any) => (
              <div key={entry.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Activity className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 dark:text-gray-200">
                    <span className="font-medium">{entry.userName}</span>
                    {' '}{entry.action}{' '}
                    {entry.field && <span className="font-medium">{entry.field}</span>}
                    {entry.oldValue && entry.newValue && (
                      <span className="text-gray-400 dark:text-gray-500"> from "{entry.oldValue}" to "{entry.newValue}"</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resource Optimizer */}
      <ResourceOptimizerSection projectId={projectId} />

      {/* Workload Heatmap */}
      {(workloadLoading || resourcesLoading) ? (
        <SectionSpinner />
      ) : (
        <WorkloadHeatmap workload={workload} resources={resources} />
      )}

      {/* Resource Availability Calendar */}
      {resources.length > 0 && (
        <ResourceAvailabilitySection resources={resources} />
      )}
    </div>
  );
}

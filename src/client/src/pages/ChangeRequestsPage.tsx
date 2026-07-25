import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitPullRequest, Plus, Settings2, Trash2 } from 'lucide-react';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ChangeRequestList } from '../components/approvals/ChangeRequestList';
import { ChangeRequestForm } from '../components/approvals/ChangeRequestForm';
import { ChangeRequestDetail } from '../components/approvals/ChangeRequestDetail';
import { WorkflowEditor } from '../components/approvals/WorkflowEditor';

type Tab = 'requests' | 'workflows';
type View = 'list' | 'detail' | 'form' | 'workflow-editor';

export const ChangeRequestsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('requests');
  const [view, setView] = useState<View>('list');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedCRId, setSelectedCRId] = useState<string>('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | undefined>(undefined);
  const [confirmDeleteWf, setConfirmDeleteWf] = useState<{ id: string; name: string } | null>(null);

  // Fetch projects for selector
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });
  const projects: any[] = projectsData?.data || projectsData?.projects || [];

  // Auto-select first project
  React.useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Workflows query for the workflows tab
  const { data: workflowsData, isLoading: workflowsLoading } = useQuery({
    queryKey: ['approval-workflows', selectedProjectId],
    queryFn: () => apiService.getApprovalWorkflows(selectedProjectId),
    enabled: tab === 'workflows' && !!selectedProjectId,
  });
  const workflows: any[] = workflowsData?.workflows || [];

  const deleteWorkflowMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteApprovalWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approval-workflows', selectedProjectId] }),
  });

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setView('list');
    setSelectedCRId('');
    setSelectedWorkflowId(undefined);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitPullRequest className="w-6 h-6 text-gray-700 dark:text-gray-200" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Change Requests</h1>
        </div>
      </div>

      {/* Project Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600 dark:text-gray-300">Project:</label>
        <select
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setView('list');
            setSelectedCRId('');
          }}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 min-w-[240px]"
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-6">
          {(['requests', 'workflows'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-gray-900 text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:border-gray-600'
              }`}
            >
              {t === 'requests' ? 'Change Requests' : 'Approval Workflows'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {!selectedProjectId ? (
        <div className="text-center py-16">
          <GitPullRequest className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400 dark:text-gray-500">Select a project to view change requests</p>
        </div>
      ) : (
        <>
          {/* ===== REQUESTS TAB ===== */}
          {tab === 'requests' && view === 'list' && (
            <ChangeRequestList
              projectId={selectedProjectId}
              onSelect={(id) => {
                setSelectedCRId(id);
                setView('detail');
              }}
              onNew={() => {
                setSelectedCRId('');
                setView('form');
              }}
            />
          )}

          {tab === 'requests' && view === 'detail' && selectedCRId && (
            <ChangeRequestDetail
              crId={selectedCRId}
              onBack={() => {
                setView('list');
                setSelectedCRId('');
              }}
              onEdit={(id) => {
                setSelectedCRId(id);
                setView('form');
              }}
            />
          )}

          {tab === 'requests' && view === 'form' && (
            <ChangeRequestForm
              projectId={selectedProjectId}
              crId={selectedCRId || undefined}
              onClose={() => {
                setView(selectedCRId ? 'detail' : 'list');
              }}
              onSaved={() => {
                if (selectedCRId) {
                  setView('detail');
                } else {
                  setView('list');
                  setSelectedCRId('');
                }
              }}
            />
          )}

          {/* ===== WORKFLOWS TAB ===== */}
          {tab === 'workflows' && view === 'list' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Approval Workflows</h3>
                </div>
                <button
                  onClick={() => {
                    setSelectedWorkflowId(undefined);
                    setView('workflow-editor');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 dark:bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-500 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Workflow
                </button>
              </div>

              {workflowsLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-6 h-6 border-2 border-gray-200 dark:border-gray-700 border-t-gray-600 rounded-full animate-spin" />
                </div>
              ) : workflows.length === 0 ? (
                <div className="text-center py-12">
                  <Settings2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 dark:text-gray-500">No approval workflows defined</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create a workflow to define approval steps for change requests</p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Name</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Entity Type</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Steps</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {workflows.map((wf: any) => (
                        <tr key={wf.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                setSelectedWorkflowId(wf.id);
                                setView('workflow-editor');
                              }}
                              className="font-medium text-gray-900 dark:text-white hover:text-gray-700 dark:text-gray-200"
                            >
                              {wf.name}
                            </button>
                            {wf.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{wf.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded capitalize">
                              {(wf.entityType || '').replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            {wf.steps?.length || 0} step{(wf.steps?.length || 0) !== 1 ? 's' : ''}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setConfirmDeleteWf({ id: wf.id, name: wf.name })}
                              className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 transition-colors"
                              title="Delete workflow"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'workflows' && view === 'workflow-editor' && (
            <WorkflowEditor
              projectId={selectedProjectId}
              workflowId={selectedWorkflowId}
              onClose={() => setView('list')}
              onSaved={() => setView('list')}
            />
          )}
        </>
      )}

      {/* Delete Workflow Confirmation */}
      {confirmDeleteWf && (
        <ConfirmModal
          title="Delete Workflow"
          message={`Delete workflow "${confirmDeleteWf.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          isPending={deleteWorkflowMutation.isPending}
          onConfirm={() => { deleteWorkflowMutation.mutate(confirmDeleteWf.id); setConfirmDeleteWf(null); }}
          onCancel={() => setConfirmDeleteWf(null)}
        />
      )}
    </div>
  );
};

export default ChangeRequestsPage;

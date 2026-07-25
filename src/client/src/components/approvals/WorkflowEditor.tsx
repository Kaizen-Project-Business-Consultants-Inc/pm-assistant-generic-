import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  X,
  Save,
} from 'lucide-react';
import { apiService } from '../../services/api';

interface WorkflowEditorProps {
  projectId: string;
  workflowId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface WorkflowStep {
  id?: string;
  stepOrder: number;
  role: string;
  action: 'approve' | 'reject' | 'review';
}

const ENTITY_TYPES = ['change_request', 'task', 'budget'] as const;
const STEP_ACTIONS = ['approve', 'reject', 'review'] as const;

function entityTypeLabel(et: string): string {
  return et.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkflowEditor({ projectId, workflowId, onClose, onSaved }: WorkflowEditorProps) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entityType, setEntityType] = useState<string>('change_request');
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { stepOrder: 1, role: '', action: 'approve' },
  ]);

  // Fetch existing workflow when editing (no singular endpoint, so fetch all and find)
  const { data: existingWFData, isLoading: loadingWF } = useQuery({
    queryKey: ['approval-workflows', projectId],
    queryFn: () => apiService.getApprovalWorkflows(projectId),
    enabled: !!workflowId,
  });

  useEffect(() => {
    const wf = existingWFData?.workflows?.find((w: any) => w.id === workflowId);
    if (wf) {
      setName(wf.name || '');
      setDescription(wf.description || '');
      setEntityType(wf.entityType || 'change_request');
      if (wf.steps?.length > 0) {
        setSteps(
          wf.steps.map((s: any, idx: number) => ({
            id: s.id,
            stepOrder: s.stepOrder ?? idx + 1,
            role: s.role || '',
            action: s.action || 'approve',
          }))
        );
      }
    }
  }, [existingWFData, workflowId]);

  const saveMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; entityType: string; steps: any[] }) => {
      if (workflowId) {
        return apiService.updateApprovalWorkflow(workflowId, data);
      }
      return apiService.createApprovalWorkflow(projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-workflows', projectId] });
      if (workflowId) {
        queryClient.invalidateQueries({ queryKey: ['approval-workflows', projectId] });
      }
      onSaved();
    },
  });

  const handleAddStep = () => {
    setSteps((prev) => [
      ...prev,
      { stepOrder: prev.length + 1, role: '', action: 'approve' },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    setSteps((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((s, i) => ({ ...s, stepOrder: i + 1 }));
    });
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    setSteps((prev) => {
      const arr = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= arr.length) return arr;
      [arr[index], arr[targetIndex]] = [arr[targetIndex], arr[index]];
      return arr.map((s, i) => ({ ...s, stepOrder: i + 1 }));
    });
  };

  const handleStepChange = (index: number, field: keyof WorkflowStep, value: string) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const validSteps = steps.filter((s) => s.role.trim());
    if (validSteps.length === 0) return;

    saveMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      entityType,
      steps: validSteps.map((s) => ({
        stepOrder: s.stepOrder,
        role: s.role.trim(),
        action: s.action,
      })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {workflowId ? 'Edit Approval Workflow' : 'New Approval Workflow'}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadingWF ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Workflow Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Standard Change Approval"
                required
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe when this workflow should be used..."
                rows={2}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none dark:placeholder-gray-400"
              />
            </div>

            {/* Entity Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entity Type</label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {ENTITY_TYPES.map((et) => (
                  <option key={et} value={et}>
                    {entityTypeLabel(et)}
                  </option>
                ))}
              </select>
            </div>

            {/* Steps */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Approval Steps</label>
                <button
                  type="button"
                  onClick={handleAddStep}
                  className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Step
                </button>
              </div>

              {steps.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  No steps defined. Add at least one step.
                </p>
              ) : (
                <div className="space-y-2">
                  {steps.map((step, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                    >
                      {/* Order indicator */}
                      <span className="text-xs font-bold text-gray-400 w-6 text-center flex-shrink-0">
                        {step.stepOrder}
                      </span>

                      {/* Role */}
                      <input
                        type="text"
                        value={step.role}
                        onChange={(e) => handleStepChange(index, 'role', e.target.value)}
                        placeholder="Role (e.g., Project Manager)"
                        className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />

                      {/* Action */}
                      <select
                        value={step.action}
                        onChange={(e) => handleStepChange(index, 'action', e.target.value)}
                        className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-28 flex-shrink-0"
                      >
                        {STEP_ACTIONS.map((a) => (
                          <option key={a} value={a}>
                            {a.charAt(0).toUpperCase() + a.slice(1)}
                          </option>
                        ))}
                      </select>

                      {/* Reorder buttons */}
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMoveStep(index, 'up')}
                          disabled={index === 0}
                          className="p-0.5 text-gray-400 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move up"
                          aria-label="Move step up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveStep(index, 'down')}
                          disabled={index === steps.length - 1}
                          className="p-0.5 text-gray-400 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move down"
                          aria-label="Move step down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => handleRemoveStep(index)}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
                        title="Remove step"
                        aria-label="Remove step"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Error */}
            {saveMutation.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Failed to save workflow. Please try again.
              </p>
            )}

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saveMutation.isPending || !name.trim() || steps.filter((s) => s.role.trim()).length === 0}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? 'Saving...' : 'Save Workflow'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

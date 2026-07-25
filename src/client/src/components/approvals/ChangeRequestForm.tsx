import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, X } from 'lucide-react';
import { apiService } from '../../services/api';

interface ChangeRequestFormProps {
  projectId: string;
  crId?: string;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES = ['scope', 'schedule', 'budget', 'resource', 'other'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export function ChangeRequestForm({ projectId, crId, onClose, onSaved }: ChangeRequestFormProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('scope');
  const [priority, setPriority] = useState<string>('medium');
  const [impactSummary, setImpactSummary] = useState('');

  // Fetch existing CR when editing
  const { data: existingCR, isLoading: loadingCR } = useQuery({
    queryKey: ['change-request', crId],
    queryFn: () => apiService.getChangeRequestDetail(crId!),
    enabled: !!crId,
  });

  useEffect(() => {
    if (existingCR?.changeRequest) {
      const cr = existingCR.changeRequest;
      setTitle(cr.title || '');
      setDescription(cr.description || '');
      setCategory(cr.category || 'scope');
      setPriority(cr.priority || 'medium');
      setImpactSummary(cr.impactSummary || '');
    }
  }, [existingCR]);

  const saveMutation = useMutation({
    mutationFn: (data: { title: string; description: string; category: string; priority?: string; impactSummary?: string }) => {
      if (crId) {
        return apiService.updateChangeRequest(crId, data);
      }
      return apiService.createChangeRequest(projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-requests', projectId] });
      if (crId) {
        queryClient.invalidateQueries({ queryKey: ['change-request', crId] });
      }
      onSaved();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    saveMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      category,
      priority,
      impactSummary: impactSummary.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-full sm:max-w-lg mx-2 sm:mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {crId ? 'Edit Change Request' : 'New Change Request'}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        {loadingCR ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief title for the change request"
                required
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 dark:text-white"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed description of the proposed change..."
                rows={4}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none bg-white dark:bg-gray-900 dark:text-white"
              />
            </div>

            {/* Category + Priority */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 dark:text-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 dark:text-white"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Impact Summary */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Impact Summary</label>
              <textarea
                value={impactSummary}
                onChange={(e) => setImpactSummary(e.target.value)}
                placeholder="Describe the expected impact on scope, schedule, budget, or resources..."
                rows={3}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none bg-white dark:bg-gray-900 dark:text-white"
              />
            </div>

            {/* Error */}
            {saveMutation.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Failed to save change request. Please try again.
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
                disabled={saveMutation.isPending || !title.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

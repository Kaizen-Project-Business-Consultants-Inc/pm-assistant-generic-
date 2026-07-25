import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Save, Plus, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';

interface CustomFieldEditorModalProps {
  projectId: string;
  entityType: string;
  field: any | null; // null = create mode
  onClose: () => void;
}

export function CustomFieldEditorModal({ projectId, entityType, field, onClose }: CustomFieldEditorModalProps) {
  const queryClient = useQueryClient();
  const isEdit = !!field;

  const [form, setForm] = useState({
    fieldLabel: field?.fieldLabel || '',
    fieldName: field?.fieldName || '',
    fieldType: field?.fieldType || 'text',
    options: field?.options || [] as string[],
    isRequired: field?.isRequired || false,
  });
  const [newOption, setNewOption] = useState('');

  const createMutation = useMutation({
    mutationFn: () => apiService.createCustomField(projectId, {
      entityType,
      fieldName: form.fieldName || form.fieldLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      fieldLabel: form.fieldLabel,
      fieldType: form.fieldType,
      options: form.fieldType === 'dropdown' ? form.options : undefined,
      isRequired: form.isRequired,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields', projectId, entityType] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => apiService.updateCustomField(field.id, {
      fieldLabel: form.fieldLabel,
      fieldType: form.fieldType,
      options: form.fieldType === 'dropdown' ? form.options : undefined,
      isRequired: form.isRequired,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields', projectId, entityType] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fieldLabel.trim()) return;
    if (isEdit) updateMutation.mutate();
    else createMutation.mutate();
  };

  const addOption = () => {
    if (newOption.trim()) {
      setForm(p => ({ ...p, options: [...p.options, newOption.trim()] }));
      setNewOption('');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{isEdit ? 'Edit Field' : 'Add Custom Field'}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Label <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.fieldLabel}
              onChange={(e) => setForm(p => ({ ...p, fieldLabel: e.target.value }))}
              placeholder="e.g. Contract Number"
              className="input w-full"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
            <select
              value={form.fieldType}
              onChange={(e) => setForm(p => ({ ...p, fieldType: e.target.value }))}
              className="input w-full"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="dropdown">Dropdown</option>
              <option value="checkbox">Checkbox</option>
            </select>
          </div>

          {form.fieldType === 'dropdown' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Options</label>
              <div className="space-y-1 mb-2">
                {form.options.map((opt: string, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{opt}</span>
                    <button
                      type="button"
                      onClick={() => setForm(p => ({ ...p, options: p.options.filter((_: string, j: number) => j !== i) }))}
                      className="text-red-400 hover:text-red-600"
                      aria-label="Remove option"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="Add option..."
                  className="input flex-1 text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
                />
                <button type="button" onClick={addOption} className="p-1.5 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded" aria-label="Add option">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={form.isRequired}
              onChange={(e) => setForm(p => ({ ...p, isRequired: e.target.checked }))}
              className="rounded border-gray-300 dark:border-gray-600 text-primary-600"
            />
            Required field
          </label>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !form.fieldLabel.trim()}
              className="btn btn-primary flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

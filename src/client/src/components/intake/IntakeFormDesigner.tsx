import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  ClipboardList,
  ArrowLeft,
  Eye,
} from 'lucide-react';
import { apiService } from '../../services/api';

type FieldType = 'text' | 'number' | 'date' | 'dropdown' | 'textarea' | 'checkbox';

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string; // comma-separated for dropdown
}

interface Props {
  formId?: string;
  onClose: () => void;
  onSaved: () => void;
}

const fieldTypes: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'checkbox', label: 'Checkbox' },
];

const fieldTypeBadgeColor: Record<FieldType, string> = {
  text: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  number: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  date: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  dropdown: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  textarea: 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400',
  checkbox: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400',
};

let fieldCounter = 0;
const nextFieldId = () => `field_${++fieldCounter}_${Date.now()}`;

export const IntakeFormDesigner: React.FC<Props> = ({ formId, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [addType, setAddType] = useState<FieldType>('text');

  // Load existing form if editing
  const { data: existingForm } = useQuery({
    queryKey: ['intake-form', formId],
    queryFn: () => apiService.getIntakeForm(formId!),
    enabled: !!formId,
  });

  useEffect(() => {
    if (existingForm?.form) {
      const form = existingForm.form;
      setName(form.name || '');
      setDescription(form.description || '');
      if (form.fields && Array.isArray(form.fields)) {
        setFields(
          form.fields.map((f: any) => ({
            id: f.id || nextFieldId(),
            label: f.label || '',
            type: f.type || 'text',
            required: !!f.required,
            options: Array.isArray(f.options) ? f.options.join(', ') : f.options || '',
          })),
        );
      }
    }
  }, [existingForm]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (payload: any) => {
      if (formId) {
        return apiService.updateIntakeForm(formId, payload);
      }
      return apiService.createIntakeForm(payload);
    },
    onSuccess: () => onSaved(),
  });

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { id: nextFieldId(), label: '', type: addType, required: false, options: '' },
    ]);
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= fields.length) return;
    const updated = [...fields];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setFields(updated);
  };

  const handleSave = () => {
    const payload = {
      name,
      description,
      fields: fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options:
          f.type === 'dropdown'
            ? f.options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
      })),
    };
    saveMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="w-5 h-5" />
            {formId ? 'Edit Intake Form' : 'New Intake Form'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Design the fields that submitters will fill out
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="space-y-5">
          {/* Form metadata */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Form Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. New Project Request"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the purpose of this form..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-white dark:bg-gray-900 dark:text-white"
              />
            </div>
          </div>

          {/* Fields builder */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Fields</h2>
              <div className="flex items-center gap-2">
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value as FieldType)}
                  className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 dark:text-white"
                >
                  {fieldTypes.map((ft) => (
                    <option key={ft.value} value={ft.value}>
                      {ft.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={addField}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Field
                </button>
              </div>
            </div>

            {fields.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">
                No fields yet. Add fields using the button above.
              </p>
            )}

            <div className="space-y-3">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3 bg-gray-50 dark:bg-gray-900/50"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        fieldTypeBadgeColor[field.type]
                      }`}
                    >
                      {field.type}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => moveField(index, 'up')}
                      disabled={index === 0}
                      className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Move field up"
                    >
                      <ArrowUp className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                    </button>
                    <button
                      onClick={() => moveField(index, 'down')}
                      disabled={index === fields.length - 1}
                      className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Move field down"
                    >
                      <ArrowDown className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                    </button>
                    <button
                      onClick={() => removeField(field.id)}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                      aria-label="Remove field"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Field Label
                    </label>
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                      placeholder="e.g. Project Name"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 dark:text-white"
                    />
                  </div>

                  {field.type === 'dropdown' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        Options (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={field.options}
                        onChange={(e) => updateField(field.id, { options: e.target.value })}
                        placeholder="e.g. Option A, Option B, Option C"
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 dark:text-white"
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(field.id, { required: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400">Required</span>
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!name.trim() || saveMutation.isPending}
              className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saveMutation.isPending ? 'Saving…' : formId ? 'Update Form' : 'Create Form'}
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            {saveMutation.isError && (
              <span className="text-xs text-red-600 dark:text-red-400">Failed to save. Please try again.</span>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Preview</h2>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-5">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {name || 'Untitled Form'}
              </h3>
              {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
              )}
            </div>

            {fields.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">
                Add fields to see a preview
              </p>
            ) : (
              <div className="space-y-4">
                {fields.map((field) => (
                  <div key={field.id}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {field.label || 'Untitled Field'}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    {field.type === 'text' && (
                      <input
                        type="text"
                        disabled
                        placeholder="Text input"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-gray-400"
                      />
                    )}
                    {field.type === 'number' && (
                      <input
                        type="number"
                        disabled
                        placeholder="0"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-gray-400"
                      />
                    )}
                    {field.type === 'date' && (
                      <input
                        type="date"
                        disabled
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-gray-400"
                      />
                    )}
                    {field.type === 'textarea' && (
                      <textarea
                        disabled
                        placeholder="Long text input"
                        rows={3}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-gray-400 resize-none"
                      />
                    )}
                    {field.type === 'checkbox' && (
                      <div className="flex items-center gap-2">
                        <input type="checkbox" disabled className="rounded border-gray-300 dark:border-gray-600" />
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {field.label || 'Checkbox'}
                        </span>
                      </div>
                    )}
                    {field.type === 'dropdown' && (
                      <select
                        disabled
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-gray-400"
                      >
                        <option>Select an option...</option>
                        {field.options
                          .split(',')
                          .map((o) => o.trim())
                          .filter(Boolean)
                          .map((opt, i) => (
                            <option key={i}>{opt}</option>
                          ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

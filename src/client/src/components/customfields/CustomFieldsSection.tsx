import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiService } from '../../services/api';

interface CustomFieldsSectionProps {
  entityType: 'task' | 'project';
  entityId: string;
  projectId: string;
}

export function CustomFieldsSection({ entityType, entityId, projectId }: CustomFieldsSectionProps) {
  const [values, setValues] = useState<Record<string, any>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['custom-field-values', entityType, entityId, projectId],
    queryFn: () => apiService.getCustomFieldValues(entityType, entityId, projectId),
    enabled: !!entityId && !!projectId,
  });

  const fields: any[] = data?.fields || [];

  // Initialize values from data
  useEffect(() => {
    if (fields.length > 0) {
      const vals: Record<string, any> = {};
      for (const f of fields) {
        if (f.value) {
          switch (f.fieldType) {
            case 'text': case 'dropdown': vals[f.id] = f.value.valueText || ''; break;
            case 'number': vals[f.id] = f.value.valueNumber ?? ''; break;
            case 'date': vals[f.id] = f.value.valueDate || ''; break;
            case 'checkbox': vals[f.id] = f.value.valueBoolean || false; break;
          }
        } else {
          vals[f.id] = f.fieldType === 'checkbox' ? false : '';
        }
      }
      setValues(vals);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: Array<{ fieldId: string; text?: string; number?: number; date?: string; boolean?: boolean }>) =>
      apiService.saveCustomFieldValues(entityType, entityId, payload),
  });

  const handleBlur = useCallback((field: any) => {
    const val = values[field.id];
    const payload: any = { fieldId: field.id };
    switch (field.fieldType) {
      case 'text': case 'dropdown': payload.text = val || ''; break;
      case 'number': payload.number = val !== '' ? Number(val) : null; break;
      case 'date': payload.date = val || null; break;
      case 'checkbox': payload.boolean = !!val; break;
    }
    saveMutation.mutate([payload]);
  }, [values, saveMutation, entityType, entityId]);

  if (isLoading) return null;
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Custom Fields</h4>
      {fields.map((field: any) => (
        <div key={field.id}>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {field.fieldLabel}
            {field.isRequired && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {field.fieldType === 'text' && (
            <input
              type="text"
              value={values[field.id] || ''}
              onChange={(e) => setValues(p => ({ ...p, [field.id]: e.target.value }))}
              onBlur={() => handleBlur(field)}
              className="input w-full text-sm"
            />
          )}
          {field.fieldType === 'number' && (
            <input
              type="number"
              value={values[field.id] ?? ''}
              onChange={(e) => setValues(p => ({ ...p, [field.id]: e.target.value }))}
              onBlur={() => handleBlur(field)}
              className="input w-full text-sm"
            />
          )}
          {field.fieldType === 'date' && (
            <input
              type="date"
              value={values[field.id] || ''}
              onChange={(e) => { setValues(p => ({ ...p, [field.id]: e.target.value })); }}
              onBlur={() => handleBlur(field)}
              className="input w-full text-sm"
            />
          )}
          {field.fieldType === 'dropdown' && (
            <select
              value={values[field.id] || ''}
              onChange={(e) => {
                setValues(p => ({ ...p, [field.id]: e.target.value }));
                // Auto-save on dropdown change
                setTimeout(() => handleBlur(field), 0);
              }}
              className="input w-full text-sm"
            >
              <option value="">Select...</option>
              {(field.options || []).map((opt: string) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          {field.fieldType === 'checkbox' && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={!!values[field.id]}
                onChange={(e) => {
                  setValues(p => ({ ...p, [field.id]: e.target.checked }));
                  setTimeout(() => {
                    saveMutation.mutate([{ fieldId: field.id, boolean: e.target.checked }]);
                  }, 0);
                }}
                className="rounded border-gray-300 dark:border-gray-600 text-primary-600"
              />
              {field.fieldLabel}
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck, Plus, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { apiService } from '../../services/api';
import { v4 as uuidv4 } from 'uuid';

interface DefinitionsPanelProps {
  projectId: string;
  isManager?: boolean;
}

interface Criterion {
  id: string;
  label: string;
  order: number;
}

const DEFAULT_DOR_SUGGESTIONS = [
  'User story follows INVEST criteria',
  'Acceptance criteria defined',
  'Dependencies identified',
  'Story points estimated',
  'Design reviewed (if applicable)',
];

const DEFAULT_DOD_SUGGESTIONS = [
  'Code complete and reviewed',
  'Unit tests written and passing',
  'Integration tests passing',
  'Documentation updated',
  'Deployed to staging',
  'Product owner acceptance',
];

function DefinitionEditor({
  type,
  label,
  icon: Icon,
  criteria,
  onChange,
  onSave,
  saving,
  isManager,
}: {
  type: 'dor' | 'dod';
  label: string;
  icon: typeof Shield;
  criteria: Criterion[];
  onChange: (criteria: Criterion[]) => void;
  onSave: () => void;
  saving: boolean;
  isManager: boolean;
}) {
  const [newLabel, setNewLabel] = useState('');
  const suggestions = type === 'dor' ? DEFAULT_DOR_SUGGESTIONS : DEFAULT_DOD_SUGGESTIONS;
  const unusedSuggestions = suggestions.filter((s) => !criteria.some((c) => c.label === s));

  const addCriterion = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange([...criteria, { id: uuidv4(), label: trimmed, order: criteria.length }]);
  };

  const removeCriterion = (id: string) => {
    onChange(criteria.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })));
  };

  const moveCriterion = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= criteria.length) return;
    const updated = [...criteria];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    onChange(updated.map((c, i) => ({ ...c, order: i })));
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary-500" />
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{label}</h4>
        <span className="text-xs text-gray-400">{criteria.length} criteria</span>
      </div>

      <div className="p-4 space-y-2">
        {criteria.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            No criteria defined yet.
            {isManager && unusedSuggestions.length > 0 && ' Click suggestions below to add.'}
          </p>
        )}

        {criteria.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2 group">
            <span className="text-xs text-gray-400 w-5 text-right">{i + 1}.</span>
            <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{c.label}</span>
            {isManager && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => moveCriterion(i, -1)}
                  disabled={i === 0}
                  className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  tabIndex={0}
                  aria-label="Move up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => moveCriterion(i, 1)}
                  disabled={i === criteria.length - 1}
                  className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  tabIndex={0}
                  aria-label="Move down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => removeCriterion(c.id)}
                  className="p-0.5 text-gray-400 hover:text-red-500"
                  tabIndex={0}
                  aria-label="Remove criterion"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}

        {isManager && (
          <>
            <div className="flex gap-2 mt-3">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addCriterion(newLabel); setNewLabel(''); }
                }}
                placeholder="Add criterion..."
                maxLength={500}
                className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                onClick={() => { addCriterion(newLabel); setNewLabel(''); }}
                disabled={!newLabel.trim()}
                className="px-3 py-1.5 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 text-sm transition-colors"
                tabIndex={0}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {unusedSuggestions.length > 0 && criteria.length === 0 && (
              <div className="mt-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Suggestions</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {unusedSuggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => addCriterion(s)}
                      className="text-xs px-2 py-1 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      tabIndex={0}
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end mt-3">
              <button
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md bg-primary-600 hover:bg-primary-700 text-white font-medium disabled:opacity-50 transition-colors"
                tabIndex={0}
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function DefinitionsPanel({ projectId, isManager = false }: DefinitionsPanelProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['scrumDefinitions', projectId],
    queryFn: () => apiService.getScrumDefinitions(projectId),
    enabled: !!projectId,
  });

  const [dorCriteria, setDorCriteria] = useState<Criterion[]>([]);
  const [dodCriteria, setDodCriteria] = useState<Criterion[]>([]);

  useEffect(() => {
    if (data?.definitions) {
      setDorCriteria(data.definitions.dor?.criteria || []);
      setDodCriteria(data.definitions.dod?.criteria || []);
    }
  }, [data]);

  const dorMutation = useMutation({
    mutationFn: () => apiService.upsertScrumDefinition(projectId, 'dor', dorCriteria),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scrumDefinitions', projectId] }),
  });

  const dodMutation = useMutation({
    mutationFn: () => apiService.upsertScrumDefinition(projectId, 'dod', dodCriteria),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scrumDefinitions', projectId] }),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-48 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        <div className="h-48 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <DefinitionEditor
        type="dor"
        label="Definition of Ready"
        icon={Shield}
        criteria={dorCriteria}
        onChange={setDorCriteria}
        onSave={() => dorMutation.mutate()}
        saving={dorMutation.isPending}
        isManager={isManager}
      />
      <DefinitionEditor
        type="dod"
        label="Definition of Done"
        icon={ShieldCheck}
        criteria={dodCriteria}
        onChange={setDodCriteria}
        onSave={() => dodMutation.mutate()}
        saving={dodMutation.isPending}
        isManager={isManager}
      />
    </div>
  );
}

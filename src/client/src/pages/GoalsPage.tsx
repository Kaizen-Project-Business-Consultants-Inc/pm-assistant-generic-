import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, Plus, ChevronDown, ChevronRight, Edit2, Trash2, X } from 'lucide-react';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getApiErrorMessage } from '../utils/getApiErrorMessage';
import { useAuthStore } from '../stores/authStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goal {
  id: string;
  name: string;
  ownerId?: string;
  /** The owner's name, added by the goals list */
  ownerName?: string | null;
  description?: string;
  goalType: 'objective' | 'key_result';
  parentId?: string | null;
  status: 'on_track' | 'at_risk' | 'behind' | 'completed';
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string;
  startDate?: string;
  dueDate?: string;
  projectId?: string | null;
  progress?: number;
  children?: Goal[];
}

interface GoalFormData {
  name: string;
  description: string;
  goalType: 'objective' | 'key_result';
  parentId: string;
  status: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  startDate: string;
  dueDate: string;
  projectId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  on_track: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  at_risk: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  behind: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

const STATUS_BAR_COLORS: Record<string, string> = {
  on_track: 'bg-green-500',
  at_risk: 'bg-amber-500',
  behind: 'bg-red-500',
  completed: 'bg-blue-500',
};

const STATUS_OPTIONS = ['on_track', 'at_risk', 'behind', 'completed'];

const EMPTY_FORM: GoalFormData = {
  name: '',
  description: '',
  goalType: 'objective',
  parentId: '',
  status: 'on_track',
  targetValue: '',
  currentValue: '',
  unit: '',
  startDate: '',
  dueDate: '',
  projectId: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_COLORS[status] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function progressPercent(goal: Goal): number {
  if (goal.progress != null) return Math.min(100, Math.max(0, goal.progress));
  if (goal.targetValue && goal.targetValue > 0 && goal.currentValue != null) {
    return Math.min(100, Math.max(0, Math.round((goal.currentValue / goal.targetValue) * 100)));
  }
  return goal.status === 'completed' ? 100 : 0;
}

function buildTree(goals: Goal[]): Goal[] {
  const map = new Map<string, Goal>();
  const roots: Goal[] = [];
  goals.forEach((g) => map.set(g.id, { ...g, children: [] }));
  goals.forEach((g) => {
    const node = map.get(g.id)!;
    if (g.parentId && map.has(g.parentId)) {
      map.get(g.parentId)!.children!.push(node);
    } else if (g.goalType === 'objective' || !g.parentId) {
      roots.push(node);
    }
  });
  return roots;
}

// ---------------------------------------------------------------------------
// GoalModal
// ---------------------------------------------------------------------------

/**
 * What the server accepts: numbers as numbers, and optional fields left OUT when empty (an empty
 * number box or date sent as "" is refused). Used for both create and edit.
 */
export function goalPayload(form: GoalFormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === '' || v === null || v === undefined) continue;
    out[k] = (k === 'targetValue' || k === 'currentValue') ? Number(v) : v;
  }
  if (out.goalType !== 'key_result') delete out.parentId;
  return out;
}

const GoalModal: React.FC<{
  initial?: GoalFormData;
  objectives: Goal[];
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (data: GoalFormData) => void;
  isSubmitting: boolean;
  title: string;
  /** Why the server refused the save (shown in the form, so a failure is never silent) */
  error?: string | null;
}> = ({ initial, objectives, projects, onClose, onSubmit, isSubmitting, title, error }) => {
  const [form, setForm] = useState<GoalFormData>(initial || EMPTY_FORM);
  const update = (field: keyof GoalFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Target className="w-5 h-5 text-green-600" />
            {title}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" required />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} className="input w-full resize-y dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
              <select value={form.goalType} onChange={(e) => update('goalType', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
                <option value="objective">Objective</option>
                <option value="key_result">Key Result</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
              <select value={form.status} onChange={(e) => update('status', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          {form.goalType === 'key_result' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Parent Objective</label>
              <select value={form.parentId} onChange={(e) => update('parentId', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
                <option value="">None</option>
                {objectives.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Target Value</label>
              <input type="number" value={form.targetValue} onChange={(e) => update('targetValue', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Value</label>
              <input type="number" value={form.currentValue} onChange={(e) => update('currentValue', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Unit</label>
              <input type="text" value={form.unit} onChange={(e) => update('unit', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" placeholder="e.g. %" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date</label>
              <input type="date" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Due Date</label>
              <input type="date" value={form.dueDate} onChange={(e) => update('dueDate', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Project</label>
            <select value={form.projectId} onChange={(e) => update('projectId', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
              <option value="">None (standalone goal)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </form>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          {error && <p role="alert" className="mr-auto text-sm text-red-700 dark:text-red-300">{error}</p>}
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">Cancel</button>
          <button onClick={() => { if (form.name.trim()) onSubmit(form); }} disabled={isSubmitting || !form.name.trim()} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {isSubmitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// KeyResultRow
// ---------------------------------------------------------------------------

/** "You" for your own goals, otherwise the owner's name */
function useOwnerLabel(goal: Goal): string | null {
  const myId = useAuthStore(s => s.user?.id);
  if (goal.ownerId && goal.ownerId === myId) return 'You';
  return goal.ownerName || null;
}

const KeyResultRow: React.FC<{ kr: Goal; onEdit: (g: Goal) => void; onDelete: (id: string) => void }> = ({ kr, onEdit, onDelete }) => {
  const owner = useOwnerLabel(kr);
  const pct = progressPercent(kr);
  return (
    <div className="flex items-center gap-4 py-2 px-4 ml-8 border-l-2 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{kr.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {kr.currentValue ?? 0} / {kr.targetValue ?? '?'} {kr.unit || ''}{owner ? ` · ${owner}` : ''}
        </p>
      </div>
      {statusBadge(kr.status)}
      <div className="w-20 flex items-center gap-1">
        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-gray-500 w-7 text-right">{pct}%</span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onEdit(kr)} className="p-1 rounded text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Edit key result"><Edit2 className="w-3.5 h-3.5" /></button>
        <button onClick={() => onDelete(kr.id)} className="p-1 rounded text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Delete key result"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ObjectiveRow
// ---------------------------------------------------------------------------

const ObjectiveRow: React.FC<{ obj: Goal; onEdit: (g: Goal) => void; onDelete: (id: string) => void }> = ({ obj, onEdit, onDelete }) => {
  const owner = useOwnerLabel(obj);
  const [expanded, setExpanded] = useState(false);
  const pct = progressPercent(obj);
  const hasChildren = obj.children && obj.children.length > 0;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => hasChildren && setExpanded(!expanded)}>
        <div className="w-5 h-5 flex items-center justify-center text-gray-500 dark:text-gray-400">
          {hasChildren ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <Target className="w-4 h-4 text-green-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{obj.name}</p>
          {owner && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Owner: {owner}</p>}
        </div>
        {statusBadge(obj.status)}
        <div className="w-28 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${STATUS_BAR_COLORS[obj.status] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">{pct}%</span>
        </div>
        {obj.dueDate && <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{obj.dueDate.slice(0, 10)}</span>}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onEdit(obj)} className="p-1 rounded text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Edit objective"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(obj.id)} className="p-1 rounded text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Delete objective"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="bg-gray-50 dark:bg-gray-900/50 py-1">
          {obj.children!.map((kr) => (
            <KeyResultRow key={kr.id} kr={kr} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GoalsPage
// ---------------------------------------------------------------------------

export const GoalsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });
  const projectsList: Array<{ id: string; name: string }> = projectsData?.data || projectsData?.projects || [];

  const filters: Record<string, string> = {};
  if (filterStatus) filters.status = filterStatus;
  if (filterType) filters.goalType = filterType;

  const { data, isLoading } = useQuery({
    queryKey: ['goals', filters],
    queryFn: () => apiService.listGoals(filters),
  });

  const goals: Goal[] = data?.goals || data || [];
  const objectives = useMemo(() => goals.filter((g) => g.goalType === 'objective'), [goals]);
  const tree = useMemo(() => buildTree(goals), [goals]);

  const createMutation = useMutation({
    mutationFn: (formData: GoalFormData) => apiService.createGoal(goalPayload(formData)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      setShowModal(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: GoalFormData }) => apiService.updateGoal(id, goalPayload(formData)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      setEditingGoal(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteGoal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });

  const handleEdit = (goal: Goal) => setEditingGoal(goal);
  const handleDelete = (id: string) => setConfirmDeleteId(id);

  const editFormData: GoalFormData | undefined = editingGoal
    ? {
        name: editingGoal.name,
        description: editingGoal.description || '',
        goalType: editingGoal.goalType,
        parentId: editingGoal.parentId || '',
        status: editingGoal.status,
        targetValue: editingGoal.targetValue != null ? String(editingGoal.targetValue) : '',
        currentValue: editingGoal.currentValue != null ? String(editingGoal.currentValue) : '',
        unit: editingGoal.unit || '',
        startDate: editingGoal.startDate?.slice(0, 10) || '',
        dueDate: editingGoal.dueDate?.slice(0, 10) || '',
        projectId: editingGoal.projectId || '',
      }
    : undefined;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="w-6 h-6 text-green-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Goals & OKRs</h1>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors">
          <Plus className="w-4 h-4" /> New Goal
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input text-sm dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input text-sm dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
          <option value="">All Types</option>
          <option value="objective">Objectives</option>
          <option value="key_result">Key Results</option>
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading goals…</div>
      ) : tree.length === 0 ? (
        <div className="text-center py-12">
          <Target className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">No goals found. Create your first objective to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tree.map((obj) => (
            <ObjectiveRow key={obj.id} obj={obj} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <GoalModal
          objectives={objectives}
          projects={projectsList}
          onClose={() => setShowModal(false)}
          onSubmit={(d) => createMutation.mutate(d)}
          isSubmitting={createMutation.isPending}
          error={createMutation.isError ? getApiErrorMessage(createMutation.error, 'The goal could not be saved.') : null}
          title="New Goal"
        />
      )}

      {/* Delete Confirmation */}
      {confirmDeleteId && (
        <ConfirmModal
          title="Delete Goal"
          message="Are you sure you want to delete this goal? This cannot be undone."
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => { deleteMutation.mutate(confirmDeleteId); setConfirmDeleteId(null); }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {/* Edit Modal */}
      {editingGoal && editFormData && (
        <GoalModal
          initial={editFormData}
          objectives={objectives.filter((o) => o.id !== editingGoal.id)}
          projects={projectsList}
          onClose={() => setEditingGoal(null)}
          onSubmit={(d) => updateMutation.mutate({ id: editingGoal.id, formData: d })}
          isSubmitting={updateMutation.isPending}
          error={updateMutation.isError ? getApiErrorMessage(updateMutation.error, 'The goal could not be saved.') : null}
          title="Edit Goal"
        />
      )}
    </div>
  );
};

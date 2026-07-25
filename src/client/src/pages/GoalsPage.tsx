import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, Plus, ChevronDown, ChevronRight, Edit2, Trash2, X } from 'lucide-react';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goal {
  id: string;
  name: string;
  description?: string;
  goal_type: 'objective' | 'key_result';
  parent_id?: string | null;
  status: 'on_track' | 'at_risk' | 'behind' | 'completed';
  target_value?: number | null;
  current_value?: number | null;
  unit?: string;
  start_date?: string;
  due_date?: string;
  project_id?: string | null;
  owner?: string;
  progress?: number;
  children?: Goal[];
}

interface GoalFormData {
  name: string;
  description: string;
  goal_type: 'objective' | 'key_result';
  parent_id: string;
  status: string;
  target_value: string;
  current_value: string;
  unit: string;
  start_date: string;
  due_date: string;
  project_id: string;
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
  goal_type: 'objective',
  parent_id: '',
  status: 'on_track',
  target_value: '',
  current_value: '',
  unit: '',
  start_date: '',
  due_date: '',
  project_id: '',
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
  if (goal.target_value && goal.target_value > 0 && goal.current_value != null) {
    return Math.min(100, Math.max(0, Math.round((goal.current_value / goal.target_value) * 100)));
  }
  return goal.status === 'completed' ? 100 : 0;
}

function buildTree(goals: Goal[]): Goal[] {
  const map = new Map<string, Goal>();
  const roots: Goal[] = [];
  goals.forEach((g) => map.set(g.id, { ...g, children: [] }));
  goals.forEach((g) => {
    const node = map.get(g.id)!;
    if (g.parent_id && map.has(g.parent_id)) {
      map.get(g.parent_id)!.children!.push(node);
    } else if (g.goal_type === 'objective' || !g.parent_id) {
      roots.push(node);
    }
  });
  return roots;
}

// ---------------------------------------------------------------------------
// GoalModal
// ---------------------------------------------------------------------------

const GoalModal: React.FC<{
  initial?: GoalFormData;
  objectives: Goal[];
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (data: GoalFormData) => void;
  isSubmitting: boolean;
  title: string;
}> = ({ initial, objectives, projects, onClose, onSubmit, isSubmitting, title }) => {
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
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="Close">
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
              <select value={form.goal_type} onChange={(e) => update('goal_type', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
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

          {form.goal_type === 'key_result' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Parent Objective</label>
              <select value={form.parent_id} onChange={(e) => update('parent_id', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
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
              <input type="number" value={form.target_value} onChange={(e) => update('target_value', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Value</label>
              <input type="number" value={form.current_value} onChange={(e) => update('current_value', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Unit</label>
              <input type="text" value={form.unit} onChange={(e) => update('unit', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" placeholder="e.g. %" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={(e) => update('start_date', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => update('due_date', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Project</label>
            <select value={form.project_id} onChange={(e) => update('project_id', e.target.value)} className="input w-full dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
              <option value="">None (standalone goal)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </form>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">Cancel</button>
          <button onClick={() => { if (form.name.trim()) onSubmit(form); }} disabled={isSubmitting || !form.name.trim()} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// KeyResultRow
// ---------------------------------------------------------------------------

const KeyResultRow: React.FC<{ kr: Goal; onEdit: (g: Goal) => void; onDelete: (id: string) => void }> = ({ kr, onEdit, onDelete }) => {
  const pct = progressPercent(kr);
  return (
    <div className="flex items-center gap-4 py-2 px-4 ml-8 border-l-2 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{kr.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {kr.current_value ?? 0} / {kr.target_value ?? '?'} {kr.unit || ''}
        </p>
      </div>
      {statusBadge(kr.status)}
      <div className="w-20 flex items-center gap-1">
        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-gray-400 w-7 text-right">{pct}%</span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onEdit(kr)} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Edit key result"><Edit2 className="w-3.5 h-3.5" /></button>
        <button onClick={() => onDelete(kr.id)} className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Delete key result"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ObjectiveRow
// ---------------------------------------------------------------------------

const ObjectiveRow: React.FC<{ obj: Goal; onEdit: (g: Goal) => void; onDelete: (id: string) => void }> = ({ obj, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const pct = progressPercent(obj);
  const hasChildren = obj.children && obj.children.length > 0;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => hasChildren && setExpanded(!expanded)}>
        <div className="w-5 h-5 flex items-center justify-center text-gray-400 dark:text-gray-500">
          {hasChildren ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <Target className="w-4 h-4 text-green-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{obj.name}</p>
          {obj.owner && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{obj.owner}</p>}
        </div>
        {statusBadge(obj.status)}
        <div className="w-28 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${STATUS_BAR_COLORS[obj.status] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">{pct}%</span>
        </div>
        {obj.due_date && <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{obj.due_date.slice(0, 10)}</span>}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onEdit(obj)} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Edit objective"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(obj.id)} className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Delete objective"><Trash2 className="w-3.5 h-3.5" /></button>
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
  if (filterType) filters.goal_type = filterType;

  const { data, isLoading } = useQuery({
    queryKey: ['goals', filters],
    queryFn: () => apiService.listGoals(filters),
  });

  const goals: Goal[] = data?.goals || data || [];
  const objectives = useMemo(() => goals.filter((g) => g.goal_type === 'objective'), [goals]);
  const tree = useMemo(() => buildTree(goals), [goals]);

  const createMutation = useMutation({
    mutationFn: (formData: GoalFormData) => {
      const payload: any = { ...formData };
      if (payload.target_value) payload.target_value = Number(payload.target_value);
      if (payload.current_value) payload.current_value = Number(payload.current_value);
      if (!payload.parent_id) delete payload.parent_id;
      if (!payload.project_id) delete payload.project_id;
      return apiService.createGoal(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      setShowModal(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: GoalFormData }) => {
      const payload: any = { ...formData };
      if (payload.target_value) payload.target_value = Number(payload.target_value);
      if (payload.current_value) payload.current_value = Number(payload.current_value);
      if (!payload.parent_id) delete payload.parent_id;
      if (!payload.project_id) delete payload.project_id;
      return apiService.updateGoal(id, payload);
    },
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
        goal_type: editingGoal.goal_type,
        parent_id: editingGoal.parent_id || '',
        status: editingGoal.status,
        target_value: editingGoal.target_value != null ? String(editingGoal.target_value) : '',
        current_value: editingGoal.current_value != null ? String(editingGoal.current_value) : '',
        unit: editingGoal.unit || '',
        start_date: editingGoal.start_date?.slice(0, 10) || '',
        due_date: editingGoal.due_date?.slice(0, 10) || '',
        project_id: editingGoal.project_id || '',
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
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading goals...</div>
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
          title="Edit Goal"
        />
      )}
    </div>
  );
};

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, X, Calendar } from 'lucide-react';
import { apiService } from '../../services/api';

interface CalendarTemplate {
  id: string;
  name: string;
  workingDays: string[];
  hoursPerDay: number;
  isDefault: boolean;
}

const DAY_OPTIONS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

export function CalendarTemplateManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDays, setFormDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [formHours, setFormHours] = useState('8');
  const [formDefault, setFormDefault] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['calendarTemplates'],
    queryFn: () => apiService.getCalendarTemplates(),
  });
  const templates: CalendarTemplate[] = data?.templates || [];

  const createMutation = useMutation({
    mutationFn: (d: { name: string; workingDays: string[]; hoursPerDay: number; isDefault: boolean }) =>
      apiService.createCalendarTemplate(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['calendarTemplates'] }); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Record<string, unknown> }) =>
      apiService.updateCalendarTemplate(id, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['calendarTemplates'] }); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteCalendarTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendarTemplates'] }),
  });

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormName('');
    setFormDays(['mon', 'tue', 'wed', 'thu', 'fri']);
    setFormHours('8');
    setFormDefault(false);
  }

  function openEdit(t: CalendarTemplate) {
    setEditingId(t.id);
    setFormName(t.name);
    setFormDays([...t.workingDays]);
    setFormHours(String(t.hoursPerDay));
    setFormDefault(t.isDefault);
    setShowForm(true);
  }

  function toggleDay(day: string) {
    setFormDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  function handleSave() {
    const d = { name: formName, workingDays: formDays, hoursPerDay: parseFloat(formHours) || 8, isDefault: formDefault };
    if (editingId) {
      updateMutation.mutate({ id: editingId, d });
    } else {
      createMutation.mutate(d);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Calendar className="w-4 h-4" /> Calendar Templates
        </h3>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700"
        >
          <Plus className="w-3 h-3" /> Add Template
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-primary-200 dark:border-primary-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900 dark:text-white">{editingId ? 'Edit Template' : 'New Template'}</span>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" placeholder="e.g. 4x10 Schedule" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Hours/Day</label>
              <input type="number" value={formHours} onChange={e => setFormHours(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" min="0.5" max="24" step="0.5" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={formDefault} onChange={e => setFormDefault(e.target.checked)} className="rounded border-gray-300" />
                Default template
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Working Days</label>
            <div className="flex gap-1.5">
              {DAY_OPTIONS.map(d => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${formDays.includes(d.key) ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleSave} disabled={!formName.trim() || formDays.length === 0} className="px-4 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center"><div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto" /></div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No calendar templates yet.</p>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{t.name}</span>
                  {t.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium">Default</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {t.workingDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')} — {t.hoursPerDay}h/day ({t.workingDays.length * t.hoursPerDay}h/week)
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(t)} className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Edit template"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => { if (confirm('Delete this calendar template?')) deleteMutation.mutate(t.id); }} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Delete template"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

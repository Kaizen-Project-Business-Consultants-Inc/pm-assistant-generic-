import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus } from 'lucide-react';
import { apiService } from '../../services/api';

interface TimeLogFormProps {
  taskId: string;
  scheduleId: string;
  projectId: string;
}

export function TimeLogForm({ taskId, scheduleId, projectId }: TimeLogFormProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    hours: '',
    description: '',
    billable: true,
  });

  const createMutation = useMutation({
    mutationFn: () => apiService.createTimeEntry({
      taskId, scheduleId, projectId,
      date: form.date,
      hours: parseFloat(form.hours),
      description: form.description || undefined,
      billable: form.billable,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      setForm({ date: new Date().toISOString().slice(0, 10), hours: '', description: '', billable: true });
      setExpanded(false);
    },
  });

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium"
      >
        <Clock className="w-3.5 h-3.5" />
        Log Time
      </button>
    );
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2 bg-gray-50 dark:bg-gray-800/50">
      <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> Log Time
      </h5>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Date</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))}
            className="input w-full text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Hours</label>
          <input
            type="number"
            step="0.25"
            min="0.25"
            value={form.hours}
            onChange={(e) => setForm(p => ({ ...p, hours: e.target.value }))}
            placeholder="0.0"
            className="input w-full text-xs"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Description</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
          placeholder="What did you work on?"
          className="input w-full text-xs"
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
        <input
          type="checkbox"
          checked={form.billable}
          onChange={(e) => setForm(p => ({ ...p, billable: e.target.checked }))}
          className="rounded border-gray-300 dark:border-gray-600 text-primary-600"
        />
        Billable
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => createMutation.mutate()}
          disabled={!form.hours || createMutation.isPending}
          className="btn btn-primary text-xs py-1 px-3 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          {createMutation.isPending ? 'Saving…' : 'Log'}
        </button>
        <button onClick={() => setExpanded(false)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

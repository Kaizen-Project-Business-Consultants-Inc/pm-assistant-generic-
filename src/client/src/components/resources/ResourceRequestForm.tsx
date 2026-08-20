import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus } from 'lucide-react';
import { apiService } from '../../services/api';

interface ResourceRequestFormProps {
  isOpen: boolean;
  onClose: () => void;
  editingRequest?: any;
}

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;
const ROLE_PRESETS = ['Developer', 'Designer', 'Project Manager', 'QA Engineer', 'Business Analyst', 'DevOps Engineer', 'Data Analyst'];

export function ResourceRequestForm({ isOpen, onClose, editingRequest }: ResourceRequestFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editingRequest;

  const [projectId, setProjectId] = useState(editingRequest?.projectId || '');
  const [resourceRole, setResourceRole] = useState(editingRequest?.resourceRole || '');
  const [resourceGroup, setResourceGroup] = useState(editingRequest?.resourceGroup || '');
  const [hoursNeeded, setHoursNeeded] = useState(String(editingRequest?.hoursNeeded || ''));
  const [startDate, setStartDate] = useState(editingRequest?.startDate || '');
  const [endDate, setEndDate] = useState(editingRequest?.endDate || '');
  const [justification, setJustification] = useState(editingRequest?.justification || '');
  const [priority, setPriority] = useState<string>(editingRequest?.priority || 'medium');
  const [skills, setSkills] = useState<string[]>(editingRequest?.skillsRequired || []);
  const [newSkill, setNewSkill] = useState('');

  const { data: projectsData } = useQuery({
    queryKey: ['pm-all-projects', false],
    queryFn: () => apiService.getProjects('portfolio', false),
    staleTime: 120_000,
    enabled: isOpen,
  });

  const projects = (projectsData?.data || projectsData?.projects || []) as Array<{ id: string; name: string }>;

  const mutation = useMutation({
    mutationFn: (data: any) => isEdit
      ? apiService.updateResourceRequest(editingRequest.id, data)
      : apiService.createResourceRequest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-requests'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      projectId,
      resourceRole,
      resourceGroup: resourceGroup || undefined,
      hoursNeeded: Number(hoursNeeded),
      startDate,
      endDate,
      justification: justification || undefined,
      skillsRequired: skills.length > 0 ? skills : undefined,
      priority,
    });
  };

  const addSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Edit Resource Request' : 'New Resource Request'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Project */}
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Project</label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              >
                <option value="">Select project...</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role Needed</label>
            <input
              value={resourceRole}
              onChange={e => setResourceRole(e.target.value)}
              required
              list="role-presets"
              placeholder="e.g., Senior Developer"
              className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
            <datalist id="role-presets">
              {ROLE_PRESETS.map(r => <option key={r} value={r} />)}
            </datalist>
          </div>

          {/* Group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Resource Group (optional)</label>
            <input
              value={resourceGroup}
              onChange={e => setResourceGroup(e.target.value)}
              placeholder="e.g., Engineering"
              className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
          </div>

          {/* Hours & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Hours Needed</label>
              <input
                type="number"
                value={hoursNeeded}
                onChange={e => setHoursNeeded(e.target.value)}
                required
                min="1"
                step="0.5"
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Skills */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Required Skills</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {skills.map(s => (
                <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs">
                  {s}
                  <button type="button" onClick={() => setSkills(skills.filter(sk => sk !== s))} className="hover:text-red-500">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newSkill}
                onChange={e => setNewSkill(e.target.value)}
                placeholder="Add skill..."
                className="flex-1 border rounded-lg px-3 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
              />
              <button type="button" onClick={addSkill} className="px-2 py-1.5 text-primary-600 hover:text-primary-700">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Justification */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Justification</label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
              placeholder="Why is this resource needed?"
              className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create Request'}
            </button>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">{(mutation.error as any)?.response?.data?.error || (mutation.error as Error).message}</p>
          )}
        </form>
      </div>
    </div>
  );
}

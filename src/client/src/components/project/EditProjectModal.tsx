import { useEffect, useState, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { AccessibleModal } from '../ui/AccessibleModal';
import { PROJECT_TYPE_OPTIONS } from '../../constants/projectTypes';

interface ProjectData {
  name: string;
  description?: string;
  category?: string;
  projectType?: string;
  methodology?: string;
  status?: string;
  priority?: string;
  budgetAllocated?: number | null;
  currency?: string;
  startDate?: string | null;
  endDate?: string | null;
  statusDate?: string | null;
  status_date?: string | null;
  location?: string;
  /** The client (project group) this project is for; null clears it */
  clientId?: string | null;
}

interface EditProjectModalProps {
  project: Record<string, any>;
  onSave: (data: Partial<ProjectData>) => void;
  onClose: () => void;
  saving?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  canDelete?: boolean; // false for SME/Enterprise
}

export function EditProjectModal({ project, onSave, onClose, saving, onDelete, deleting, canDelete }: EditProjectModalProps) {
  const uid = useId();
  const [name, setName] = useState(project.name || '');
  const [description, setDescription] = useState(project.description || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [category, setCategory] = useState(project.category || '');
  const [projectType, setProjectType] = useState(project.projectType || project.project_type || 'other');
  const [methodology, setMethodology] = useState(project.methodology || 'waterfall');
  const [priority, setPriority] = useState(project.priority || 'medium');
  const [budgetAllocated, setBudgetAllocated] = useState(
    project.budgetAllocated || project.budget_allocated || ''
  );
  const [currency, setCurrency] = useState(project.currency || 'USD');
  const [startDate, setStartDate] = useState(
    (project.startDate || project.start_date || '').slice(0, 10)
  );
  const [endDate, setEndDate] = useState(
    (project.endDate || project.end_date || '').slice(0, 10)
  );
  const [statusDate, setStatusDate] = useState(
    (project.statusDate || project.status_date || '').slice(0, 10)
  );
  const [location, setLocation] = useState(project.location || '');
  // Client (Oct 2026): who the project is for — one of the company's clients (project groups)
  const origClientId: string = project.clientId || project.groupId || '';
  const [clientId, setClientId] = useState(origClientId);
  const clientsQ = useQuery<{ groups: Array<{ id: string; name: string }> }>({ queryKey: ['project-groups'], queryFn: () => apiService.getProjectGroups(), staleTime: 120_000 });
  const clients = clientsQ.data?.groups ?? [];
  // Sponsor (Oct 2026): saved through its own endpoint; "user:<id>" | "person:<id>" | ""
  const projectId: string | undefined = project.id;
  const sponsorQ = useQuery({ queryKey: ['project-sponsor', projectId], queryFn: () => apiService.getProjectSponsor(projectId!), enabled: !!projectId });
  const candidatesQ = useQuery({ queryKey: ['sponsor-candidates', projectId], queryFn: () => apiService.getSponsorCandidates(projectId!), enabled: !!projectId });
  const currentSponsor = sponsorQ.data?.sponsor ? `${sponsorQ.data.sponsor.kind}:${sponsorQ.data.sponsor.id}` : '';
  const [sponsor, setSponsor] = useState<string | null>(null);
  useEffect(() => { if (sponsor === null && sponsorQ.isSuccess) setSponsor(currentSponsor); }, [sponsorQ.isSuccess, currentSponsor, sponsor]);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const [sponsorSaving, setSponsorSaving] = useState(false);
  const candidates = candidatesQ.data?.candidates ?? [];
  const withLogin = candidates.filter(c => c.kind === 'user');
  const withoutLogin = candidates.filter(c => c.kind === 'person');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (projectId && sponsor !== null && sponsor !== currentSponsor) {
      setSponsorError(null); setSponsorSaving(true);
      try {
        const [kind, id] = sponsor ? sponsor.split(':') : ['', ''];
        await apiService.setProjectSponsor(projectId, kind === 'user' ? { userId: id } : kind === 'person' ? { resourceId: id } : { userId: null, resourceId: null });
        sponsorQ.refetch();
      } catch (err) {
        setSponsorError(getApiErrorMessage(err, 'The sponsor could not be saved. Please try again.'));
        setSponsorSaving(false);
        return;
      }
      setSponsorSaving(false);
    }
    const data: Partial<ProjectData> = {};

    if (name !== project.name) data.name = name;
    if (description !== (project.description || '')) data.description = description;
    if (category !== (project.category || '')) data.category = category;
    if (projectType !== (project.projectType || project.project_type || 'other')) data.projectType = projectType;
    if (methodology !== (project.methodology || 'waterfall')) data.methodology = methodology;
    if (priority !== (project.priority || 'medium')) data.priority = priority;

    const origBudget = project.budgetAllocated || project.budget_allocated || '';
    const newBudget = budgetAllocated === '' ? undefined : Number(budgetAllocated);
    if (String(newBudget ?? '') !== String(origBudget)) data.budgetAllocated = newBudget ?? null;

    if (currency !== (project.currency || 'USD')) data.currency = currency;

    const origStart = (project.startDate || project.start_date || '').slice(0, 10);
    if (startDate !== origStart) data.startDate = startDate || null;

    const origEnd = (project.endDate || project.end_date || '').slice(0, 10);
    if (endDate !== origEnd) data.endDate = endDate || null;

    const origStatus = (project.statusDate || project.status_date || '').slice(0, 10);
    if (statusDate !== origStatus) data.statusDate = statusDate || null;

    if (location !== (project.location || '')) data.location = location;

    if (clientId !== origClientId) data.clientId = clientId || null;

    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }

    onSave(data);
  };

  const inputClass = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none';
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <AccessibleModal isOpen={true} onClose={onClose} ariaLabel="Edit Project" className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Project</h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-600 dark:hover:text-gray-200">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
        <div>
          <label htmlFor={`${uid}-project-name`} className={labelClass}>Project Name *</label>
          <input id={`${uid}-project-name`} type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
        </div>

        <div>
          <label htmlFor={`${uid}-description`} className={labelClass}>Description</label>
          <textarea id={`${uid}-description`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${uid}-priority`} className={labelClass}>Priority</label>
            <select id={`${uid}-priority`} value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-project-type`} className={labelClass}>Project Type</label>
            <select id={`${uid}-project-type`} value={projectType} onChange={(e) => setProjectType(e.target.value)} className={inputClass}>
              {PROJECT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-methodology`} className={labelClass}>Methodology</label>
          <select id={`${uid}-methodology`} value={methodology} onChange={(e) => setMethodology(e.target.value)} className={inputClass}>
            <option value="waterfall">Waterfall</option>
            <option value="agile">Agile</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-category`} className={labelClass}>Category</label>
          <input id={`${uid}-category`} type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. technology, commercial" className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${uid}-budget`} className={labelClass}>Budget</label>
            <input
              id={`${uid}-budget`}
              type="number"
              value={budgetAllocated}
              onChange={(e) => setBudgetAllocated(e.target.value)}
              min="0"
              step="any"
              placeholder="0.00"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-currency`} className={labelClass}>Currency</label>
            <select id={`${uid}-currency`} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="JMD">JMD</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${uid}-start-date`} className={labelClass}>Start Date</label>
            <input id={`${uid}-start-date`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${uid}-end-date`} className={labelClass}>End Date</label>
            <input id={`${uid}-end-date`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="project-status-date">Status Date</label>
          <input
            id="project-status-date"
            type="date"
            value={statusDate}
            onChange={(e) => setStatusDate(e.target.value)}
            className={inputClass}
            aria-describedby="project-status-date-help"
          />
          <p id="project-status-date-help" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            The day progress is measured as at, the same idea as Microsoft Project.
            Milestones and tasks are judged late against this date, so a report says the
            same thing to everyone and its figures do not drift. Leave blank to measure
            against today.
          </p>
        </div>

        {projectId && (
          <div>
            <label className={labelClass} htmlFor="project-sponsor">Sponsor</label>
            <select id="project-sponsor" value={sponsor ?? ''} onChange={(e) => setSponsor(e.target.value)}
              disabled={sponsor === null} className={inputClass} aria-describedby="project-sponsor-help">
              <option value="">No sponsor</option>
              {withLogin.length > 0 && (
                <optgroup label="People with a login">
                  {withLogin.map(c => <option key={c.id} value={`user:${c.id}`}>{c.name}</option>)}
                </optgroup>
              )}
              {withoutLogin.length > 0 && (
                <optgroup label="People without a login (emailed)">
                  {withoutLogin.map(c => <option key={c.id} value={`person:${c.id}`}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}
                </optgroup>
              )}
            </select>
            <p id="project-sponsor-help" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Who signs off budget and scope. They hear only what you choose to escalate from the RAID log, and never change anything. A sponsor with a login can read this project.
            </p>
            {sponsorError && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{sponsorError}</p>}
          </div>
        )}

        {(clients.length > 0 || origClientId) && (
          <div>
            <label htmlFor={`${uid}-client`} className={labelClass}>Client</label>
            <select id={`${uid}-client`} value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
              <option value="">No client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-location`} className={labelClass}>Location</label>
          <input id={`${uid}-location`} type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. New York, NY" className={inputClass} />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving || sponsorSaving || !name.trim()} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50">
            {saving || sponsorSaving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Delete Project — only for consultant tiers */}
      {onDelete && canDelete && (
        <div className="px-6 py-4 border-t border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10">
          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
            >
              <Trash2 className="w-4 h-4" />
              Delete Project
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-700 dark:text-red-400">
                This will <span className="font-semibold">permanently delete</span> the project, all tasks, schedules, and associated data. This cannot be undone.
              </p>
              <div>
                <label htmlFor={`${uid}-type-to-confirm`} className="block text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                  Type <span className="font-mono font-bold">{project.name}</span> to confirm
                </label>
                <input
                  id={`${uid}-type-to-confirm`}
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={project.name}
                  className="w-full rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleteConfirmName !== project.name || deleting}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleting ? 'Deleting…' : 'Delete Permanently'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(''); }}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </AccessibleModal>
  );
}

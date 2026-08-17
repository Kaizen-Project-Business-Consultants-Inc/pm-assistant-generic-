import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Sparkles, Loader2, MessageSquare, Send, Trash2, Pencil } from 'lucide-react';
import { apiService } from '../../services/api';
import { useModal } from '../../hooks/useModal';

interface RiskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  projectId: string;
  editRisk?: any;
  defaultType?: 'risk' | 'issue' | 'action' | 'decision';
  members?: any[];
}

const CATEGORIES = [
  { value: 'schedule', label: 'Schedule' },
  { value: 'budget', label: 'Budget' },
  { value: 'resource', label: 'Resource' },
  { value: 'technical', label: 'Technical' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'stakeholder', label: 'Stakeholder' },
  { value: 'weather', label: 'Weather' },
  { value: 'dependency', label: 'Dependency' },
  { value: 'other', label: 'Other' },
];

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const STATUSES: Record<string, readonly string[]> = {
  risk:     ['open', 'monitoring', 'mitigating', 'mitigated', 'closed'],
  issue:    ['open', 'in_progress', 'resolved', 'closed'],
  action:   ['open', 'in_progress', 'completed', 'closed', 'deferred'],
  decision: ['pending_decision', 'decided', 'deferred'],
};

const RAID_TYPES = [
  { value: 'risk', label: 'Risk', color: 'bg-red-600' },
  { value: 'issue', label: 'Issue', color: 'bg-orange-600' },
  { value: 'action', label: 'Action', color: 'bg-blue-600' },
  { value: 'decision', label: 'Decision', color: 'bg-purple-600' },
] as const;

const DEFAULT_STATUS: Record<string, string> = {
  risk: 'open',
  issue: 'open',
  action: 'open',
  decision: 'pending_decision',
};

export function RiskFormModal({ isOpen, onClose, onSaved, projectId, editRisk, defaultType = 'risk', members = [] }: RiskFormModalProps) {
  const [saving, setSaving] = useState(false);
  const [suggestingMitigation, setSuggestingMitigation] = useState(false);
  const [suggestingTrigger, setSuggestingTrigger] = useState(false);
  const [suggestingResponse, setSuggestingResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateText, setUpdateText] = useState('');
  const [sendingUpdate, setSendingUpdate] = useState(false);
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [editingUpdateText, setEditingUpdateText] = useState('');

  const [form, setForm] = useState({
    type: defaultType as string,
    title: '',
    description: '',
    category: 'other',
    severity: 'medium',
    probability: 3,
    impact: 3,
    status: DEFAULT_STATUS[defaultType] || 'open',
    triggerCondition: '',
    mitigationPlan: '',
    responsePlan: '',
    ownerId: '',
    linkedTaskIds: [] as string[],
    // Issue-specific fields
    rootCause: '',
    impactAssessment: '',
    workaround: '',
    // Action fields
    dueDate: '',
    actionType: '' as string,
    // Decision fields
    rationale: '',
    decidedBy: '',
    decisionDate: '',
    alternativesConsidered: '',
    stakeholdersConsulted: [] as string[],
    // Related RAID
    linkedRaidIds: [] as string[],
  });

  useEffect(() => {
    if (editRisk) {
      setForm({
        type: editRisk.type || defaultType,
        title: editRisk.title || '',
        description: editRisk.description || '',
        category: editRisk.category || 'other',
        severity: editRisk.severity || 'medium',
        probability: editRisk.probability ?? 3,
        impact: editRisk.impact ?? 3,
        status: editRisk.status || DEFAULT_STATUS[editRisk.type || defaultType] || 'open',
        triggerCondition: editRisk.triggerCondition || '',
        mitigationPlan: editRisk.mitigationPlan || '',
        responsePlan: editRisk.responsePlan || '',
        ownerId: editRisk.ownerId || '',
        linkedTaskIds: editRisk.linkedTaskIds || [],
        rootCause: editRisk.rootCause || '',
        impactAssessment: editRisk.impactAssessment || '',
        workaround: editRisk.workaround || '',
        dueDate: editRisk.dueDate ? editRisk.dueDate.slice(0, 10) : '',
        actionType: editRisk.actionType || '',
        rationale: editRisk.rationale || '',
        decidedBy: editRisk.decidedBy || '',
        decisionDate: editRisk.decisionDate ? editRisk.decisionDate.slice(0, 10) : '',
        alternativesConsidered: editRisk.alternativesConsidered || '',
        stakeholdersConsulted: editRisk.stakeholdersConsulted || [],
        linkedRaidIds: editRisk.linkedRaidIds || [],
      });
    } else {
      setForm({
        type: defaultType,
        title: '',
        description: '',
        category: 'other',
        severity: 'medium',
        probability: 3,
        impact: 3,
        status: DEFAULT_STATUS[defaultType] || 'open',
        triggerCondition: '',
        mitigationPlan: '',
        responsePlan: '',
        ownerId: '',
        linkedTaskIds: [],
        rootCause: '',
        impactAssessment: '',
        workaround: '',
        dueDate: '',
        actionType: '',
        rationale: '',
        decidedBy: '',
        decisionDate: '',
        alternativesConsidered: '',
        stakeholdersConsulted: [],
        linkedRaidIds: [],
      });
    }
    setError(null);
  }, [editRisk, defaultType, isOpen]);

  const handleTypeChange = (newType: string) => {
    setForm(prev => ({
      ...prev,
      type: newType,
      status: DEFAULT_STATUS[newType] || 'open',
    }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = { ...form };
      // Clean empty optional fields
      if (!payload.ownerId) delete payload.ownerId;
      if (!payload.triggerCondition) delete payload.triggerCondition;
      if (!payload.mitigationPlan) delete payload.mitigationPlan;
      if (!payload.responsePlan) delete payload.responsePlan;
      if (!payload.rootCause) delete payload.rootCause;
      if (!payload.impactAssessment) delete payload.impactAssessment;
      if (!payload.workaround) delete payload.workaround;
      if (payload.linkedTaskIds.length === 0) delete payload.linkedTaskIds;
      if (!payload.dueDate) delete payload.dueDate;
      if (!payload.actionType) delete payload.actionType;
      if (!payload.rationale) delete payload.rationale;
      if (!payload.decidedBy) delete payload.decidedBy;
      if (!payload.decisionDate) delete payload.decisionDate;
      if (!payload.alternativesConsidered) delete payload.alternativesConsidered;
      if (!payload.stakeholdersConsulted || payload.stakeholdersConsulted.length === 0) delete payload.stakeholdersConsulted;
      if (!payload.linkedRaidIds || payload.linkedRaidIds.length === 0) delete payload.linkedRaidIds;

      if (editRisk) {
        await apiService.updateRiskItem(projectId, editRisk.id, payload);
      } else {
        await apiService.createRiskItem(projectId, payload);
      }
      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSuggestAI = async (field: 'mitigation' | 'trigger' | 'response') => {
    if (!form.title.trim()) return;
    const setLoading = field === 'mitigation' ? setSuggestingMitigation : field === 'trigger' ? setSuggestingTrigger : setSuggestingResponse;
    const formKey = field === 'mitigation' ? 'mitigationPlan' : field === 'trigger' ? 'triggerCondition' : 'responsePlan';
    setLoading(true);
    try {
      const result = await apiService.suggestRiskMitigation(projectId, editRisk?.id || 'new', field);
      const suggestions = result?.data || result?.suggestions || [];
      if (suggestions.length > 0) {
        const text = suggestions.map((s: any) => typeof s === 'string' ? s : s.suggestion || s.mitigation || JSON.stringify(s)).join('\n\n');
        setForm(prev => ({ ...prev, [formKey]: prev[formKey] ? prev[formKey] + '\n\n' + text : text }));
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);

  const { data: updatesData, refetch: refetchUpdates } = useQuery({
    queryKey: ['raid-updates', editRisk?.id],
    queryFn: () => apiService.getRaidUpdates(projectId, editRisk.id),
    enabled: !!editRisk?.id && isOpen,
  });
  const updates: any[] = updatesData?.data || [];

  const handleSendUpdate = async () => {
    if (!updateText.trim() || !editRisk?.id) return;
    setSendingUpdate(true);
    try {
      await apiService.addRaidUpdate(projectId, editRisk.id, updateText.trim());
      setUpdateText('');
      await refetchUpdates();
    } catch { /* */ }
    setSendingUpdate(false);
  };

  const handleDeleteUpdate = async (updateId: string) => {
    if (!editRisk?.id) return;
    try {
      await apiService.deleteRaidUpdate(projectId, editRisk.id, updateId);
      await refetchUpdates();
    } catch { /* */ }
  };

  const handleEditUpdate = async (updateId: string) => {
    if (!editingUpdateText.trim() || !editRisk?.id) return;
    try {
      await apiService.editRaidUpdate(projectId, editRisk.id, updateId, editingUpdateText.trim());
      setEditingUpdateId(null);
      setEditingUpdateText('');
      await refetchUpdates();
    } catch { /* */ }
  };

  const memberName = (userId: string) => {
    const m = members.find((m: any) => (m.userId || m.id) === userId);
    return m ? (m.userName || m.user?.name || m.name || m.email) : userId?.slice(0, 8) || '';
  };

  const formatTimestamp = (d: string) =>
    new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  if (!isOpen) return null;

  const statuses = STATUSES[form.type] || STATUSES.risk;
  const riskScore = form.probability * form.impact;
  const isRisk = form.type === 'risk';
  const isIssue = form.type === 'issue';
  const showProbImpact = isRisk;
  const showTrigger = isRisk;
  const showMitigation = isRisk;
  const showResponse = isRisk;
  const showIssueFields = isIssue;
  const showActionFields = form.type === 'action';
  const showDecisionFields = form.type === 'decision';

  const inputClass = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent';
  const labelClass = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';

  const typeLabel = RAID_TYPES.find(t => t.value === form.type)?.label || 'Item';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${editRisk ? 'Edit' : 'Add'} ${typeLabel}`} onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {editRisk ? 'Edit' : 'Add'} {typeLabel}
            {editRisk?.recordId && <span className="ml-2 text-sm font-mono text-gray-400">{editRisk.recordId}</span>}
          </h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-4">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Type toggle — 4 buttons */}
          {!editRisk && (
            <div>
              <label className={labelClass}>Type</label>
              <div className="flex gap-2">
                {RAID_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => handleTypeChange(t.value)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${form.type === t.value ? `${t.color} text-white` : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className={labelClass}>Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
              className={inputClass}
              placeholder={
                form.type === 'issue' ? 'What is the issue?' :
                form.type === 'action' ? 'What action needs to be taken?' :
                form.type === 'decision' ? 'What decision needs to be made?' :
                'What might go wrong?'
              }
            />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className={`${inputClass} h-20 resize-none`}
              placeholder="Detailed description..."
            />
          </div>

          {/* Row: Category + Severity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Category</label>
              <select value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} className={inputClass}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Severity</label>
              <select value={form.severity} onChange={e => setForm(prev => ({ ...prev, severity: e.target.value }))} className={inputClass}>
                {SEVERITIES.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Probability + Impact + Score — only for risk/issue */}
          {showProbImpact && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Probability (1-5)</label>
                <select value={form.probability} onChange={e => setForm(prev => ({ ...prev, probability: Number(e.target.value) }))} className={inputClass}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {['Rare', 'Unlikely', 'Possible', 'Likely', 'Certain'][n - 1]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Impact (1-5)</label>
                <select value={form.impact} onChange={e => setForm(prev => ({ ...prev, impact: Number(e.target.value) }))} className={inputClass}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {['Negligible', 'Minor', 'Moderate', 'Major', 'Catastrophic'][n - 1]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Risk Score</label>
                <div className={`flex items-center justify-center h-[38px] rounded-lg text-sm font-bold ${riskScore >= 16 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : riskScore >= 10 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : riskScore >= 5 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                  {riskScore}
                </div>
              </div>
            </div>
          )}

          {/* Row: Status + Owner */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Status</label>
              <select value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))} className={inputClass}>
                {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Owner</label>
              <select value={form.ownerId} onChange={e => setForm(prev => ({ ...prev, ownerId: e.target.value }))} className={inputClass}>
                <option value="">Unassigned</option>
                {members.map((m: any) => (
                  <option key={m.userId || m.id} value={m.userId || m.id}>
                    {m.userName || m.user?.name || m.name || m.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action-specific fields */}
          {showActionFields && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Due Date</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Action Type</label>
                <select value={form.actionType} onChange={e => setForm(prev => ({ ...prev, actionType: e.target.value }))} className={inputClass}>
                  <option value="">Select...</option>
                  <option value="preventive">Preventive</option>
                  <option value="corrective">Corrective</option>
                  <option value="improvement">Improvement</option>
                </select>
              </div>
            </div>
          )}

          {/* Decision-specific fields */}
          {showDecisionFields && (
            <>
              <div>
                <label className={labelClass}>Rationale</label>
                <textarea
                  value={form.rationale}
                  onChange={e => setForm(prev => ({ ...prev, rationale: e.target.value }))}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Why is this decision being made?"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Decided By</label>
                  <select value={form.decidedBy} onChange={e => setForm(prev => ({ ...prev, decidedBy: e.target.value }))} className={inputClass}>
                    <option value="">Select...</option>
                    {members.map((m: any) => (
                      <option key={m.userId || m.id} value={m.userId || m.id}>
                        {m.userName || m.user?.name || m.name || m.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Decision Date</label>
                  <input
                    type="date"
                    value={form.decisionDate}
                    onChange={e => setForm(prev => ({ ...prev, decisionDate: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Alternatives Considered</label>
                <textarea
                  value={form.alternativesConsidered}
                  onChange={e => setForm(prev => ({ ...prev, alternativesConsidered: e.target.value }))}
                  className={`${inputClass} h-16 resize-none`}
                  placeholder="What alternatives were evaluated?"
                />
              </div>
            </>
          )}

          {/* Trigger Condition — risk/issue */}
          {showTrigger && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelClass + ' mb-0'}>Trigger Condition</label>
                {editRisk?.id && (
                  <button
                    type="button"
                    onClick={() => handleSuggestAI('trigger')}
                    disabled={suggestingTrigger}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 disabled:opacity-50"
                  >
                    {suggestingTrigger ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Suggest with AI
                  </button>
                )}
              </div>
              <textarea
                value={form.triggerCondition}
                onChange={e => setForm(prev => ({ ...prev, triggerCondition: e.target.value }))}
                className={`${inputClass} h-16 resize-none`}
                placeholder="What signals that this risk is materializing?"
              />
            </div>
          )}

          {/* Mitigation Plan — risk/issue */}
          {showMitigation && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelClass + ' mb-0'}>Mitigation Plan</label>
                {editRisk?.id && (
                  <button
                    type="button"
                    onClick={() => handleSuggestAI('mitigation')}
                    disabled={suggestingMitigation}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 disabled:opacity-50"
                  >
                    {suggestingMitigation ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Suggest with AI
                  </button>
                )}
              </div>
              <textarea
                value={form.mitigationPlan}
                onChange={e => setForm(prev => ({ ...prev, mitigationPlan: e.target.value }))}
                className={`${inputClass} h-20 resize-none`}
                placeholder="Preventive actions to reduce likelihood or impact..."
              />
            </div>
          )}

          {/* Response Plan — risk only */}
          {showResponse && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelClass + ' mb-0'}>Response Plan</label>
                {editRisk?.id && (
                  <button
                    type="button"
                    onClick={() => handleSuggestAI('response')}
                    disabled={suggestingResponse}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 disabled:opacity-50"
                  >
                    {suggestingResponse ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Suggest with AI
                  </button>
                )}
              </div>
              <textarea
                value={form.responsePlan}
                onChange={e => setForm(prev => ({ ...prev, responsePlan: e.target.value }))}
                className={`${inputClass} h-20 resize-none`}
                placeholder="Contingency — what to do if the risk occurs..."
              />
            </div>
          )}

          {/* Issue-specific fields */}
          {showIssueFields && (
            <>
              <div>
                <label className={labelClass}>Root Cause</label>
                <textarea
                  value={form.rootCause}
                  onChange={e => setForm(prev => ({ ...prev, rootCause: e.target.value }))}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Why did this issue occur?"
                />
              </div>
              <div>
                <label className={labelClass}>Impact Assessment</label>
                <textarea
                  value={form.impactAssessment}
                  onChange={e => setForm(prev => ({ ...prev, impactAssessment: e.target.value }))}
                  className={`${inputClass} h-16 resize-none`}
                  placeholder="What is the actual impact on the project?"
                />
              </div>
              <div>
                <label className={labelClass}>Workaround</label>
                <textarea
                  value={form.workaround}
                  onChange={e => setForm(prev => ({ ...prev, workaround: e.target.value }))}
                  className={`${inputClass} h-16 resize-none`}
                  placeholder="Temporary fix while working on resolution..."
                />
              </div>
              <div>
                <label className={labelClass}>Resolution Plan</label>
                <textarea
                  value={form.mitigationPlan}
                  onChange={e => setForm(prev => ({ ...prev, mitigationPlan: e.target.value }))}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Permanent fix — how will this issue be resolved?"
                />
              </div>
              <div>
                <label className={labelClass}>Target Resolution Date</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </>
          )}
        </div>

        {/* Updates section — only when editing */}
        {editRisk?.id && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Updates</h3>
            {updates.length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">No updates yet</p>
            ) : (
              <div className="space-y-3 mb-3 max-h-48 overflow-y-auto">
                {updates.map((u: any) => (
                  <div key={u.id} className="flex gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{memberName(u.userId)}</span>
                        <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">
                          {formatTimestamp(u.createdAt)}
                          {u.updatedAt !== u.createdAt && <span className="italic ml-1">(edited)</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setEditingUpdateId(u.id); setEditingUpdateText(u.text); }}
                          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-500"
                          title="Edit update"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUpdate(u.id)}
                          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500"
                          title="Delete update"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      {editingUpdateId === u.id ? (
                        <div className="mt-1 space-y-1.5">
                          <textarea
                            value={editingUpdateText}
                            onChange={e => setEditingUpdateText(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white resize-none h-16"
                          />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleEditUpdate(u.id)} disabled={!editingUpdateText.trim()} className="px-2.5 py-1 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 rounded-lg">Save</button>
                            <button type="button" onClick={() => { setEditingUpdateId(null); setEditingUpdateText(''); }} className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{u.text}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={updateText}
                onChange={e => setUpdateText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendUpdate()}
                placeholder="Provide an update..."
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={handleSendUpdate}
                disabled={!updateText.trim() || sendingUpdate}
                className="p-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : editRisk ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

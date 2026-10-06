import { useState, useEffect, useMemo, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Sparkles, Loader2, MessageSquare, Send, Trash2, Pencil, BookOpen, ChevronDown, ChevronUp, Shield } from 'lucide-react';
import { apiService } from '../../services/api';
import { useModal } from '../../hooks/useModal';
import { MitigationSuggestions } from '../lessons/MitigationSuggestions';
import { RESPONSE_STRATEGIES, isClosedStatus } from '../raids/review/raidReviewHelpers';

interface RiskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  projectId: string;
  editRisk?: any;
  defaultType?: 'risk' | 'issue' | 'action' | 'decision' | 'assumption' | 'dependency';
  members?: any[];
  /** AI suggestions are for the project's PM only (user rule, 2026-09-30) */
  canUseAi?: boolean;
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
  { value: 'financial', label: 'Financial' },
  { value: 'functional', label: 'Functional' },
  { value: 'operational', label: 'Operational' },
  { value: 'legal', label: 'Legal' },
  { value: 'other', label: 'Other' },
];

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const STATUSES: Record<string, readonly string[]> = {
  risk:       ['open', 'monitoring', 'mitigating', 'mitigated', 'closed'],
  issue:      ['open', 'in_progress', 'resolved', 'closed'],
  action:     ['open', 'in_progress', 'completed', 'closed', 'deferred'],
  decision:   ['pending_decision', 'decided', 'deferred'],
  assumption: ['open', 'validated', 'unverified', 'closed'],
  dependency: ['open', 'pending', 'complete', 'at_risk', 'closed'],
};

const RAID_TYPES = [
  { value: 'risk', label: 'Risk', color: 'bg-red-600' },
  { value: 'issue', label: 'Issue', color: 'bg-orange-600' },
  { value: 'action', label: 'Action', color: 'bg-blue-600' },
  { value: 'decision', label: 'Decision', color: 'bg-purple-600' },
  { value: 'assumption', label: 'Assumption', color: 'bg-teal-600' },
  { value: 'dependency', label: 'Dependency', color: 'bg-cyan-600' },
] as const;

const DEFAULT_STATUS: Record<string, string> = {
  risk: 'open',
  issue: 'open',
  action: 'open',
  decision: 'pending_decision',
  assumption: 'open',
  dependency: 'open',
};

export function RiskFormModal({ isOpen, onClose, onSaved, projectId, editRisk, defaultType = 'risk', members = [], canUseAi = false }: RiskFormModalProps) {
  const uid = useId();
  const [saving, setSaving] = useState(false);
  const [suggestingMitigation, setSuggestingMitigation] = useState(false);
  const [suggestingTrigger, setSuggestingTrigger] = useState(false);
  const [suggestingResponse, setSuggestingResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateText, setUpdateText] = useState('');
  const [sendingUpdate, setSendingUpdate] = useState(false);
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [editingUpdateText, setEditingUpdateText] = useState('');
  const [showLessons, setShowLessons] = useState(false);

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
    // DBJ alignment fields
    validationPlan: '',
    dependentEntity: '',
    forum: '',
    sourceMeeting: '',
    ownerName: '',
    responseStrategy: '',
    closureReason: '',
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
        validationPlan: editRisk.validationPlan || '',
        dependentEntity: editRisk.dependentEntity || '',
        forum: editRisk.forum || '',
        sourceMeeting: editRisk.sourceMeeting || '',
        ownerName: editRisk.ownerName || '',
        responseStrategy: editRisk.responseStrategy || '',
        closureReason: editRisk.closureReason || '',
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
        validationPlan: '',
        dependentEntity: '',
        forum: '',
        sourceMeeting: '',
        ownerName: '',
        responseStrategy: '',
        closureReason: '',
      });
    }
    setError(null);
  }, [editRisk, defaultType, isOpen]);

  // Search key for lessons — only when the text is long enough, and only once typing pauses
  // (it changed on every keystroke; 2026-10-04 audit)
  const typedText = useMemo(() => {
    const text = `${form.title} ${form.description}`.trim();
    return text.length >= 10 ? text : '';
  }, [form.title, form.description]);
  const [lessonsSearchKey, setLessonsSearchKey] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setLessonsSearchKey(typedText), 600);
    return () => clearTimeout(t);
  }, [typedText]);

  const { data: lessonsData, isFetching: lessonsFetching } = useQuery({
    queryKey: ['risk-lessons', lessonsSearchKey, form.category],
    queryFn: () => apiService.getRelevantLessons(undefined, form.category !== 'other' ? form.category : undefined),
    enabled: !!lessonsSearchKey && !editRisk,
    staleTime: 60_000,
  });

  const relevantLessons = (lessonsData?.lessons || []).slice(0, 5);

  // Cross-project mitigation suggestions from lessons knowledge base
  // AI suggestions only when the person presses "Suggest mitigations" — they used to be asked
  // on every keystroke (2026-10-04 audit). Asked once for the text at the time of the click.
  const [showMitigationSuggestions, setShowMitigationSuggestions] = useState(false);
  const [mitigationAsk, setMitigationAsk] = useState<{ text: string; category: string } | null>(null);
  const { data: mitigationsData, isFetching: mitigationsFetching } = useQuery({
    queryKey: ['risk-mitigations', mitigationAsk?.text, mitigationAsk?.category],
    queryFn: () => apiService.suggestMitigations(mitigationAsk!.text, mitigationAsk!.category),
    enabled: !!mitigationAsk,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const askForMitigations = () => {
    setMitigationAsk({ text: typedText, category: form.category !== 'other' ? form.category : 'general' });
    setShowMitigationSuggestions(true);
  };
  const mitigationSuggestions = (mitigationsData?.suggestions || []).slice(0, 5);

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
      if (!payload.validationPlan) delete payload.validationPlan;
      if (!payload.dependentEntity) delete payload.dependentEntity;
      if (!payload.forum) delete payload.forum;
      if (!payload.sourceMeeting) delete payload.sourceMeeting;
      if (!payload.ownerName) delete payload.ownerName;
      // Response strategy is for risks; closure reason for finished items. When editing, an
      // empty value is sent as null so clearing the field sticks.
      if (payload.type !== 'risk' || !payload.responseStrategy) {
        if (editRisk && payload.type === 'risk') payload.responseStrategy = null; else delete payload.responseStrategy;
      }
      if (!isClosedStatus(payload.status) || !payload.closureReason.trim()) {
        if (editRisk && isClosedStatus(payload.status)) payload.closureReason = null; else delete payload.closureReason;
      } else {
        payload.closureReason = payload.closureReason.trim();
      }

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
  const isAssumption = form.type === 'assumption';
  const isDependency = form.type === 'dependency';
  const showProbImpact = isRisk;
  const showTrigger = isRisk;
  const showMitigation = isRisk;
  const showResponse = isRisk;
  const showIssueFields = isIssue;
  const showActionFields = form.type === 'action';
  const showDecisionFields = form.type === 'decision';
  const showAssumptionFields = isAssumption;
  const showDependencyFields = isDependency;

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
            {editRisk?.recordId && <span className="ml-2 text-sm font-mono text-gray-500">{editRisk.recordId}</span>}
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
            <label htmlFor="raid-title" className={labelClass}>Title *</label>
            <input
              id="raid-title"
              type="text"
              value={form.title}
              onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
              className={inputClass}
              placeholder={
                form.type === 'issue' ? 'What is the issue?' :
                form.type === 'action' ? 'What action needs to be taken?' :
                form.type === 'decision' ? 'What decision needs to be made?' :
                form.type === 'assumption' ? 'What assumption is being made?' :
                form.type === 'dependency' ? 'What is the dependency?' :
                'What might go wrong?'
              }
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor={`${uid}-description`} className={labelClass}>Description</label>
            <textarea
              id={`${uid}-description`}
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className={`${inputClass} h-20 resize-none`}
              placeholder="Detailed description..."
            />
          </div>

          {/* Similar Lessons — shown when creating a new risk/issue with enough text */}
          {!editRisk && relevantLessons.length > 0 && (
            <div className="border border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50/50 dark:bg-amber-900/10">
              <button
                type="button"
                onClick={() => setShowLessons(!showLessons)}
                className="w-full flex items-center justify-between px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    {relevantLessons.length} similar lesson{relevantLessons.length !== 1 ? 's' : ''} from past projects
                  </span>
                  {lessonsFetching && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
                </div>
                {showLessons ? <ChevronUp className="w-3.5 h-3.5 text-amber-500" /> : <ChevronDown className="w-3.5 h-3.5 text-amber-500" />}
              </button>
              {showLessons && (
                <div className="px-3 pb-3 space-y-2">
                  {relevantLessons.map((lesson: any) => (
                    <div key={lesson.id} className="px-2.5 py-2 rounded-md bg-white dark:bg-gray-800 border border-amber-100 dark:border-amber-900/30">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{lesson.title}</p>
                      {lesson.recommendation && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{lesson.recommendation}</p>
                      )}
                      {lesson.projectName && (
                        <p className="text-xs text-gray-500 mt-0.5">From: {lesson.projectName}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cross-project mitigation suggestions — asked for with a button, never while typing */}
          {typedText && (form.type === 'risk' || form.type === 'issue') && (!mitigationAsk || mitigationAsk.text !== typedText) && (
            <button
              type="button"
              onClick={askForMitigations}
              disabled={mitigationsFetching}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 dark:text-primary-400 hover:underline disabled:opacity-60"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              {mitigationsFetching ? 'Looking…' : 'Suggest mitigations from past lessons'}
            </button>
          )}
          {mitigationAsk && !mitigationsFetching && mitigationSuggestions.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">No suggestions found for this.</p>
          )}
          {mitigationSuggestions.length > 0 && (form.type === 'risk' || form.type === 'issue') && (
            <div className="border border-primary-200 dark:border-primary-800 rounded-lg bg-primary-50/50 dark:bg-primary-900/10">
              <button
                type="button"
                onClick={() => setShowMitigationSuggestions(!showMitigationSuggestions)}
                className="w-full flex items-center justify-between px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
                  <span className="text-xs font-medium text-primary-700 dark:text-primary-400">
                    {mitigationSuggestions.length} mitigation suggestion{mitigationSuggestions.length !== 1 ? 's' : ''} from knowledge base
                  </span>
                </div>
                {showMitigationSuggestions ? <ChevronUp className="w-3.5 h-3.5 text-primary-500" /> : <ChevronDown className="w-3.5 h-3.5 text-primary-500" />}
              </button>
              {showMitigationSuggestions && (
                <div className="px-3 pb-3">
                  <MitigationSuggestions suggestions={mitigationSuggestions} />
                </div>
              )}
            </div>
          )}

          {/* Row: Category + Severity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${uid}-category`} className={labelClass}>Category</label>
              <select id={`${uid}-category`} value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} className={inputClass}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-severity`} className={labelClass}>Severity</label>
              <select id={`${uid}-severity`} value={form.severity} onChange={e => setForm(prev => ({ ...prev, severity: e.target.value }))} className={inputClass}>
                {SEVERITIES.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Probability + Impact + Score — only for risk/issue */}
          {showProbImpact && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor={`${uid}-probability`} className={labelClass}>Probability (1-5)</label>
                <select id={`${uid}-probability`} value={form.probability} onChange={e => setForm(prev => ({ ...prev, probability: Number(e.target.value) }))} className={inputClass}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {['Rare', 'Unlikely', 'Possible', 'Likely', 'Certain'][n - 1]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-impact`} className={labelClass}>Impact (1-5)</label>
                <select id={`${uid}-impact`} value={form.impact} onChange={e => setForm(prev => ({ ...prev, impact: Number(e.target.value) }))} className={inputClass}>
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

          {/* Row: Status + Owner + Raised By */}
          <div className={`grid gap-4 ${editRisk?.createdBy ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div>
              <label htmlFor={`${uid}-status`} className={labelClass}>Status</label>
              <select id={`${uid}-status`} value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))} className={inputClass}>
                {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-owner`} className={labelClass}>Owner</label>
              <select id={`${uid}-owner`} value={form.ownerId} onChange={e => setForm(prev => ({ ...prev, ownerId: e.target.value }))} className={inputClass}>
                <option value="">Unassigned</option>
                {members.map((m: any) => (
                  <option key={m.userId || m.id} value={m.userId || m.id}>
                    {m.userName || m.user?.name || m.name || m.email}
                  </option>
                ))}
              </select>
              {!form.ownerId && (
                <input
                  type="text"
                  aria-label="Owner name"
                  value={form.ownerName}
                  onChange={e => setForm(prev => ({ ...prev, ownerName: e.target.value }))}
                  className={`${inputClass} mt-1`}
                  placeholder="Or type owner name..."
                />
              )}
            </div>
            {editRisk?.createdBy && (
              <div>
                <label className={labelClass}>Raised By</label>
                <p className="text-sm text-gray-700 dark:text-gray-300 py-1.5">
                  {(() => { const m = members.find((m: any) => (m.userId || m.id) === editRisk.createdBy); return m ? (m.userName || m.user?.name || m.name || m.email) : editRisk.createdBy.slice(0, 8); })()}
                </p>
              </div>
            )}
          </div>

          {/* Action-specific fields */}
          {showActionFields && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${uid}-due-date`} className={labelClass}>Due Date</label>
                <input
                  id={`${uid}-due-date`}
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-action-type`} className={labelClass}>Action Type</label>
                <select id={`${uid}-action-type`} value={form.actionType} onChange={e => setForm(prev => ({ ...prev, actionType: e.target.value }))} className={inputClass}>
                  <option value="">Select...</option>
                  <option value="preventive">Preventive</option>
                  <option value="corrective">Corrective</option>
                  <option value="improvement">Improvement</option>
                  <option value="financial">Financial</option>
                  <option value="functional">Functional</option>
                  <option value="technical">Technical</option>
                  <option value="operational">Operational</option>
                  <option value="legal">Legal</option>
                </select>
              </div>
            </div>
          )}

          {/* Decision-specific fields */}
          {showDecisionFields && (
            <>
              <div>
                <label htmlFor={`${uid}-rationale`} className={labelClass}>Rationale</label>
                <textarea
                  id={`${uid}-rationale`}
                  value={form.rationale}
                  onChange={e => setForm(prev => ({ ...prev, rationale: e.target.value }))}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Why is this decision being made?"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-decided-by`} className={labelClass}>Decided By</label>
                  <select id={`${uid}-decided-by`} value={form.decidedBy} onChange={e => setForm(prev => ({ ...prev, decidedBy: e.target.value }))} className={inputClass}>
                    <option value="">Select...</option>
                    {members.map((m: any) => (
                      <option key={m.userId || m.id} value={m.userId || m.id}>
                        {m.userName || m.user?.name || m.name || m.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${uid}-decision-date`} className={labelClass}>Decision Date</label>
                  <input
                    id={`${uid}-decision-date`}
                    type="date"
                    value={form.decisionDate}
                    onChange={e => setForm(prev => ({ ...prev, decisionDate: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${uid}-alternatives-considered`} className={labelClass}>Alternatives Considered</label>
                <textarea
                  id={`${uid}-alternatives-considered`}
                  value={form.alternativesConsidered}
                  onChange={e => setForm(prev => ({ ...prev, alternativesConsidered: e.target.value }))}
                  className={`${inputClass} h-16 resize-none`}
                  placeholder="What alternatives were evaluated?"
                />
              </div>
            </>
          )}

          {/* Decision: Forum + Source Meeting */}
          {showDecisionFields && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${uid}-forum`} className={labelClass}>Forum</label>
                <input
                  id={`${uid}-forum`}
                  type="text"
                  value={form.forum}
                  onChange={e => setForm(prev => ({ ...prev, forum: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Steering Committee"
                />
              </div>
              <div>
                <label htmlFor={`${uid}-source-meeting`} className={labelClass}>Source Meeting</label>
                <input
                  id={`${uid}-source-meeting`}
                  type="text"
                  value={form.sourceMeeting}
                  onChange={e => setForm(prev => ({ ...prev, sourceMeeting: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Weekly PMO Review"
                />
              </div>
            </div>
          )}

          {/* Assumption-specific fields */}
          {showAssumptionFields && (
            <>
              <div>
                <label htmlFor={`${uid}-validation-plan`} className={labelClass}>Validation Plan</label>
                <textarea
                  id={`${uid}-validation-plan`}
                  value={form.validationPlan}
                  onChange={e => setForm(prev => ({ ...prev, validationPlan: e.target.value }))}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="How will this assumption be validated?"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-target-validation-date`} className={labelClass}>Target Validation Date</label>
                  <input
                    id={`${uid}-target-validation-date`}
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-severity-if-invalid`} className={labelClass}>Severity if Invalid</label>
                  <select id={`${uid}-severity-if-invalid`} value={form.severity} onChange={e => setForm(prev => ({ ...prev, severity: e.target.value }))} className={inputClass}>
                    {SEVERITIES.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Dependency-specific fields */}
          {showDependencyFields && (
            <>
              <div>
                <label htmlFor={`${uid}-dependent-entity`} className={labelClass}>Dependent Entity</label>
                <input
                  id={`${uid}-dependent-entity`}
                  type="text"
                  value={form.dependentEntity}
                  onChange={e => setForm(prev => ({ ...prev, dependentEntity: e.target.value }))}
                  className={inputClass}
                  placeholder="External system, team, vendor, or deliverable..."
                />
              </div>
              <div>
                <label htmlFor={`${uid}-required-by-date`} className={labelClass}>Required By Date</label>
                <input
                  id={`${uid}-required-by-date`}
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </>
          )}

          {/* Response strategy — risks */}
          {isRisk && (
            <div>
              <label htmlFor="raid-response-strategy" className={labelClass}>Response Strategy</label>
              <select
                id="raid-response-strategy"
                value={form.responseStrategy}
                onChange={e => setForm(prev => ({ ...prev, responseStrategy: e.target.value }))}
                className={inputClass}
              >
                <option value="">None chosen</option>
                {RESPONSE_STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}

          {/* Closure reason — finished items */}
          {isClosedStatus(form.status) && (
            <div>
              <label htmlFor="raid-closure-reason" className={labelClass}>Closure Reason</label>
              <textarea
                id="raid-closure-reason"
                value={form.closureReason}
                onChange={e => setForm(prev => ({ ...prev, closureReason: e.target.value }))}
                className={`${inputClass} h-16 resize-none`}
                placeholder="Why was this closed? e.g. risk passed, issue fixed in release 2.1"
              />
            </div>
          )}

          {/* Trigger Condition — risk/issue */}
          {showTrigger && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor={`${uid}-trigger`} className={labelClass + ' mb-0'}>Trigger Condition</label>
                {editRisk?.id && canUseAi && (
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
                id={`${uid}-trigger`}
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
                <label htmlFor={`${uid}-mitigation`} className={labelClass + ' mb-0'}>Mitigation Plan</label>
                {editRisk?.id && canUseAi && (
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
                id={`${uid}-mitigation`}
                value={form.mitigationPlan}
                onChange={e => setForm(prev => ({ ...prev, mitigationPlan: e.target.value }))}
                className={`${inputClass} h-20 resize-none`}
                placeholder="Preventive actions to reduce likelihood or impact..."
              />
            </div>
          )}

          {/* Response Plan — risk/issue */}
          {showResponse && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor={`${uid}-response`} className={labelClass + ' mb-0'}>Response Plan</label>
                {editRisk?.id && canUseAi && (
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
                id={`${uid}-response`}
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
                <label htmlFor={`${uid}-root-cause`} className={labelClass}>Root Cause</label>
                <textarea
                  id={`${uid}-root-cause`}
                  value={form.rootCause}
                  onChange={e => setForm(prev => ({ ...prev, rootCause: e.target.value }))}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Why did this issue occur?"
                />
              </div>
              <div>
                <label htmlFor={`${uid}-impact-assessment`} className={labelClass}>Impact Assessment</label>
                <textarea
                  id={`${uid}-impact-assessment`}
                  value={form.impactAssessment}
                  onChange={e => setForm(prev => ({ ...prev, impactAssessment: e.target.value }))}
                  className={`${inputClass} h-16 resize-none`}
                  placeholder="What is the actual impact on the project?"
                />
              </div>
              <div>
                <label htmlFor={`${uid}-workaround`} className={labelClass}>Workaround</label>
                <textarea
                  id={`${uid}-workaround`}
                  value={form.workaround}
                  onChange={e => setForm(prev => ({ ...prev, workaround: e.target.value }))}
                  className={`${inputClass} h-16 resize-none`}
                  placeholder="Temporary fix while working on resolution..."
                />
              </div>
              <div>
                <label htmlFor={`${uid}-resolution-plan`} className={labelClass}>Resolution Plan</label>
                <textarea
                  id={`${uid}-resolution-plan`}
                  value={form.mitigationPlan}
                  onChange={e => setForm(prev => ({ ...prev, mitigationPlan: e.target.value }))}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Permanent fix — how will this issue be resolved?"
                />
              </div>
              <div>
                <label htmlFor={`${uid}-target-resolution-date`} className={labelClass}>Target Resolution Date</label>
                <input
                  id={`${uid}-target-resolution-date`}
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
              <p className="text-xs text-gray-500 mb-3">No updates yet</p>
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
                        <span className="text-xs text-gray-500 ml-auto flex-shrink-0">
                          {formatTimestamp(u.createdAt)}
                          {u.updatedAt !== u.createdAt && <span className="italic ml-1">(edited)</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setEditingUpdateId(u.id); setEditingUpdateText(u.text); }}
                          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-blue-500"
                          title="Edit update"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUpdate(u.id)}
                          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-red-500"
                          title="Delete update"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      {editingUpdateId === u.id ? (
                        <div className="mt-1 space-y-1.5">
                          <textarea
                            aria-label="Edit update"
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
                aria-label="Provide an update"
                onKeyDown={e => e.key === 'Enter' && handleSendUpdate()}
                placeholder="Provide an update..."
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={handleSendUpdate}
                disabled={!updateText.trim() || sendingUpdate}
                aria-label="Send update"
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

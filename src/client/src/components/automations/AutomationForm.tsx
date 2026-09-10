import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, GripVertical, Save } from 'lucide-react';
import { apiService } from '../../services/api';

interface AutomationFormProps {
  projectId: string;
  automationId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface ActionDef {
  id: string;
  type: string;
  params: Record<string, any>;
  runOrder: number;
}

interface ConditionRule {
  field: string;
  operator: string;
  value?: any;
}

interface ConditionGroup {
  logic: 'and' | 'or';
  conditions: (ConditionRule | ConditionGroup)[];
}

interface ParamDef {
  key: string;
  label: string;
  placeholder: string;
  help?: string;
  inputType?: 'text' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  fullWidth?: boolean;
}

const ACTION_TYPES: { value: string; label: string; description: string; params: ParamDef[] }[] = [
  {
    value: 'notify', label: 'Send Notification',
    description: 'Sends an in-app notification to specified users',
    params: [
      { key: 'recipients', label: 'Recipient (User ID)', placeholder: 'e.g. user-id-here or {{entity.assignedTo}}', help: 'User ID or template variable like {{entity.createdBy}}' },
      { key: 'messageTemplate', label: 'Message', placeholder: 'Task "{{entity.name}}" has been created', inputType: 'textarea', help: 'Use {{entity.name}}, {{entity.status}}, {{project.name}} etc.', fullWidth: true },
    ],
  },
  {
    value: 'send_email', label: 'Send Email',
    description: 'Sends an email to the specified address',
    params: [
      { key: 'to', label: 'To (Email Address)', placeholder: 'e.g. pm@company.com or {{entity.createdByEmail}}', help: 'Email address or template variable' },
      { key: 'subject', label: 'Subject', placeholder: 'New task created: {{entity.name}}', help: 'Template variables available' },
      { key: 'body', label: 'Body', placeholder: 'A new task "{{entity.name}}" was created in project {{project.name}}.\n\nStatus: {{entity.status}}\nAssigned to: {{entity.assignedTo}}', inputType: 'textarea', help: 'Use {{entity.*}}, {{project.*}}, {{event.*}} variables', fullWidth: true },
    ],
  },
  {
    value: 'create_task', label: 'Create Task',
    description: 'Creates a new task in the specified schedule',
    params: [
      { key: 'title', label: 'Task Title', placeholder: 'Follow up on: {{entity.name}}', help: 'Template variables available' },
      { key: 'scheduleId', label: 'Schedule ID', placeholder: 'ID of the schedule to create the task in', help: 'Find this in the schedule URL' },
    ],
  },
  {
    value: 'change_status', label: 'Change Status',
    description: 'Changes the status of the triggering entity',
    params: [
      { key: 'newStatus', label: 'New Status', placeholder: 'e.g. in_progress, completed, at_risk', help: 'Must be a valid status for the entity type' },
    ],
  },
  {
    value: 'update_field', label: 'Update Field',
    description: 'Updates a field on the triggering entity',
    params: [
      { key: 'field', label: 'Field Name', placeholder: 'e.g. priority, assignedTo', help: 'The entity field to update' },
      { key: 'value', label: 'New Value', placeholder: 'e.g. high or {{entity.createdBy}}', help: 'Template variables available' },
    ],
  },
  {
    value: 'add_risk', label: 'Add Risk',
    description: 'Creates a new risk/issue in the project RAID log',
    params: [
      { key: 'title', label: 'Risk Title', placeholder: 'Task "{{entity.name}}" may need attention', help: 'Template variables available' },
      { key: 'severity', label: 'Severity', inputType: 'select', placeholder: '', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }] },
      { key: 'riskType', label: 'Type', inputType: 'select', placeholder: '', options: [{ value: 'risk', label: 'Risk' }, { value: 'issue', label: 'Issue' }] },
    ],
  },
  {
    value: 'add_comment', label: 'Add Comment',
    description: 'Adds a comment to the triggering task',
    params: [
      { key: 'messageTemplate', label: 'Comment Text', placeholder: 'Automated: Status changed to {{entity.status}}', inputType: 'textarea', help: 'Template variables available', fullWidth: true },
    ],
  },
  {
    value: 'escalate', label: 'Escalate',
    description: 'Sends a high-priority notification (escalation)',
    params: [
      { key: 'recipients', label: 'Recipient (User ID)', placeholder: 'e.g. manager-user-id or {{entity.createdBy}}', help: 'User ID or template variable' },
      { key: 'messageTemplate', label: 'Escalation Message', placeholder: 'URGENT: {{entity.name}} requires immediate attention', inputType: 'textarea', help: 'Use {{entity.*}}, {{project.*}} variables', fullWidth: true },
    ],
  },
  {
    value: 'call_webhook', label: 'Call Webhook',
    description: 'Sends an HTTP request to an external URL',
    params: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...', help: 'Must be a public HTTPS URL' },
      { key: 'method', label: 'HTTP Method', inputType: 'select', placeholder: '', options: [{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }, { value: 'PUT', label: 'PUT' }] },
    ],
  },
  {
    value: 'log_audit', label: 'Log Audit Entry',
    description: 'Creates an entry in the project audit trail',
    params: [
      { key: 'messageTemplate', label: 'Audit Message', placeholder: 'Automation triggered: {{entity.name}} — {{event.type}}', inputType: 'textarea', help: 'Template variables available', fullWidth: true },
    ],
  },
];

const OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'greater_than', label: '>' },
  { value: 'less_than', label: '<' },
  { value: 'greater_equal', label: '>=' },
  { value: 'less_equal', label: '<=' },
  { value: 'in', label: 'in' },
  { value: 'not_in', label: 'not in' },
  { value: 'before', label: 'before' },
  { value: 'after', label: 'after' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const NO_VALUE_OPS = ['is_empty', 'is_not_empty'];

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function ConditionEditor({ group, fields, onChange, onRemove, depth = 0 }: {
  group: ConditionGroup;
  fields: { name: string; label: string }[];
  onChange: (g: ConditionGroup) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  const addCondition = () => {
    onChange({
      ...group,
      conditions: [...group.conditions, { field: fields[0]?.name || 'status', operator: 'equals', value: '' }],
    });
  };

  const addGroup = () => {
    if (depth >= 2) return;
    onChange({
      ...group,
      conditions: [...group.conditions, { logic: 'and', conditions: [] }],
    });
  };

  const updateCondition = (idx: number, updated: ConditionRule | ConditionGroup) => {
    const next = [...group.conditions];
    next[idx] = updated;
    onChange({ ...group, conditions: next });
  };

  const removeCondition = (idx: number) => {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== idx) });
  };

  return (
    <div className={`space-y-2 ${depth > 0 ? 'ml-4 pl-3 border-l-2 border-gray-200 dark:border-gray-600' : ''}`}>
      <div className="flex items-center gap-2">
        <select
          value={group.logic}
          onChange={(e) => onChange({ ...group, logic: e.target.value as 'and' | 'or' })}
          className="text-xs font-medium border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="and">ALL match (AND)</option>
          <option value="or">ANY match (OR)</option>
        </select>
        {onRemove && (
          <button onClick={onRemove} className="text-red-500 hover:text-red-700 p-0.5" title="Remove group">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {group.conditions.map((cond, idx) => {
        if ('logic' in cond) {
          return (
            <ConditionEditor
              key={idx}
              group={cond}
              fields={fields}
              onChange={(g) => updateCondition(idx, g)}
              onRemove={() => removeCondition(idx)}
              depth={depth + 1}
            />
          );
        }
        return (
          <div key={idx} className="flex items-center gap-2 flex-wrap">
            <select
              value={cond.field}
              onChange={(e) => updateCondition(idx, { ...cond, field: e.target.value })}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {fields.map((f) => (
                <option key={f.name} value={f.name}>{f.label}</option>
              ))}
              <option value="previous.status">Previous Status</option>
            </select>
            <select
              value={cond.operator}
              onChange={(e) => updateCondition(idx, { ...cond, operator: e.target.value })}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
            {!NO_VALUE_OPS.includes(cond.operator) && (
              <input
                type="text"
                value={cond.value ?? ''}
                onChange={(e) => updateCondition(idx, { ...cond, value: e.target.value })}
                placeholder="Value"
                className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white w-32"
              />
            )}
            <button onClick={() => removeCondition(idx)} className="text-red-500 hover:text-red-700 p-0.5">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <button onClick={addCondition} className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800">
          + Add condition
        </button>
        {depth < 2 && (
          <button onClick={addGroup} className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800">
            + Add group
          </button>
        )}
      </div>
    </div>
  );
}

function ActionEditor({ action, index, onUpdate, onRemove }: {
  action: ActionDef;
  index: number;
  onUpdate: (a: ActionDef) => void;
  onRemove: () => void;
}) {
  const typeDef = ACTION_TYPES.find((t) => t.value === action.type);

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 space-y-3 bg-white dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">#{index + 1}</span>
          <select
            value={action.type}
            onChange={(e) => onUpdate({ ...action, type: e.target.value, params: {} })}
            className="text-sm font-medium border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            {ACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <button onClick={onRemove} className="text-red-500 hover:text-red-700 p-1">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {typeDef && (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">{typeDef.description}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {typeDef.params.map((param) => (
              <div key={param.key} className={param.fullWidth ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">{param.label}</label>
                {param.inputType === 'textarea' ? (
                  <textarea
                    value={action.params[param.key] || ''}
                    onChange={(e) => onUpdate({ ...action, params: { ...action.params, [param.key]: e.target.value } })}
                    rows={3}
                    placeholder={param.placeholder}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                ) : param.inputType === 'select' && param.options ? (
                  <select
                    value={action.params[param.key] || param.options[0]?.value || ''}
                    onChange={(e) => onUpdate({ ...action, params: { ...action.params, [param.key]: e.target.value } })}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    {param.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={action.params[param.key] || ''}
                    onChange={(e) => onUpdate({ ...action, params: { ...action.params, [param.key]: e.target.value } })}
                    placeholder={param.placeholder}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                )}
                {param.help && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{param.help}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AutomationForm({ projectId, automationId, onClose, onSaved }: AutomationFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!automationId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerEventType, setTriggerEventType] = useState('task.created');
  const [conditions, setConditions] = useState<ConditionGroup>({ logic: 'and', conditions: [] });
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(50);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Load event types catalog
  const { data: catalog } = useQuery({
    queryKey: ['automation-event-types', projectId],
    queryFn: () => apiService.getAutomationEventTypes(projectId),
    enabled: !!projectId,
  });

  const eventTypes: any[] = catalog?.eventTypes || [];
  const fieldCatalog: Record<string, any[]> = catalog?.fieldCatalog || {};

  // Derive entity type from selected trigger
  const selectedEvent = eventTypes.find((e: any) => e.type === triggerEventType);
  const entityType = selectedEvent?.entityType || 'task';
  const availableFields = (fieldCatalog[entityType] || []).map((f: any) => ({
    name: f.name,
    label: f.label || f.name,
  }));

  // Load existing automation for edit
  const { data: existing } = useQuery({
    queryKey: ['automation', automationId],
    queryFn: () => apiService.getAutomation(projectId, automationId!),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existing?.automation) {
      const a = existing.automation;
      setName(a.name);
      setDescription(a.description || '');
      setTriggerEventType(a.triggerEventType);
      setMaxRunsPerDay(a.maxRunsPerDay ?? 50);
      setCooldownSeconds(a.cooldownSeconds ?? 0);
      if (a.definition?.conditions) setConditions(a.definition.conditions);
      if (a.definition?.actions) setActions(a.definition.actions);
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? apiService.updateAutomation(projectId, automationId!, payload)
        : apiService.createAutomation(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
      onSaved();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || err.message || 'Failed to save');
    },
  });

  const handleSave = () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (actions.length === 0) { setError('At least one action is required'); return; }
    setError(null);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      triggerEventType,
      maxRunsPerDay,
      cooldownSeconds,
      definition: {
        conditions: conditions.conditions.length > 0 ? conditions : undefined,
        actions: actions.map((a, i) => ({ ...a, runOrder: i })),
      },
    };

    saveMutation.mutate(payload);
  };

  const addAction = () => {
    setActions([...actions, {
      id: generateId(),
      type: 'notify',
      params: {},
      runOrder: actions.length,
    }]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {isEdit ? 'Edit Automation' : 'New Automation'}
        </h3>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Basic Info */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Basic Info</h4>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Notify on task completion"
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this automation do?"
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* Trigger */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">When (Trigger)</h4>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Event Type *</label>
          <select
            value={triggerEventType}
            onChange={(e) => setTriggerEventType(e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {eventTypes.map((et: any) => (
              <option key={et.type} value={et.type}>
                {et.type} — {et.description}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Conditions */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">If (Conditions)</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">Optional. If no conditions, the automation runs on every matching event.</p>
        <ConditionEditor
          group={conditions}
          fields={availableFields}
          onChange={setConditions}
        />
      </div>

      {/* Actions */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Then (Actions)</h4>
          <button
            onClick={addAction}
            className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Action
          </button>
        </div>
        {actions.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">No actions yet. Add at least one action.</p>
        )}
        <div className="space-y-3">
          {actions.map((action, idx) => (
            <ActionEditor
              key={action.id}
              action={action}
              index={idx}
              onUpdate={(a) => {
                const next = [...actions];
                next[idx] = a;
                setActions(next);
              }}
              onRemove={() => setActions(actions.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
      </div>

      {/* Template Variables Reference */}
      {actions.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">Available Template Variables</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Entity (trigger):</span>
              <div className="ml-2 space-y-0.5 mt-0.5">
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{entity.name}}'}</code> — name/title</div>
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{entity.status}}'}</code> — current status</div>
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{entity.assignedTo}}'}</code> — assigned user</div>
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{entity.createdBy}}'}</code> — creator</div>
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{entity.priority}}'}</code> — priority level</div>
              </div>
            </div>
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Context:</span>
              <div className="ml-2 space-y-0.5 mt-0.5">
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{project.name}}'}</code> — project name</div>
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{event.type}}'}</code> — event type</div>
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{previous.status}}'}</code> — previous value</div>
                <div><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{'{{event.userId}}'}</code> — who triggered</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Safety Limits */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Safety Limits</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max runs per day</label>
            <input
              type="number"
              value={maxRunsPerDay}
              onChange={(e) => setMaxRunsPerDay(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cooldown (seconds)</label>
            <input
              type="number"
              value={cooldownSeconds}
              onChange={(e) => setCooldownSeconds(Math.max(0, parseInt(e.target.value) || 0))}
              min={0}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">0 = no cooldown</p>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

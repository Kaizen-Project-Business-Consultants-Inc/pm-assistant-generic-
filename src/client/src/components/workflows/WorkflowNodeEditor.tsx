interface NodeConfig {
  [key: string]: any;
}

interface NodeEditorProps {
  nodeType: string;
  config: NodeConfig;
  onChange: (config: NodeConfig) => void;
}

export function WorkflowNodeEditor({ nodeType, config, onChange }: NodeEditorProps) {
  const set = (key: string, value: any) => onChange({ ...config, [key]: value });

  switch (nodeType) {
    case 'trigger':
      return (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Trigger Type</label>
            <select
              value={config.triggerType || 'status_change'}
              onChange={e => onChange({ triggerType: e.target.value })}
              className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5"
            >
              <option value="status_change">Status Change</option>
              <option value="progress_threshold">Progress Threshold</option>
              <option value="date_passed">End Date Passed</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          {config.triggerType === 'status_change' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">From Status</label>
                <select value={config.fromStatus || ''} onChange={e => set('fromStatus', e.target.value || undefined)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
                  <option value="">Any</option>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">To Status</label>
                <select value={config.toStatus || ''} onChange={e => set('toStatus', e.target.value || undefined)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
                  <option value="">Any</option>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          )}
          {config.triggerType === 'progress_threshold' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Threshold %</label>
                <input type="number" min={0} max={100} value={config.progressThreshold ?? 0} onChange={e => set('progressThreshold', Number(e.target.value))} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Direction</label>
                <select value={config.progressDirection || 'above'} onChange={e => set('progressDirection', e.target.value)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
                  <option value="above">At or above</option>
                  <option value="below">At or below</option>
                </select>
              </div>
            </div>
          )}
        </div>
      );

    case 'condition':
      return (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Field</label>
            <select value={config.field || ''} onChange={e => set('field', e.target.value)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
              <option value="">Select field</option>
              <option value="status">Status</option>
              <option value="priority">Priority</option>
              <option value="progressPercentage">Progress %</option>
              <option value="assignedTo">Assigned To</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Operator</label>
            <select value={config.operator || 'equals'} onChange={e => set('operator', e.target.value)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
              <option value="equals">Equals</option>
              <option value="not_equals">Not Equals</option>
              <option value="greater_than">Greater Than</option>
              <option value="less_than">Less Than</option>
              <option value="contains">Contains</option>
              <option value="not_contains">Not Contains</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Value</label>
            <input type="text" value={config.value || ''} onChange={e => set('value', e.target.value)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5" placeholder="Comparison value" />
          </div>
        </div>
      );

    case 'action':
      return (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Action Type</label>
            <select value={config.actionType || 'log_activity'} onChange={e => onChange({ actionType: e.target.value })} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
              <option value="update_field">Update Field</option>
              <option value="log_activity">Log Activity</option>
              <option value="send_notification">Send Notification</option>
            </select>
          </div>
          {config.actionType === 'update_field' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Field</label>
                <select value={config.field || ''} onChange={e => set('field', e.target.value)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
                  <option value="">Select field</option>
                  <option value="status">Status</option>
                  <option value="priority">Priority</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Value</label>
                <input type="text" value={config.value || ''} onChange={e => set('value', e.target.value)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5" placeholder="New value" />
              </div>
            </div>
          )}
          {(config.actionType === 'log_activity' || config.actionType === 'send_notification') && (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Message</label>
              <input type="text" value={config.message || ''} onChange={e => set('message', e.target.value)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5" placeholder="Message text" />
            </div>
          )}
        </div>
      );

    case 'approval':
      return (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Approver Role</label>
            <select value={config.approverRole || ''} onChange={e => set('approverRole', e.target.value || undefined)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5">
              <option value="">Any role</option>
              <option value="admin">Admin</option>
              <option value="project_manager">Project Manager</option>
              <option value="lead">Lead</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Timeout (hours)</label>
            <input type="number" min={0} value={config.timeoutHours ?? ''} onChange={e => set('timeoutHours', e.target.value ? Number(e.target.value) : undefined)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5" placeholder="Optional timeout" />
          </div>
        </div>
      );

    case 'delay':
      return (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Delay (minutes)</label>
          <input type="number" min={0} value={config.delayMinutes ?? ''} onChange={e => set('delayMinutes', e.target.value ? Number(e.target.value) : undefined)} className="w-full text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md px-2 py-1.5" placeholder="Minutes to wait" />
        </div>
      );

    default:
      return <div className="text-xs text-gray-500 dark:text-gray-500">Unknown node type</div>;
  }
}

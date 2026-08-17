import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Send, Ban, RotateCcw, Clock, MessageSquare, ArrowRightLeft, Pencil, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';

interface RAIDDetailPanelProps {
  projectId: string;
  raidId: string;
  onClose: () => void;
  onEdit: (item: any) => void;
  members: any[];
}

const TYPE_COLORS: Record<string, string> = {
  risk: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  issue: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  action: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  decision: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const VALID_STATUSES: Record<string, string[]> = {
  risk:     ['open', 'monitoring', 'mitigating', 'mitigated', 'closed'],
  issue:    ['open', 'in_progress', 'resolved', 'closed'],
  action:   ['open', 'in_progress', 'completed', 'closed', 'deferred'],
  decision: ['pending_decision', 'decided', 'deferred'],
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  monitoring: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
  mitigating: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
  mitigated: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  resolved: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  completed: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  closed: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 line-through',
  reversed: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 line-through',
  in_progress: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
  pending_decision: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
  decided: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  deferred: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
};

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  status_change: 'Status changed',
  field_update: 'Updated',
  comment: 'Comment',
  cancelled: 'Cancelled',
  reversed: 'Reversed',
  linked: 'Linked',
  update_added: 'Update added',
  update_deleted: 'Update deleted',
};

function formatDate(d: string | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function RAIDDetailPanel({ projectId, raidId, onClose, onEdit, members }: RAIDDetailPanelProps) {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState('');
  const [sendingUpdate, setSendingUpdate] = useState(false);
  const [cancelMode, setCancelMode] = useState(false);
  const [reverseMode, setReverseMode] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const updatesRef = useRef<HTMLDivElement>(null);

  const { data: itemData, refetch: refetchItem } = useQuery({
    queryKey: ['raid-item', raidId],
    queryFn: () => apiService.getRiskItem(projectId, raidId),
    enabled: !!raidId,
  });

  const { data: activityData, refetch: refetchActivity } = useQuery({
    queryKey: ['raid-activity', raidId],
    queryFn: () => apiService.getRaidActivity(projectId, raidId),
    enabled: !!raidId,
  });

  const { data: updatesData, refetch: refetchUpdates } = useQuery({
    queryKey: ['raid-updates', raidId],
    queryFn: () => apiService.getRaidUpdates(projectId, raidId),
    enabled: !!raidId,
  });

  const item = itemData?.data;
  const updates: any[] = updatesData?.data || [];
  // Filter out old 'comment' entries from activity — updates section replaces them
  const activity: any[] = (activityData?.data || []).filter((a: any) => a.actionType !== 'comment');

  // Reset cancel/reverse mode when item changes
  useEffect(() => {
    setCancelMode(false);
    setReverseMode(false);
    setReasonText('');
  }, [raidId]);

  const invalidateAll = () => {
    refetchItem();
    refetchActivity();
    refetchUpdates();
    queryClient.invalidateQueries({ queryKey: ['project-risks', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project-risks-stats', projectId] });
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await apiService.updateRiskItem(projectId, raidId, { status: newStatus });
      invalidateAll();
    } catch { /* */ }
  };

  const handleSendUpdate = async () => {
    if (!commentText.trim()) return;
    setSendingUpdate(true);
    try {
      await apiService.addRaidUpdate(projectId, raidId, commentText.trim());
      setCommentText('');
      await Promise.all([refetchUpdates(), refetchActivity()]);
      setTimeout(() => updatesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch { /* */ }
    setSendingUpdate(false);
  };

  const handleDeleteUpdate = async (updateId: string) => {
    try {
      await apiService.deleteRaidUpdate(projectId, raidId, updateId);
      await Promise.all([refetchUpdates(), refetchActivity()]);
    } catch { /* */ }
  };

  const handleCancel = async () => {
    if (!reasonText.trim()) return;
    setSubmitting(true);
    try {
      await apiService.cancelRaidItem(projectId, raidId, reasonText.trim());
      setCancelMode(false);
      setReasonText('');
      invalidateAll();
    } catch { /* */ }
    setSubmitting(false);
  };

  const handleReverse = async () => {
    if (!reasonText.trim()) return;
    setSubmitting(true);
    try {
      await apiService.reverseRaidItem(projectId, raidId, reasonText.trim());
      setReverseMode(false);
      setReasonText('');
      invalidateAll();
    } catch { /* */ }
    setSubmitting(false);
  };

  const memberName = (userId: string | null) => {
    if (!userId) return 'Unassigned';
    const m = members.find((m: any) => (m.userId || m.id) === userId);
    return m ? (m.userName || m.user?.name || m.name || m.email) : userId.slice(0, 8);
  };

  if (!item) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[520px] max-w-full bg-white dark:bg-gray-800 shadow-2xl flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </>
    );
  }

  const isTerminal = ['cancelled', 'reversed'].includes(item.status);
  const availableStatuses = VALID_STATUSES[item.type] || [];
  const labelClass = 'text-xs font-medium text-gray-500 dark:text-gray-400';
  const valueClass = 'text-sm text-gray-900 dark:text-white';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[520px] max-w-full bg-white dark:bg-gray-800 shadow-2xl flex flex-col transform transition-transform duration-300" role="dialog" aria-modal="true" aria-label="RAID item details">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          {item.recordId && (
            <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              {item.recordId}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${TYPE_COLORS[item.type] || ''}`}>
            {item.type}
          </span>
          <h2 className="flex-1 text-base font-semibold text-gray-900 dark:text-white truncate">{item.title}</h2>
          <button onClick={() => onEdit(item)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" title="Edit" aria-label="Edit">
            <Pencil className="w-4 h-4 text-gray-500" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Status bar */}
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[item.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
              {item.status.replace('_', ' ')}
            </span>
            {!isTerminal && (
              <select
                value={item.status}
                onChange={e => handleStatusChange(e.target.value)}
                className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-300"
              >
                {availableStatuses.map((s: string) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            )}
            {item.severity && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                item.severity === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                item.severity === 'high' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                item.severity === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              }`}>
                {item.severity}
              </span>
            )}
          </div>

          {/* Cancel reason */}
          {item.cancelReason && (
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
              <p className={labelClass}>{item.status === 'reversed' ? 'Reversal Reason' : 'Cancellation Reason'}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{item.cancelReason}</p>
            </div>
          )}

          {/* Detail fields */}
          <div className="space-y-3">
            {item.description && (
              <div>
                <p className={labelClass}>Description</p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.description}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className={labelClass}>Category</p>
                <p className={`${valueClass} capitalize`}>{item.category}</p>
              </div>
              <div>
                <p className={labelClass}>Owner</p>
                <p className={valueClass}>{memberName(item.ownerId)}</p>
              </div>
              {item.type === 'risk' && (
                <>
                  <div>
                    <p className={labelClass}>Probability x Impact</p>
                    <p className={valueClass}>{item.probability} x {item.impact} = <strong>{item.riskScore}</strong></p>
                  </div>
                  <div>
                    <p className={labelClass}>Source</p>
                    <p className={`${valueClass} capitalize`}>{item.source?.replace('_', ' ')}</p>
                  </div>
                </>
              )}
              {item.type === 'issue' && (
                <div>
                  <p className={labelClass}>Source</p>
                  <p className={`${valueClass} capitalize`}>{item.source?.replace('_', ' ')}</p>
                </div>
              )}
            </div>

            {/* Risk-specific fields */}
            {item.type === 'risk' && item.triggerCondition && (
              <div>
                <p className={labelClass}>
                  Trigger Condition {item.triggered && <span className="text-amber-500 ml-1">Triggered {formatDate(item.triggeredAt)}</span>}
                </p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.triggerCondition}</p>
              </div>
            )}
            {item.type === 'risk' && item.mitigationPlan && (
              <div>
                <p className={labelClass}>Mitigation Plan</p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.mitigationPlan}</p>
              </div>
            )}
            {item.type === 'risk' && item.responsePlan && (
              <div>
                <p className={labelClass}>Response Plan</p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.responsePlan}</p>
              </div>
            )}

            {/* Issue-specific fields */}
            {item.type === 'issue' && item.rootCause && (
              <div>
                <p className={labelClass}>Root Cause</p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.rootCause}</p>
              </div>
            )}
            {item.type === 'issue' && item.impactAssessment && (
              <div>
                <p className={labelClass}>Impact Assessment</p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.impactAssessment}</p>
              </div>
            )}
            {item.type === 'issue' && item.workaround && (
              <div>
                <p className={labelClass}>Workaround</p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.workaround}</p>
              </div>
            )}
            {item.type === 'issue' && item.mitigationPlan && (
              <div>
                <p className={labelClass}>Resolution Plan</p>
                <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.mitigationPlan}</p>
              </div>
            )}
            {item.type === 'issue' && item.dueDate && (
              <div>
                <p className={labelClass}>Target Resolution Date</p>
                <p className={valueClass}>{formatDate(item.dueDate)}</p>
              </div>
            )}

            {/* Action-specific fields */}
            {item.type === 'action' && (
              <div className="grid grid-cols-2 gap-3">
                {item.dueDate && (
                  <div>
                    <p className={labelClass}>Due Date</p>
                    <p className={valueClass}>{formatDate(item.dueDate)}</p>
                  </div>
                )}
                {item.actionType && (
                  <div>
                    <p className={labelClass}>Action Type</p>
                    <p className={`${valueClass} capitalize`}>{item.actionType}</p>
                  </div>
                )}
              </div>
            )}

            {/* Decision-specific fields */}
            {item.type === 'decision' && (
              <>
                {item.rationale && (
                  <div>
                    <p className={labelClass}>Rationale</p>
                    <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.rationale}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {item.decidedBy && (
                    <div>
                      <p className={labelClass}>Decided By</p>
                      <p className={valueClass}>{memberName(item.decidedBy)}</p>
                    </div>
                  )}
                  {item.decisionDate && (
                    <div>
                      <p className={labelClass}>Decision Date</p>
                      <p className={valueClass}>{formatDate(item.decisionDate)}</p>
                    </div>
                  )}
                </div>
                {item.alternativesConsidered && (
                  <div>
                    <p className={labelClass}>Alternatives Considered</p>
                    <p className={`${valueClass} whitespace-pre-wrap mt-1`}>{item.alternativesConsidered}</p>
                  </div>
                )}
                {item.stakeholdersConsulted?.length > 0 && (
                  <div>
                    <p className={labelClass}>Stakeholders Consulted</p>
                    <p className={valueClass}>{item.stakeholdersConsulted.join(', ')}</p>
                  </div>
                )}
              </>
            )}

            {/* Related RAID items */}
            {item.linkedRaidIds?.length > 0 && (
              <div>
                <p className={labelClass}>Related RAID Items</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {item.linkedRaidIds.map((rid: string) => (
                    <span key={rid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      <ArrowRightLeft className="w-3 h-3" /> {rid}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              <div>
                <p className={labelClass}>Created</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">{formatDate(item.createdAt)}</p>
              </div>
              {item.resolvedAt && (
                <div>
                  <p className={labelClass}>Resolved</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">{formatDate(item.resolvedAt)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Cancel / Reverse buttons */}
          {!isTerminal && (
            <div className="flex gap-2">
              {!cancelMode && !reverseMode && (
                <>
                  <button
                    onClick={() => setCancelMode(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                  >
                    <Ban className="w-3.5 h-3.5" /> Cancel
                  </button>
                  {item.type === 'decision' && (
                    <button
                      onClick={() => setReverseMode(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reverse
                    </button>
                  )}
                </>
              )}
              {(cancelMode || reverseMode) && (
                <div className="w-full space-y-2">
                  <textarea
                    value={reasonText}
                    onChange={e => setReasonText(e.target.value)}
                    placeholder={`Reason for ${cancelMode ? 'cancellation' : 'reversal'}...`}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white resize-none h-16"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={cancelMode ? handleCancel : handleReverse}
                      disabled={!reasonText.trim() || submitting}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 rounded-lg"
                    >
                      {submitting ? 'Submitting…' : cancelMode ? 'Confirm Cancel' : 'Confirm Reverse'}
                    </button>
                    <button
                      onClick={() => { setCancelMode(false); setReverseMode(false); setReasonText(''); }}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Updates section (user narratives) */}
          <div>
            <h3 ref={updatesRef} className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Updates</h3>
            {updates.length === 0 ? (
              <p className="text-xs text-gray-400">No updates yet</p>
            ) : (
              <div className="space-y-3">
                {updates.map((u: any) => (
                  <div key={u.id} className="flex gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {memberName(u.userId)}
                        </span>
                        <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">
                          {formatTimestamp(u.createdAt)}
                        </span>
                        <button
                          onClick={() => handleDeleteUpdate(u.id)}
                          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500"
                          title="Delete update"
                          aria-label="Delete update"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{u.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity timeline (audit trail only) */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Activity</h3>
            {activity.length === 0 ? (
              <p className="text-xs text-gray-400">No activity yet</p>
            ) : (
              <div className="space-y-3">
                {activity.map((a: any) => (
                  <div key={a.id} className="flex gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {ACTIVITY_LABELS[a.actionType] || a.actionType}
                        </span>
                        {a.fieldName && (
                          <span className="text-xs text-gray-400 capitalize">{a.fieldName}</span>
                        )}
                        <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">
                          {formatTimestamp(a.createdAt)}
                        </span>
                      </div>
                      {a.actionType === 'status_change' && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="line-through">{a.oldValue}</span> → <span className="font-medium">{a.newValue}</span>
                        </p>
                      )}
                      {a.actionType === 'field_update' && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {a.oldValue ? <><span className="line-through">{a.oldValue}</span> → </> : ''}
                          <span className="font-medium">{a.newValue}</span>
                        </p>
                      )}
                      {(a.actionType === 'cancelled' || a.actionType === 'reversed') && a.comment && (
                        <p className="text-xs text-gray-500 mt-0.5 italic">{a.comment}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Update input at bottom */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendUpdate()}
              placeholder="Provide an update..."
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
            <button
              onClick={handleSendUpdate}
              disabled={!commentText.trim() || sendingUpdate}
              className="p-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white transition-colors"
              aria-label="Send update"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

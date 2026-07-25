import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  ChevronRight,
  X,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Shield,
  ShieldCheck,
  ShieldOff,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Clock,
  Zap,
  Database,
  History,
  Cpu,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';
import { timeAgo } from '../utils/timeAgo';
import { MetaPill } from '../components/ui/MetaPill';
import { RiskBadge as RiskBadgePrimitive } from '../components/ui/RiskBadge';
import { ConfidenceGauge as ConfidenceGaugePrimitive, ConfidenceBar } from '../components/ui/ConfidenceGauge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Proposal {
  id: string;
  project_id: string;
  schedule_id?: string;
  agent_id: string;
  agent_version: string;
  status: string;
  title: string;
  reasoning: string;
  summary: string;
  confidence_score: number;
  confidence_factors: Record<string, unknown> | null;
  risk_level: string;
  expires_at?: string;
  created_at: string;
  reviewed_at?: string;
  executed_at?: string;
}

interface ProposalAction {
  id: string;
  execution_order: number;
  action_type: string;
  target_entity_type: string;
  target_entity_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown>;
  reasoning?: string;
  status: string;
}

interface AutonomyConfig {
  id: string;
  agentId: string;
  projectId: string | null;
  autonomyTier: number;
  minConfidenceThreshold: number;
  maxRiskLevel: string;
  enabledBy: string;
  enabledAt: string;
  disabledAt: string | null;
}

interface EligibilityStats {
  agentId: string;
  projectId: string | null;
  totalProposals: number;
  acceptedProposals: number;
  rejectedProposals: number;
  executedProposals: number;
  rolledBackProposals: number;
  acceptanceRate: number;
  effectivenessRate: number;
  daysSinceFirstProposal: number;
  isEligible: boolean;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'executed', label: 'Executed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'expired', label: 'Expired' },
] as const;


const KNOWN_AGENTS = [
  'schedule-recovery-v1', 'scope-creep-detection-v1', 'budget-burn-rate-v1',
  'monte-carlo-risk-v1', 'resource-optimization-v1', 'budget-intelligence-v1',
  'meeting-intelligence-v1', 'cross-project-intelligence-v1', 'risk-escalation-v1',
  'stakeholder-communication-v1', 'project-hygiene-v1', 'dependency-risk-v1',
  'lessons-learned-v1', 'predictive-alerting-v1',
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------


function formatAgentName(agentId: string): string {
  return agentId.replace(/-v\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Format a single value for human display */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'string') {
    // ISO date
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
      return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return val;
  }
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return JSON.stringify(val);
}

/** Format action type for display */
function formatActionType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Confidence Gauge
// ---------------------------------------------------------------------------

function ConfidenceGauge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  return <ConfidenceGaugePrimitive score={score} size={size} />;
}

// ---------------------------------------------------------------------------
// Risk Badge — delegates to shared primitive
// ---------------------------------------------------------------------------

function RiskBadge({ level, size = 'md' }: { level: string; size?: 'sm' | 'md' }) {
  return <RiskBadgePrimitive level={level} size={size} />;
}

// ---------------------------------------------------------------------------
// Status Pill — delegates to MetaPill
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<string, 'warning' | 'info' | 'danger' | 'success' | 'muted' | 'default'> = {
  pending: 'warning',
  approved: 'info',
  rejected: 'danger',
  expired: 'muted',
  executing: 'info',
  executed: 'success',
  rolled_back: 'warning',
  failed: 'danger',
};

function StatusPill({ status }: { status: string }) {
  return (
    <MetaPill variant={STATUS_VARIANT[status] || 'default'}>
      {status.replace(/_/g, ' ')}
    </MetaPill>
  );
}

// ---------------------------------------------------------------------------
// Diff Renderer (before → after)
// ---------------------------------------------------------------------------

function DiffView({ oldVal, newVal }: { oldVal: Record<string, unknown> | null; newVal: Record<string, unknown> }) {
  const allKeys = new Set([...Object.keys(oldVal || {}), ...Object.keys(newVal)]);

  return (
    <div className="space-y-1">
      {[...allKeys].map(key => {
        const ov = oldVal?.[key];
        const nv = newVal[key];
        const changed = JSON.stringify(ov) !== JSON.stringify(nv);
        if (!changed && ov === undefined) return null; // new-only key with no old
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400 font-medium min-w-[80px]">{key.replace(/_/g, ' ')}:</span>
            {ov !== undefined && (
              <span className="text-red-600 dark:text-red-400 line-through">{formatValue(ov)}</span>
            )}
            {ov !== undefined && nv !== undefined && (
              <ArrowRight className="w-3 h-3 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            )}
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">{formatValue(nv)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health Banner (serious, governed look)
// ---------------------------------------------------------------------------

function HealthBanner() {
  const { data } = useQuery({
    queryKey: ['agent-health'],
    queryFn: () => apiService.getAgentHealth(),
    refetchInterval: 60000,
  });

  if (!data) return null;

  const isHealthy = data.status === 'healthy';
  const costToday = data.costs?.today;

  return (
    <div className={`flex items-center gap-4 px-4 py-2.5 rounded-lg text-sm border ${
      isHealthy ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
        <span className="font-medium text-gray-700 dark:text-gray-200">{data.status}</span>
      </div>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <span className="text-gray-500 dark:text-gray-400 text-xs">
        Claude: <span className={data.claudeApiStatus === 'available' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{data.claudeApiStatus}</span>
      </span>
      {data.recommendedScanScope && data.recommendedScanScope !== 'full' && (
        <>
          <span className="text-gray-300">|</span>
          <span className="text-amber-600 dark:text-amber-400 text-xs">Scope: {data.recommendedScanScope}</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        {typeof data.pendingProposals === 'number' && data.pendingProposals > 0 && (
          <span className="font-medium text-amber-700 dark:text-amber-400">{data.pendingProposals} pending review</span>
        )}
        {costToday && (
          <span>{costToday.invocations} calls / ${(costToday.estimatedCostUsd ?? costToday.estimatedUsd ?? 0).toFixed(4)}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triage Section — "Needs Your Decision"
// ---------------------------------------------------------------------------

function TriageSection({ proposals, onSelect }: { proposals: Proposal[]; onSelect: (id: string) => void }) {
  const pending = proposals.filter(p => p.status === 'pending');
  if (pending.length === 0) return null;

  // Sort: high risk first, then by confidence desc
  const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...pending].sort((a, b) => {
    const rd = (riskOrder[a.risk_level] ?? 9) - (riskOrder[b.risk_level] ?? 9);
    if (rd !== 0) return rd;
    return b.confidence_score - a.confidence_score;
  });

  return (
    <div className="border-2 border-amber-200 dark:border-amber-800 rounded-xl bg-amber-50/50 dark:bg-amber-900/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300">Needs Your Decision</h3>
        <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 font-medium">{sorted.length} pending</span>
      </div>
      <div className="space-y-2">
        {sorted.slice(0, 5).map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="w-full flex items-center gap-3 bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-sm transition-all text-left"
          >
            <ConfidenceGauge score={p.confidence_score} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.title}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {formatAgentName(p.agent_id)} &middot; {timeAgo(p.created_at)}
              </div>
            </div>
            <RiskBadge level={p.risk_level} size="sm" />
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </button>
        ))}
        {sorted.length > 5 && (
          <p className="text-xs text-amber-600 text-center pt-1">
            + {sorted.length - 5} more pending proposals
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposal Detail Modal (redesigned)
// ---------------------------------------------------------------------------

function ProposalDetailModal({ proposalId, onClose }: { proposalId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [comment, setComment] = useState('');
  const [feedbackOutcome, setFeedbackOutcome] = useState('');
  const [feedbackComment, setFeedbackComment] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['agent-proposal', proposalId],
    queryFn: () => apiService.getAgentProposal(proposalId),
  });

  const { data: actionsData } = useQuery({
    queryKey: ['agent-proposal-actions', proposalId],
    queryFn: () => apiService.getAgentProposalActions(proposalId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-proposals'] });
    queryClient.invalidateQueries({ queryKey: ['agent-proposal', proposalId] });
    queryClient.invalidateQueries({ queryKey: ['agent-health'] });
  };

  const approveMutation = useMutation({
    mutationFn: () => apiService.approveAgentProposal(proposalId, comment || undefined),
    onSuccess: () => { invalidate(); setComment(''); },
  });
  const rejectMutation = useMutation({
    mutationFn: () => apiService.rejectAgentProposal(proposalId, comment || undefined),
    onSuccess: () => { invalidate(); setComment(''); },
  });
  const executeMutation = useMutation({
    mutationFn: () => apiService.executeAgentProposal(proposalId),
    onSuccess: invalidate,
  });
  const rollbackMutation = useMutation({
    mutationFn: () => apiService.rollbackAgentProposal(proposalId),
    onSuccess: invalidate,
  });
  const feedbackMutation = useMutation({
    mutationFn: () => apiService.submitAgentProposalFeedback(proposalId, feedbackOutcome, feedbackComment || undefined),
    onSuccess: () => { invalidate(); setFeedbackOutcome(''); setFeedbackComment(''); },
  });

  const proposal: Proposal | undefined = data?.proposal;
  const actions: ProposalAction[] = actionsData?.actions || [];
  const isAdmin = user?.role === 'admin';
  const canReview = proposal?.status === 'pending';
  const canExecute = proposal?.status === 'approved' && isAdmin;
  const canRollback = proposal?.status === 'executed' && isAdmin;
  const canFeedback = proposal?.status === 'executed';
  const anyMutating = approveMutation.isPending || rejectMutation.isPending || executeMutation.isPending || rollbackMutation.isPending || feedbackMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — Risk + Confidence dominate */}
        <div className="sticky top-0 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-700 px-6 py-4 rounded-t-xl z-10">
          {isLoading ? (
            <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ) : proposal ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-snug">{proposal.title}</h2>
                <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded flex-shrink-0" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {/* Decision bar: Risk + Confidence + Status — three distinct visual treatments */}
              <div className="flex items-center gap-3 mt-3">
                <RiskBadge level={proposal.risk_level} />
                <div className="flex items-center gap-2">
                  <ConfidenceGauge score={proposal.confidence_score} size="sm" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">confidence</span>
                </div>
                <div className="ml-auto">
                  <StatusPill status={proposal.status} />
                </div>
              </div>
            </>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : proposal ? (
          <>
          <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1 min-h-0">
            {/* Meta row */}
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <Bot className="w-3.5 h-3.5 text-primary-500" />
                <span className="font-medium text-gray-700 dark:text-gray-200">{formatAgentName(proposal.agent_id)}</span>
                <span className="text-gray-400 dark:text-gray-500">v{proposal.agent_version}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {new Date(proposal.created_at).toLocaleString()}
              </span>
              {proposal.expires_at && (
                <span className="text-amber-600">
                  Expires {new Date(proposal.expires_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Summary — first-class, prominent */}
            <div>
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{proposal.summary}</p>
            </div>

            {/* Confidence Breakdown — visual bars */}
            {proposal.confidence_factors && Object.keys(proposal.confidence_factors).length > 0 && (
              <div className="bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">Confidence Breakdown</h3>
                <div className="space-y-2.5">
                  {Object.entries(proposal.confidence_factors).map(([key, val]) => {
                    const score = Number(val) || 0;
                    const label = key === 'dataQuality' ? 'Data Quality' : key === 'historicalAccuracy' ? 'Historical Accuracy' : key === 'modelCertainty' ? 'Model Certainty' : key.replace(/_/g, ' ');
                    const Icon = key === 'dataQuality' ? Database : key === 'historicalAccuracy' ? History : Cpu;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <Icon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                        <ConfidenceBar score={score} label={label} className="flex-1" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Agent Reasoning — first-class, structured */}
            <div>
              <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Agent Reasoning</h3>
              <div className="bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-lg p-5 max-w-prose">
                {proposal.reasoning.split(/\n/).map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return <div key={i} className="h-3" />;
                  // Bullet lines
                  if (/^[-*]\s/.test(trimmed)) {
                    return (
                      <div key={i} className="flex gap-2 text-body text-neutral-700 dark:text-neutral-300 leading-relaxed ml-1 mt-1">
                        <span className="text-neutral-400 flex-shrink-0 mt-1.5 w-1 h-1 rounded-full bg-neutral-400" />
                        <span>{trimmed.replace(/^[-*]\s+/, '')}</span>
                      </div>
                    );
                  }
                  // Heading-like lines (start with #)
                  if (/^#{1,3}\s/.test(trimmed)) {
                    return (
                      <p key={i} className={`font-semibold text-neutral-900 dark:text-neutral-100 ${i > 0 ? 'mt-3' : ''}`}>
                        {trimmed.replace(/^#{1,3}\s+/, '')}
                      </p>
                    );
                  }
                  // Regular paragraph
                  return (
                    <p key={i} className={`text-body text-neutral-700 dark:text-neutral-300 leading-relaxed ${i > 0 ? 'mt-2' : ''}`}>
                      {trimmed}
                    </p>
                  );
                })}
              </div>
            </div>

            {/* Proposed Actions — with before→after diffs */}
            {actions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Proposed Actions ({actions.length})
                </h3>
                <div className="space-y-2">
                  {actions.map(action => (
                    <div key={action.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center justify-center w-5 h-5 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 text-xs font-bold">
                            {action.execution_order}
                          </span>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {formatActionType(action.action_type)}
                          </span>
                        </div>
                        <StatusPill status={action.status} />
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        {action.target_entity_type} &middot; {action.target_entity_id.slice(0, 8)}...
                      </div>
                      {action.reasoning && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 italic">{action.reasoning}</p>
                      )}
                      {/* Before→After diff */}
                      {(action.old_value || action.new_value) && (
                        <div className="bg-gray-50 dark:bg-gray-900 rounded p-2.5">
                          <DiffView oldVal={action.old_value} newVal={action.new_value} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error messages */}
            {(approveMutation.error || rejectMutation.error || executeMutation.error || rollbackMutation.error || feedbackMutation.error) && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                {String((approveMutation.error || rejectMutation.error || executeMutation.error || rollbackMutation.error || feedbackMutation.error) as Error)}
              </div>
            )}

            {/* Execute (approved, admin) */}
            {canExecute && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => executeMutation.mutate()}
                    disabled={anyMutating}
                    className="flex items-center gap-1.5 px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-semibold disabled:opacity-50"
                  >
                    <Play className="w-4 h-4" />
                    Execute
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Apply all proposed actions to the project</span>
                </div>
              </div>
            )}

            {/* Rollback (executed, admin) */}
            {canRollback && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <button
                  onClick={() => rollbackMutation.mutate()}
                  disabled={anyMutating}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-gray-800 text-orange-600 border-2 border-orange-300 dark:border-orange-700 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors text-sm font-semibold disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" />
                  Rollback
                </button>
              </div>
            )}

            {/* Feedback (executed) */}
            {canFeedback && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Outcome Feedback</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {['effective', 'partially_effective', 'ineffective', 'made_worse'].map(o => (
                    <button
                      key={o}
                      onClick={() => setFeedbackOutcome(o)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        feedbackOutcome === o
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {o === 'effective' && <ThumbsUp className="w-3 h-3 inline mr-1" />}
                      {o === 'made_worse' && <ThumbsDown className="w-3 h-3 inline mr-1" />}
                      {o.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
                {feedbackOutcome && (
                  <>
                    <textarea
                      value={feedbackComment}
                      onChange={e => setFeedbackComment(e.target.value)}
                      placeholder="Optional comment..."
                      rows={2}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-800 dark:text-neutral-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 mb-2"
                    />
                    <button
                      onClick={() => feedbackMutation.mutate()}
                      disabled={anyMutating}
                      className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Submit
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Sticky decision bar for pending proposals */}
          {canReview && (
            <div className="sticky bottom-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-700 px-6 py-4 rounded-b-xl">
              <div className="flex items-center gap-3">
                <input
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Optional comment..."
                  className="flex-1 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-neutral-800 dark:text-neutral-100"
                />
                <button
                  onClick={() => approveMutation.mutate()}
                  disabled={anyMutating}
                  className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-semibold disabled:opacity-50 flex-shrink-0"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => rejectMutation.mutate()}
                  disabled={anyMutating}
                  className="flex items-center gap-1.5 px-5 py-2 bg-white dark:bg-neutral-800 text-red-600 border-2 border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors text-sm font-semibold disabled:opacity-50 flex-shrink-0"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            </div>
          )}
          </>
        ) : (
          <div className="text-center py-16 text-gray-500">Proposal not found.</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Autonomy Tab (kept — already strong)
// ---------------------------------------------------------------------------

function AgentEligibilityCard({ agentId, config, isAdmin }: {
  agentId: string;
  config?: AutonomyConfig;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [threshold, setThreshold] = useState(config?.minConfidenceThreshold ?? 80);
  const [maxRisk, setMaxRisk] = useState(config?.maxRiskLevel ?? 'low');

  const { data, isLoading } = useQuery({
    queryKey: ['agent-eligibility', agentId],
    queryFn: () => apiService.getAutonomyEligibility(agentId),
    enabled: expanded,
  });

  const eligibility: EligibilityStats | undefined = data?.eligibility;

  const promoteMutation = useMutation({
    mutationFn: () => apiService.promoteAgent(agentId, { minConfidenceThreshold: threshold, maxRiskLevel: maxRisk }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomy-configs'] });
      queryClient.invalidateQueries({ queryKey: ['agent-eligibility', agentId] });
    },
  });

  const demoteMutation = useMutation({
    mutationFn: () => apiService.demoteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomy-configs'] });
      queryClient.invalidateQueries({ queryKey: ['agent-eligibility', agentId] });
    },
  });

  const isTier3 = !!config;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isTier3 ? <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> : <Shield className="w-5 h-5 text-gray-400 dark:text-gray-500" />}
          <div className="text-left">
            <div className="font-medium text-gray-900 dark:text-white text-sm">{formatAgentName(agentId)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{agentId}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isTier3 ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <ShieldCheck className="w-3 h-3" /> Tier 3
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              Tier 2
            </span>
          )}
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 bg-gray-50/50 dark:bg-gray-800/50">
          {isTier3 && config && (
            <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium text-emerald-800 dark:text-emerald-300">Active Tier 3</span>
                  <div className="text-emerald-700 dark:text-emerald-400 text-xs mt-1">
                    Min confidence: {config.minConfidenceThreshold}% | Max risk: {config.maxRiskLevel} | Since: {new Date(config.enabledAt).toLocaleDateString()}
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => demoteMutation.mutate()}
                    disabled={demoteMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs font-medium disabled:opacity-50"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                    Demote
                  </button>
                )}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : eligibility ? (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Proposal History</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 text-center">
                    <div className="text-lg font-bold text-gray-900 dark:text-white">{eligibility.totalProposals}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 text-center">
                    <div className={`text-lg font-bold ${eligibility.acceptanceRate >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {eligibility.acceptanceRate}%
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Accepted</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 text-center">
                    <div className={`text-lg font-bold ${eligibility.effectivenessRate >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {eligibility.effectivenessRate}%
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Effective</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 text-center">
                    <div className={`text-lg font-bold ${eligibility.rolledBackProposals === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {eligibility.rolledBackProposals}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Rollbacks</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Promotion Criteria</h4>
                <div className="space-y-1.5">
                  {eligibility.reasons.map((reason, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {eligibility.isEligible ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      ) : reason.includes('Need') ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      )}
                      <span className="text-gray-700 dark:text-gray-300">{reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              {isAdmin && !isTier3 && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Promote to Tier 3</h4>
                  <div className="flex items-end gap-4">
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Min Confidence</label>
                      <select
                        value={threshold}
                        onChange={e => setThreshold(Number(e.target.value))}
                        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
                      >
                        {[70, 75, 80, 85, 90, 95].map(v => (
                          <option key={v} value={v}>{v}%</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Max Risk Level</label>
                      <select
                        value={maxRisk}
                        onChange={e => setMaxRisk(e.target.value)}
                        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <button
                      onClick={() => promoteMutation.mutate()}
                      disabled={promoteMutation.isPending}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      <TrendingUp className="w-4 h-4" />
                      Promote
                    </button>
                  </div>
                  {!eligibility.isEligible && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Eligibility criteria not met. Promoting is an admin override.
                    </p>
                  )}
                  {promoteMutation.error && (
                    <p className="text-xs text-red-600 mt-2">{String(promoteMutation.error)}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-4">Failed to load eligibility data.</div>
          )}
        </div>
      )}
    </div>
  );
}

function AutonomyTab() {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';

  const { data, isLoading } = useQuery({
    queryKey: ['autonomy-configs'],
    queryFn: () => apiService.getAutonomyConfigs(),
  });

  const configs: AutonomyConfig[] = data?.configs || [];
  const configMap = new Map(configs.map(c => [c.agentId, c]));

  const sortedAgents = [...KNOWN_AGENTS].sort((a, b) => {
    const aT3 = configMap.has(a) ? 0 : 1;
    const bT3 = configMap.has(b) ? 0 : 1;
    if (aT3 !== bT3) return aT3 - bT3;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Autonomous Execution (Tier 3)</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Tier 2 agents propose actions for human review. Tier 3 agents auto-execute low-risk, high-confidence proposals.
              Promotion requires 30+ days, 20+ proposals, 80%+ acceptance, 70%+ effectiveness, and zero rollbacks.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <span className="text-gray-600 dark:text-gray-400">
          <span className="font-bold text-gray-900 dark:text-white">{configs.length}</span> at Tier 3
        </span>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <span className="text-gray-600 dark:text-gray-400">
          <span className="font-bold text-gray-900 dark:text-white">{KNOWN_AGENTS.length - configs.length}</span> at Tier 2
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {sortedAgents.map(agentId => (
            <AgentEligibilityCard key={agentId} agentId={agentId} config={configMap.get(agentId)} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const PAGE_TABS = [
  { key: 'proposals', label: 'Proposals', icon: Bot },
  { key: 'autonomy', label: 'Autonomy', icon: Shield },
] as const;

export const AgentProposalsPage: React.FC = () => {
  const [pageTab, setPageTab] = useState<'proposals' | 'autonomy'>('proposals');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [allProposals, setAllProposals] = useState<Proposal[]>([]);
  const [proposalsTotal, setProposalsTotal] = useState(0);
  const [proposalsOffset, setProposalsOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const PROPOSALS_PAGE_SIZE = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agent-proposals', statusFilter],
    queryFn: () => apiService.getAgentProposals({
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: PROPOSALS_PAGE_SIZE,
      offset: 0,
    }),
    enabled: pageTab === 'proposals',
  });

  // Sync initial fetch into accumulated state
  React.useEffect(() => {
    if (data) {
      const items: Proposal[] = data.proposals || [];
      setAllProposals(items);
      setProposalsTotal(data.total ?? items.length);
      setProposalsOffset(items.length);
    }
  }, [data]);

  // Reset accumulated state when filter changes
  React.useEffect(() => {
    setAllProposals([]);
    setProposalsOffset(0);
    setProposalsTotal(0);
  }, [statusFilter]);

  const handleLoadMoreProposals = React.useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await apiService.getAgentProposals({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: PROPOSALS_PAGE_SIZE,
        offset: proposalsOffset,
      });
      const items: Proposal[] = res?.proposals || [];
      setAllProposals(prev => [...prev, ...items]);
      setProposalsOffset(prev => prev + items.length);
      if (res?.total !== undefined) setProposalsTotal(res.total);
    } catch { /* non-critical */ }
    setLoadingMore(false);
  }, [statusFilter, proposalsOffset]);

  const proposals: Proposal[] = allProposals;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Proposals</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Review and approve proposals generated by Mjuzi's autonomous agents.</p>
      </div>

      <HealthBanner />

      {/* Page Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
        {PAGE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setPageTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                pageTab === tab.key
                  ? 'border-gray-900 dark:border-white text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Proposals Tab */}
      {pageTab === 'proposals' && (
        <>
          {/* Triage — pending items front and center */}
          {!isLoading && !isError && <TriageSection proposals={proposals} onSelect={setSelectedId} />}

          {/* Status Filters */}
          <div className="flex items-center gap-1">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-gray-200 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 rounded-full animate-spin" />
            </div>
          )}

          {isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-400">
              Failed to load proposals.
            </div>
          )}

          {!isLoading && !isError && proposals.length === 0 && (
            <div className="text-center py-20">
              <Bot className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-1">No proposals</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {statusFilter === 'all' ? 'Agents have not generated any proposals yet.' : `No ${statusFilter} proposals.`}
              </p>
            </div>
          )}

          {/* Proposals Table */}
          {!isLoading && !isError && proposals.length > 0 && (
            <>
              <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Agent</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Title</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Status</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Risk</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Confidence</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Created</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {proposals.map(p => (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                            <span className="font-medium text-gray-900 dark:text-white truncate max-w-[140px]">
                              {formatAgentName(p.agent_id)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-900 dark:text-gray-100 truncate block max-w-[280px]">{p.title}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={p.status} />
                        </td>
                        <td className="px-4 py-3">
                          <RiskBadge level={p.risk_level} size="sm" />
                        </td>
                        <td className="px-4 py-3">
                          <ConfidenceBar score={p.confidence_score} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                          {timeAgo(p.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Load More + Count */}
              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Showing {proposals.length} of {proposalsTotal}</p>
                {proposals.length < proposalsTotal && (
                  <button
                    onClick={handleLoadMoreProposals}
                    disabled={loadingMore}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <div className="w-3.5 h-3.5 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
                    ) : null}
                    Load More
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Autonomy Tab */}
      {pageTab === 'autonomy' && <AutonomyTab />}

      {/* Detail Modal */}
      {selectedId && (
        <ProposalDetailModal proposalId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
};

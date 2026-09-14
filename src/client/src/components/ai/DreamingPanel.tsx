import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/api';
import { Sparkles, Check, X, Play, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface DreamingRun {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  conversationsAnalyzed: number;
  proposalsCreated: number;
  autoApplied: number;
  errorMessage: string | null;
  createdAt: string;
}

interface DreamingProposal {
  id: string;
  runId: string;
  proposalType: string;
  targetAgentId: string;
  proposedKey: string;
  proposedValue: unknown;
  evidence: unknown;
  confidence: number;
  status: string;
  reviewedBy: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { icon: React.ReactNode; color: string }> = {
  pending: { icon: <Clock className="w-4 h-4" />, color: 'text-amber-600' },
  running: { icon: <Play className="w-4 h-4 animate-pulse" />, color: 'text-blue-600' },
  completed: { icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-green-600' },
  failed: { icon: <AlertCircle className="w-4 h-4" />, color: 'text-red-600' },
  approved: { icon: <Check className="w-4 h-4" />, color: 'text-green-600' },
  rejected: { icon: <X className="w-4 h-4" />, color: 'text-red-600' },
  auto_applied: { icon: <Sparkles className="w-4 h-4" />, color: 'text-purple-600' },
};

export const DreamingPanel: React.FC = () => {
  const [runs, setRuns] = useState<DreamingRun[]>([]);
  const [proposals, setProposals] = useState<DreamingProposal[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'proposals' | 'runs'>('proposals');

  const load = useCallback(async () => {
    try {
      const [runsRes, proposalsRes] = await Promise.all([
        apiService.listDreamingRuns(),
        apiService.listDreamingProposals(),
      ]);
      setRuns(runsRes.runs || []);
      setProposals(proposalsRes.proposals || []);
    } catch {
      setError('Failed to load dreaming data');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTrigger = async () => {
    setTriggering(true);
    setError('');
    try {
      await apiService.triggerDreamingRun();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to trigger run');
    } finally {
      setTriggering(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await apiService.approveDreamingProposal(id);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to approve');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await apiService.rejectDreamingProposal(id);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to reject');
    }
  };

  const pendingCount = proposals.filter(p => p.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Dreaming / Batch Memory Refinement</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Mjuzi analyzes past conversations overnight to propose memory improvements.
              {pendingCount > 0 && <span className="ml-1 font-medium text-amber-600">{pendingCount} pending review.</span>}
            </p>
          </div>
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {triggering ? 'Triggering...' : 'Run Now'}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {/* Tab switcher */}
        <div className="flex gap-4 border-b border-gray-200 dark:border-gray-700 mb-4">
          <button
            onClick={() => setTab('proposals')}
            className={`pb-2 text-sm font-medium border-b-2 ${
              tab === 'proposals' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500'
            }`}
          >
            Proposals ({proposals.length})
          </button>
          <button
            onClick={() => setTab('runs')}
            className={`pb-2 text-sm font-medium border-b-2 ${
              tab === 'runs' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500'
            }`}
          >
            Run History ({runs.length})
          </button>
        </div>

        {tab === 'proposals' && (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {proposals.map(proposal => {
              const st = STATUS_STYLES[proposal.status] || STATUS_STYLES.pending;
              return (
                <div key={proposal.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`flex items-center gap-1 text-xs font-medium ${st.color}`}>
                          {st.icon}
                          {proposal.status}
                        </span>
                        <span className="text-xs text-gray-500">
                          confidence: {(proposal.confidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                          {proposal.proposalType.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{proposal.proposedKey}</p>
                      <pre className="mt-1 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded p-2 max-h-16 overflow-hidden">
                        {JSON.stringify(proposal.proposedValue, null, 2).slice(0, 200)}
                      </pre>
                      {proposal.evidence != null && (
                        <p className="mt-1 text-xs text-gray-500 italic">
                          Evidence: {typeof proposal.evidence === 'object' ? String((proposal.evidence as Record<string, unknown>)?.reason ?? JSON.stringify(proposal.evidence)) : String(proposal.evidence)}
                        </p>
                      )}
                    </div>

                    {proposal.status === 'pending' && (
                      <div className="flex gap-1 ml-3">
                        <button
                          onClick={() => handleApprove(proposal.id)}
                          className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                          title="Approve"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleReject(proposal.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          title="Reject"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {proposals.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-8">
                No proposals yet. Run a dreaming batch to analyze recent conversations.
              </p>
            )}
          </div>
        )}

        {tab === 'runs' && (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {runs.map(run => {
              const st = STATUS_STYLES[run.status] || STATUS_STYLES.pending;
              return (
                <div key={run.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <span className={`flex items-center gap-1 ${st.color}`}>{st.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{run.status}</span>
                        <span className="text-xs text-gray-500">{new Date(run.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {run.conversationsAnalyzed} conversations analyzed &middot;
                        {run.proposalsCreated} proposals &middot;
                        {run.autoApplied} auto-applied
                      </p>
                      {run.errorMessage && (
                        <p className="text-xs text-red-500 mt-1">{run.errorMessage}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {runs.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-8">No dreaming runs yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

import { useQuery } from '@tanstack/react-query';
import { Bot, ArrowRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiService } from '../../../services/api';
import { timeAgo } from '../../../utils/timeAgo';
import { RiskBadge } from '../../ui/RiskBadge';
import { ConfidenceBar } from '../../ui/ConfidenceGauge';

interface Proposal {
  id: string;
  agent_id: string;
  title: string;
  risk_level: string;
  confidence_score: number;
  created_at: string;
  status: string;
}

const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };


function agentDisplayName(agentId: string): string {
  return agentId
    .replace(/-v\d+$/, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface AgentProposalsWidgetProps {
  agentIds: string[];
}

export function AgentProposalsWidget({ agentIds }: AgentProposalsWidgetProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['agent-proposals-widget', agentIds],
    queryFn: async () => {
      const res = await apiService.getAgentProposals({ status: 'pending', limit: 50 });
      return res;
    },
    staleTime: 30000,
  });

  const allProposals: Proposal[] = data?.data || data?.proposals || [];
  const filtered = allProposals
    .filter(p => agentIds.includes(p.agent_id))
    .sort((a, b) => {
      const riskDiff = (RISK_ORDER[a.risk_level] ?? 4) - (RISK_ORDER[b.risk_level] ?? 4);
      if (riskDiff !== 0) return riskDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
    .slice(0, 5);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Agent Proposals</h3>
        </div>
        <Link
          to="/agent"
          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-1"
        >
          View All <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">No pending proposals</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <Link
              key={p.id}
              to="/agent"
              className="block border border-gray-100 dark:border-gray-700 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">{p.title}</span>
                <RiskBadge level={p.risk_level as any} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{agentDisplayName(p.agent_id)}</span>
                <div className="flex items-center gap-3">
                  <ConfidenceBar score={p.confidence_score} />
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />
                    {timeAgo(p.created_at)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

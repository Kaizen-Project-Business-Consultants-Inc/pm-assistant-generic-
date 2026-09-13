import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  Search,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { timeAgo } from '../../utils/timeAgo';

interface ActionCenterPMProps {
  projects: Array<{ id: string; name: string }>;
}

interface ActionItem {
  id: string;
  type: 'Approve' | 'Review' | 'Investigate';
  description: string;
  link: string;
  time: string;
  priority: number;
  confidenceScore?: number;
  riskLevel?: string;
  healthScore?: number;
}

const TYPE_CONFIG = {
  Approve:     { icon: CheckCircle,   color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/30', badge: 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300' },
  Review:      { icon: Search,        color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30', badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300' },
  Investigate: { icon: AlertTriangle, color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-50 dark:bg-red-900/30',    badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300' },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ActionCenterPM({ projects: _projects }: ActionCenterPMProps) {
  const navigate = useNavigate();

  const { data: notifData } = useQuery({
    queryKey: ['pm-notifications'],
    queryFn: () => apiService.getNotifications(20),
    staleTime: 30_000,
  });

  const { data: proposalsData } = useQuery({
    queryKey: ['pm-proposals-action'],
    queryFn: () => apiService.getAgentProposals({ status: 'pending', limit: 10 }),
    staleTime: 30_000,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => apiService.getAnalyticsSummary(),
    staleTime: 120_000,
  });

  const notifications: any[] = notifData?.data || notifData?.notifications || [];
  const actions: ActionItem[] = [];

  // Pending agent proposals → Approve
  const proposals = proposalsData?.data || proposalsData?.proposals || [];
  for (const p of proposals.slice(0, 5)) {
    const confidence = typeof p.confidence_score === 'number' ? p.confidence_score : undefined;
    let basePriority = p.risk_level === 'critical' ? 0 : p.risk_level === 'high' ? 1 : 2;
    if (confidence != null && confidence < 60) basePriority = Math.max(0, basePriority - 1);
    actions.push({
      id: `proposal-${p.id}`,
      type: 'Approve',
      description: `Review proposal: ${p.title}`,
      link: '/agent',
      time: p.created_at ? timeAgo(p.created_at) : '',
      priority: basePriority,
      confidenceScore: confidence,
      riskLevel: p.risk_level,
    });
  }

  // Critical/high notifications → Investigate
  for (const n of notifications.filter((n: any) => !n.read_at && (n.severity === 'critical' || n.severity === 'high')).slice(0, 3)) {
    actions.push({
      id: `notif-${n.id}`,
      type: 'Investigate',
      description: n.title || n.message || 'Urgent notification',
      link: '/notifications',
      time: n.created_at ? timeAgo(n.created_at) : '',
      priority: n.severity === 'critical' ? 2 : 3,
    });
  }

  // Low-health projects → Review
  const summary = analyticsData?.data || analyticsData;
  for (const p of (summary?.projectBreakdown || []).filter((p: any) => (p.healthScore ?? 100) < 60).slice(0, 3)) {
    actions.push({
      id: `health-${p.projectId || p.id}`,
      type: 'Review',
      description: `Review project health: ${p.projectName || p.name}`,
      link: `/project/${p.projectId || p.id}`,
      time: '',
      priority: 4,
      healthScore: p.healthScore,
    });
  }

  const sorted = actions.sort((a, b) => a.priority - b.priority).slice(0, 5);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary-500" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AI Suggestions</h3>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No actions needed right now</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map(item => {
            const cfg = TYPE_CONFIG[item.type];
            const Icon = cfg.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => navigate(item.link)}
                  className="w-full text-left flex items-center gap-2.5 border border-gray-100 dark:border-gray-700 rounded-lg px-2.5 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className={`w-6 h-6 rounded-md ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-3.5 h-3.5 ${cfg.color}`} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white truncate">{item.description}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cfg.badge}`}>{item.type}</span>
                      {item.confidenceScore != null && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                          {item.confidenceScore}%
                        </span>
                      )}
                      {item.riskLevel && (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          item.riskLevel === 'critical' ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                          : item.riskLevel === 'high' ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300'
                          : item.riskLevel === 'medium' ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                          : 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
                        }`}>
                          {item.riskLevel}
                        </span>
                      )}
                      {item.healthScore != null && (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          item.healthScore < 40 ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                          : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                        }`}>
                          Health: {item.healthScore}%
                        </span>
                      )}
                      {item.time && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{item.time}</span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-500 dark:text-gray-500 flex-shrink-0" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

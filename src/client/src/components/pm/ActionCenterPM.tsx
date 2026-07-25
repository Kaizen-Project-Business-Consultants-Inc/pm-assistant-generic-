import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Search,
  ArrowRight,
  Clock,
  Zap,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { timeAgo } from '../../utils/timeAgo';

interface ActionCenterPMProps {
  projects: Array<{ id: string; name: string }>;
}

// ─── Priorities (left column) ────────────────────────────────────────────────

interface PriorityRow {
  id: string;
  type: 'task' | 'risk' | 'issue' | 'milestone';
  title: string;
  projectName: string;
  dueLabel: string;
  isOverdue: boolean;
  daysUntilDue: number;
}

function PrioritiesList({ projects }: { projects: Array<{ id: string; name: string }> }) {
  const { data: predictionsData } = useQuery({
    queryKey: ['pm-predictions-action'],
    queryFn: () => apiService.getDashboardPredictions(),
    staleTime: 60_000,
  });

  const { data: notifData } = useQuery({
    queryKey: ['pm-notif-action'],
    queryFn: () => apiService.getNotifications(20),
    staleTime: 30_000,
  });

  const rows: PriorityRow[] = [];

  // Build project name map
  const nameMap = new Map(projects.map(p => [p.id, p.name]));

  // Pull overdue / at-risk tasks from predictions highlights
  const predictions = predictionsData?.data || predictionsData;
  if (predictions?.highlights) {
    for (const h of (predictions.highlights as Array<any>).slice(0, 3)) {
      const text: string = typeof h === 'string' ? h : (h.text || '');
      if (!text) continue;
      rows.push({
        id: `hl-${rows.length}`,
        type: 'task',
        title: text,
        projectName: '',
        dueLabel: 'Flagged',
        isOverdue: text.toLowerCase().includes('overdue') || text.toLowerCase().includes('late'),
        daysUntilDue: 0,
      });
    }
  }

  // High-severity notifications not yet read → surface as priority items
  const notifications: any[] = notifData?.data || notifData?.notifications || [];
  const urgent = notifications
    .filter((n: any) => !n.read_at && (n.severity === 'high' || n.severity === 'critical'))
    .slice(0, 5 - rows.length);

  for (const n of urgent) {
    const daysUntil = n.due_date
      ? Math.ceil((new Date(n.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 0;
    rows.push({
      id: `notif-${n.id}`,
      type: 'issue',
      title: n.title || n.message || 'Urgent notification',
      projectName: nameMap.get(n.project_id || '') || '',
      dueLabel: n.due_date
        ? daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : `Due in ${daysUntil}d`
        : 'Urgent',
      isOverdue: daysUntil < 0,
      daysUntilDue: daysUntil,
    });
  }

  const typeLabels: Record<string, string> = {
    task: 'Task',
    risk: 'Risk',
    issue: 'Issue',
    milestone: 'Milestone',
  };

  const typePillCls: Record<string, string> = {
    task:      'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    risk:      'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    issue:     'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    milestone: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  };

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        Today's Priorities
      </p>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">No urgent items</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 5).map(row => (
            <li key={row.id} className="flex items-start gap-2.5">
              {/* Semantic dot */}
              <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${
                row.isOverdue
                  ? 'bg-red-500'
                  : row.daysUntilDue <= 2
                    ? 'bg-orange-500'
                    : 'bg-amber-400'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-900 dark:text-gray-100 truncate">{row.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${typePillCls[row.type]}`}>
                    {typeLabels[row.type]}
                  </span>
                  {row.projectName && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{row.projectName}</span>
                  )}
                  <span className={`text-[10px] font-medium ${row.isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                    {row.dueLabel}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── AI Next Best Actions (right column) ─────────────────────────────────────

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

function AINextBestActions() {
  const navigate = useNavigate();

  const { data: proposalsData } = useQuery({
    queryKey: ['pm-proposals-action'],
    queryFn: () => apiService.getAgentProposals({ status: 'pending', limit: 10 }),
    staleTime: 30_000,
  });

  const { data: notificationsData } = useQuery({
    queryKey: ['pm-notif-nba'],
    queryFn: () => apiService.getNotifications(10),
    staleTime: 30_000,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['pm-analytics-action'],
    queryFn: () => apiService.getAnalyticsSummary(),
    staleTime: 60_000,
  });

  const actions: ActionItem[] = [];

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

  const notifications: any[] = notificationsData?.data || notificationsData?.notifications || [];
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
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-3">
        <Zap className="w-3.5 h-3.5 text-primary-500" />
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          AI Next Best Actions
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">No actions needed right now</p>
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
                    <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-900 dark:text-white truncate">{item.description}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cfg.badge}`}>{item.type}</span>
                      {item.confidenceScore != null && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                          {item.confidenceScore}%
                        </span>
                      )}
                      {item.riskLevel && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          item.riskLevel === 'critical' ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                          : item.riskLevel === 'high' ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300'
                          : item.riskLevel === 'medium' ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                          : 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
                        }`}>
                          {item.riskLevel}
                        </span>
                      )}
                      {item.healthScore != null && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          item.healthScore < 40 ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                          : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                        }`}>
                          Health: {item.healthScore}
                        </span>
                      )}
                      {item.time && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {item.time}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ActionCenterPM({ projects }: ActionCenterPMProps) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Action Center</h3>
        </div>
        <Link
          to="/notifications"
          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-1"
        >
          View All <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Two columns with vertical divider */}
      <div className="flex gap-4">
        <PrioritiesList projects={projects} />
        {/* Vertical divider */}
        <div className="w-px bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
        <AINextBestActions />
      </div>
    </div>
  );
}

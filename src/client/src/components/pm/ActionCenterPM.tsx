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
  CalendarClock,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { timeAgo } from '../../utils/timeAgo';

interface ActionCenterPMProps {
  projects: Array<{ id: string; name: string }>;
}

// ─── Priorities — deadline-driven (left column) ─────────────────────────────

interface PriorityRow {
  id: string;
  type: 'overdue' | 'due-today' | 'due-week' | 'milestone';
  title: string;
  projectName: string;
  projectId?: string;
  dueLabel: string;
  isOverdue: boolean;
}

const priorityTypeLabels: Record<string, string> = {
  'overdue': 'Overdue',
  'due-today': 'Due Today',
  'due-week': 'Due This Week',
  'milestone': 'Milestone',
};

const priorityTypePillCls: Record<string, string> = {
  'overdue':   'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  'due-today': 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  'due-week':  'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  'milestone': 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
};

function PrioritiesList({ projects }: { projects: Array<{ id: string; name: string }> }) {
  const navigate = useNavigate();

  const { data: overdueData } = useQuery({
    queryKey: ['pm-dashboard-overdue'],
    queryFn: () => apiService.getDashboardOverdueTasks(),
    staleTime: 120_000,
  });

  const { data: milestonesData } = useQuery({
    queryKey: ['pm-dashboard-milestones'],
    queryFn: () => apiService.getDashboardMilestones(undefined, 5),
    staleTime: 120_000,
  });

  const rows: PriorityRow[] = [];
  const nameMap = new Map(projects.map(p => [p.id, p.name]));
  const today = new Date().toISOString().slice(0, 10);
  const endOfWeek = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (7 - d.getDay()));
    return d.toISOString().slice(0, 10);
  })();

  // Overdue tasks
  const overdueTasks: any[] = overdueData?.tasks || [];
  for (const t of overdueTasks.slice(0, 5)) {
    rows.push({
      id: `overdue-${t.id}`,
      type: 'overdue',
      title: t.name || 'Untitled task',
      projectName: t.projectName || nameMap.get(t.projectId) || '',
      projectId: t.projectId,
      dueLabel: t.overdueDays ? `${t.overdueDays}d overdue` : 'Overdue',
      isOverdue: true,
    });
  }

  // Upcoming milestones
  const milestones: any[] = milestonesData?.milestones || milestonesData?.data || [];
  for (const m of milestones.slice(0, 3)) {
    const dueDate = m.dueDate || m.end_date || '';
    const dueDateStr = dueDate ? String(dueDate).slice(0, 10) : '';
    const isDueToday = dueDateStr === today;
    const isDueThisWeek = dueDateStr > today && dueDateStr <= endOfWeek;

    rows.push({
      id: `milestone-${m.id}`,
      type: isDueToday ? 'due-today' : isDueThisWeek ? 'due-week' : 'milestone',
      title: m.name || m.title || 'Milestone',
      projectName: m.projectName || nameMap.get(m.projectId) || '',
      projectId: m.projectId,
      dueLabel: dueDateStr || 'Upcoming',
      isOverdue: false,
    });
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-3">
        <CalendarClock className="w-3.5 h-3.5 text-gray-400" />
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Today's Priorities
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">No urgent deadlines</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 5).map(row => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => row.projectId
                  ? navigate(`/project/${row.projectId}?tab=schedule`)
                  : navigate('/kpi/overdue')
                }
                className="w-full text-left flex items-start gap-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg px-2 py-1.5 transition-colors"
              >
                <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${
                  row.isOverdue ? 'bg-red-500' : row.type === 'due-today' ? 'bg-orange-500' : 'bg-blue-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-900 dark:text-gray-100 truncate">{row.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${priorityTypePillCls[row.type]}`}>
                      {priorityTypeLabels[row.type]}
                    </span>
                    {row.projectName && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{row.projectName}</span>
                    )}
                    <span className={`text-[10px] font-medium ${row.isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                      {row.dueLabel}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── AI Next Best Actions — decision-driven (right column) ───────────────────

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

function AINextBestActions({ notifications }: { notifications: any[] }) {
  const navigate = useNavigate();

  const { data: proposalsData } = useQuery({
    queryKey: ['pm-proposals-action'],
    queryFn: () => apiService.getAgentProposals({ status: 'pending', limit: 10 }),
    staleTime: 30_000,
  });

  // Use shared analytics query key (same as DashboardPM)
  const { data: analyticsData } = useQuery({
    queryKey: ['pm-analytics'],
    queryFn: () => apiService.getAnalyticsSummary(),
    staleTime: 120_000,
  });

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

  // Critical/high notifications → Investigate (no duplicates with left column)
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
  // Single notifications query shared between columns (D8)
  const { data: notifData } = useQuery({
    queryKey: ['pm-notifications'],
    queryFn: () => apiService.getNotifications(20),
    staleTime: 30_000,
  });

  const notifications: any[] = notifData?.data || notifData?.notifications || [];

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
        <div className="w-px bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
        <AINextBestActions notifications={notifications} />
      </div>
    </div>
  );
}

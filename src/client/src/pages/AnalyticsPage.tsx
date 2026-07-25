import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { BarChart3, TrendingUp, DollarSign, FolderKanban, AlertTriangle, Calendar, Shield } from 'lucide-react';
import { ComplianceReport } from '../components/reports/ComplianceReport';

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  priority?: string;
  budgetAllocated?: number;
  budgetSpent?: number;
  progressPercentage?: number;
  startDate?: string;
  endDate?: string;
}

interface PortfolioItem {
  projectId: string;
  projectName: string;
  status: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  tasks: PortfolioTask[];
}

interface PortfolioTask {
  id: string;
  name: string;
  status: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  progressPercentage?: number;
  assignedTo?: string;
  parentTaskId?: string;
  completedAt?: string;
  updatedAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  planning: '#8b5cf6',
  active: '#22c55e',
  on_hold: '#eab308',
  completed: '#3b82f6',
  cancelled: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KPICard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5 flex items-start gap-4">
      <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut Chart — Projects by Status
// ---------------------------------------------------------------------------
function StatusDonutChart({ projects }: { projects: Project[] }) {
  const segments = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });
    const total = projects.length || 1;
    let cumulative = 0;
    return Object.entries(counts).map(([status, count]) => {
      const pct = count / total;
      const start = cumulative;
      cumulative += pct;
      return { status, count, pct, start, end: cumulative, color: STATUS_COLORS[status] || '#94a3b8' };
    });
  }, [projects]);

  const total = projects.length;
  const r = 80;
  const cx = 100;
  const cy = 100;
  const strokeWidth = 30;

  function arcPath(startPct: number, endPct: number, radius: number): string {
    if (endPct - startPct >= 1) {
      // full circle — use two arcs
      const x1 = cx + radius * Math.cos(-Math.PI / 2);
      const y1 = cy + radius * Math.sin(-Math.PI / 2);
      const x2 = cx + radius * Math.cos(Math.PI / 2);
      const y2 = cy + radius * Math.sin(Math.PI / 2);
      return `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2} A ${radius} ${radius} 0 1 1 ${x1} ${y1}`;
    }
    const startAngle = startPct * 2 * Math.PI - Math.PI / 2;
    const endAngle = endPct * 2 * Math.PI - Math.PI / 2;
    const largeArc = endPct - startPct > 0.5 ? 1 : 0;
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 200 200" className="w-44 h-44 flex-shrink-0">
        {segments.map((seg) => (
          <path
            key={seg.status}
            d={arcPath(seg.start, seg.end, r)}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="28" fontWeight="700" fill="#111827">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="#6b7280">Projects</text>
      </svg>
      <div className="space-y-2">
        {segments.map((seg) => (
          <div key={seg.status} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-gray-700 dark:text-gray-200">{STATUS_LABELS[seg.status] || seg.status}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-auto font-medium">{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar Chart — Budget Overview (top 8)
// ---------------------------------------------------------------------------
function BudgetBarChart({ projects }: { projects: Project[] }) {
  const items = useMemo(() => {
    return projects
      .filter((p) => (p.budgetAllocated || 0) > 0)
      .sort((a, b) => (b.budgetAllocated || 0) - (a.budgetAllocated || 0))
      .slice(0, 8);
  }, [projects]);

  if (items.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No projects with budget data</p>;
  }

  const maxVal = Math.max(...items.map((p) => p.budgetAllocated || 0));
  const padding = { top: 20, right: 20, bottom: 50, left: 55 };
  const svgWidth = 500;
  const svgHeight = 280;
  const plotW = svgWidth - padding.left - padding.right;
  const plotH = svgHeight - padding.top - padding.bottom;
  const barGroupWidth = plotW / items.length;
  const barWidth = Math.min(barGroupWidth * 0.35, 28);
  const gap = 3;

  const scaleY = (v: number) => padding.top + (1 - v / maxVal) * plotH;

  // Y-axis labels
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((maxVal / ySteps) * i);
    return { val, y: scaleY(val) };
  });

  const formatK = (v: number) => {
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
    return `$${v}`;
  };

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {yLabels.map((yl, i) => (
        <g key={i}>
          <line x1={padding.left} y1={yl.y} x2={padding.left + plotW} y2={yl.y} stroke="#f3f4f6" strokeWidth="1" />
          <text x={padding.left - 8} y={yl.y + 4} textAnchor="end" fontSize="9" fill="#9ca3af">{formatK(yl.val)}</text>
        </g>
      ))}

      {/* Bars */}
      {items.map((p, i) => {
        const cx = padding.left + barGroupWidth * i + barGroupWidth / 2;
        const allocH = ((p.budgetAllocated || 0) / maxVal) * plotH;
        const spentH = ((p.budgetSpent || 0) / maxVal) * plotH;
        const name = p.name.length > 10 ? p.name.slice(0, 9) + '...' : p.name;
        return (
          <g key={p.id}>
            <rect
              x={cx - barWidth - gap / 2}
              y={padding.top + plotH - allocH}
              width={barWidth}
              height={allocH}
              fill="#e0e7ff"
              rx="2"
            />
            <rect
              x={cx + gap / 2}
              y={padding.top + plotH - spentH}
              width={barWidth}
              height={spentH}
              fill="#6366f1"
              rx="2"
            />
            <text
              x={cx}
              y={svgHeight - 10}
              textAnchor="middle"
              fontSize="8"
              fill="#6b7280"
              transform={`rotate(-25 ${cx} ${svgHeight - 10})`}
            >
              {name}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <rect x={svgWidth - 140} y={4} width={10} height={10} fill="#e0e7ff" rx="2" />
      <text x={svgWidth - 126} y={13} fontSize="9" fill="#6b7280">Allocated</text>
      <rect x={svgWidth - 70} y={4} width={10} height={10} fill="#6366f1" rx="2" />
      <text x={svgWidth - 56} y={13} fontSize="9" fill="#6b7280">Spent</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Line Chart — Task Completion Trend (last 12 weeks)
// ---------------------------------------------------------------------------
function TaskCompletionTrendChart({ portfolioItems }: { portfolioItems: PortfolioItem[] }) {
  const weeklyData = useMemo(() => {
    const now = new Date();
    const weeks: { label: string; start: Date; end: Date; count: number }[] = [];

    for (let i = 11; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      weeks.push({
        label: `${start.getMonth() + 1}/${start.getDate()}`,
        start,
        end,
        count: 0,
      });
    }

    // Count tasks with status "completed" or "done" whose updatedAt falls in each week
    for (const item of portfolioItems) {
      for (const task of item.tasks) {
        if (task.status === 'completed' || task.status === 'done') {
          const doneDate = task.completedAt || task.updatedAt;
          if (!doneDate) continue;
          const d = new Date(doneDate);
          for (const w of weeks) {
            if (d >= w.start && d <= w.end) {
              w.count++;
              break;
            }
          }
        }
      }
    }

    return weeks;
  }, [portfolioItems]);

  const maxVal = Math.max(1, ...weeklyData.map((w) => w.count));
  const padding = { top: 20, right: 20, bottom: 40, left: 40 };
  const svgWidth = 500;
  const svgHeight = 260;
  const plotW = svgWidth - padding.left - padding.right;
  const plotH = svgHeight - padding.top - padding.bottom;

  const scaleX = (i: number) => padding.left + (i / Math.max(1, weeklyData.length - 1)) * plotW;
  const scaleY = (v: number) => padding.top + (1 - v / maxVal) * plotH;

  const points = weeklyData.map((w, i) => `${scaleX(i)},${scaleY(w.count)}`).join(' ');

  // Area fill path
  const areaPath = weeklyData.map((w, i) => {
    const x = scaleX(i);
    const y = scaleY(w.count);
    return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
  }).join(' ') + ` L ${scaleX(weeklyData.length - 1)} ${padding.top + plotH} L ${scaleX(0)} ${padding.top + plotH} Z`;

  // Y-axis labels
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((maxVal / ySteps) * i);
    return { val, y: scaleY(val) };
  });

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid */}
      {yLabels.map((yl, i) => (
        <g key={i}>
          <line x1={padding.left} y1={yl.y} x2={padding.left + plotW} y2={yl.y} stroke="#f3f4f6" strokeWidth="1" />
          <text x={padding.left - 8} y={yl.y + 4} textAnchor="end" fontSize="9" fill="#9ca3af">{yl.val}</text>
        </g>
      ))}

      {/* Area */}
      <path d={areaPath} fill="#6366f1" fillOpacity="0.08" />

      {/* Line */}
      <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" />

      {/* Dots */}
      {weeklyData.map((w, i) => (
        <circle key={i} cx={scaleX(i)} cy={scaleY(w.count)} r="3.5" fill="#6366f1" stroke="white" strokeWidth="2" />
      ))}

      {/* X-axis labels */}
      {weeklyData.filter((_, i) => i % 2 === 0 || i === weeklyData.length - 1).map((w) => {
        const idx = weeklyData.indexOf(w);
        return (
          <text key={idx} x={scaleX(idx)} y={svgHeight - 10} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {w.label}
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Horizontal Bar Chart — Resource Utilization (top 10)
// ---------------------------------------------------------------------------
function ResourceUtilizationChart({ portfolioItems }: { portfolioItems: PortfolioItem[] }) {
  const resources = useMemo(() => {
    const hours: Record<string, number> = {};
    for (const item of portfolioItems) {
      for (const task of item.tasks) {
        if (task.assignedTo) {
          hours[task.assignedTo] = (hours[task.assignedTo] || 0) + 1; // count tasks as proxy
        }
      }
    }
    return Object.entries(hours)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [portfolioItems]);

  if (resources.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No resource data available</p>;
  }

  const maxVal = Math.max(1, ...resources.map((r) => r.count));
  const padding = { top: 10, right: 20, bottom: 20, left: 100 };
  const svgWidth = 500;
  const barH = 22;
  const gap = 6;
  const svgHeight = padding.top + resources.length * (barH + gap) + padding.bottom;
  const plotW = svgWidth - padding.left - padding.right;

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {resources.map((r, i) => {
        const y = padding.top + i * (barH + gap);
        const w = (r.count / maxVal) * plotW;
        const displayName = r.name.length > 14 ? r.name.slice(0, 13) + '...' : r.name;
        return (
          <g key={r.name}>
            <text x={padding.left - 6} y={y + barH / 2 + 4} textAnchor="end" fontSize="10" fill="#374151">
              {displayName}
            </text>
            <rect x={padding.left} y={y} width={w} height={barH} fill="#6366f1" rx="3" fillOpacity="0.8" />
            <text x={padding.left + w + 6} y={y + barH / 2 + 4} fontSize="10" fill="#6b7280" fontWeight="600">
              {r.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Analytics Page
// ---------------------------------------------------------------------------
export const AnalyticsPage: React.FC = () => {
  const [_refreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'compliance'>('overview');

  const { data: projectsData, isLoading: loadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const { data: portfolioData, isLoading: loadingPortfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => apiService.getPortfolio(),
  });

  const projects: Project[] = projectsData?.data || projectsData?.projects || [];
  const portfolioItems: PortfolioItem[] = portfolioData?.portfolioItems || [];

  // ---- KPI Calculations ----
  const totalProjects = projects.length;
  const activeProjects = projects.filter((p) => p.status === 'active').length;

  const onTimeRate = useMemo(() => {
    const eligible = projects.filter((p) => p.status !== 'cancelled');
    if (eligible.length === 0) return 0;
    const now = new Date();
    const onTime = eligible.filter((p) => {
      if (!p.endDate) return true;
      const end = new Date(p.endDate);
      const progress = p.progressPercentage || 0;
      if (p.status === 'completed') return true;
      const totalDuration = p.startDate ? end.getTime() - new Date(p.startDate).getTime() : 1;
      const elapsed = p.startDate ? now.getTime() - new Date(p.startDate).getTime() : 0;
      const expectedProgress = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;
      return progress >= expectedProgress * 0.8; // within 80% of expected
    });
    return Math.round((onTime.length / eligible.length) * 100);
  }, [projects]);

  const avgBudgetUtil = useMemo(() => {
    const withBudget = projects.filter((p) => (p.budgetAllocated || 0) > 0);
    if (withBudget.length === 0) return 0;
    const total = withBudget.reduce((sum, p) => {
      return sum + ((p.budgetSpent || 0) / (p.budgetAllocated || 1)) * 100;
    }, 0);
    return Math.round(total / withBudget.length);
  }, [projects]);

  // ---- At-Risk Projects ----
  const atRiskProjects = useMemo(() => {
    return projects.filter((p) => {
      if (p.status === 'completed' || p.status === 'cancelled') return false;
      const progress = p.progressPercentage || 0;
      const budgetPct = p.budgetAllocated && p.budgetAllocated > 0
        ? ((p.budgetSpent || 0) / p.budgetAllocated) * 100
        : 0;
      // Consider at-risk if budget > 80% spent or progress very low relative to timeline
      if (budgetPct > 80) return true;
      if (p.endDate) {
        const now = new Date();
        const end = new Date(p.endDate);
        const start = p.startDate ? new Date(p.startDate) : now;
        const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        const elapsedDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        const expectedPct = Math.min(100, (elapsedDays / totalDays) * 100);
        if (progress < expectedPct * 0.5 && elapsedDays > 7) return true;
      }
      return false;
    }).slice(0, 10);
  }, [projects]);

  // ---- Upcoming Deadlines (next 7 days) ----
  const upcomingDeadlines = useMemo(() => {
    const now = new Date();
    const weekOut = new Date(now);
    weekOut.setDate(weekOut.getDate() + 7);

    const tasks: { taskName: string; projectName: string; dueDate: string; status: string }[] = [];
    for (const item of portfolioItems) {
      for (const task of item.tasks) {
        const due = task.dueDate || task.endDate;
        if (!due) continue;
        const d = new Date(due);
        if (d >= now && d <= weekOut && task.status !== 'completed' && task.status !== 'done') {
          tasks.push({
            taskName: task.name,
            projectName: item.projectName,
            dueDate: due,
            status: task.status,
          });
        }
      }
    }
    return tasks.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 15);
  }, [portfolioItems]);

  const isLoading = loadingProjects || loadingPortfolio;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Portfolio-wide KPIs and trends</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'overview' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm dark:shadow-gray-900/30' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('compliance')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'compliance' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm dark:shadow-gray-900/30' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Compliance
          </button>
        </div>
      </div>

      {activeTab === 'compliance' && projects.length > 0 && (
        <ComplianceReport projectId={projects[0].id} />
      )}

      {activeTab === 'compliance' && projects.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No projects available for compliance view</p>
      )}

      {activeTab === 'overview' && <>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={FolderKanban}
          label="Total Projects"
          value={totalProjects}
          sub={`${projects.filter((p) => p.status === 'planning').length} in planning`}
          color="bg-purple-100 text-purple-600"
        />
        <KPICard
          icon={TrendingUp}
          label="Active Projects"
          value={activeProjects}
          sub={`${Math.round((activeProjects / Math.max(1, totalProjects)) * 100)}% of portfolio`}
          color="bg-green-100 text-green-600"
        />
        <KPICard
          icon={Calendar}
          label="On-Time Delivery"
          value={`${onTimeRate}%`}
          sub="Based on timeline progress"
          color="bg-blue-100 text-blue-600"
        />
        <KPICard
          icon={DollarSign}
          label="Avg Budget Utilization"
          value={`${avgBudgetUtil}%`}
          sub="Across projects with budgets"
          color="bg-amber-100 text-amber-600"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Projects by Status</h2>
          {projects.length > 0 ? (
            <StatusDonutChart projects={projects} />
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No project data</p>
          )}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Budget Overview</h2>
          <BudgetBarChart projects={projects} />
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Task Completion Trend (12 Weeks)</h2>
          <TaskCompletionTrendChart portfolioItems={portfolioItems} />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Resource Utilization (by Tasks)</h2>
          <ResourceUtilizationChart portfolioItems={portfolioItems} />
        </div>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* At-Risk Projects */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">At-Risk Projects</h2>
          </div>
          {atRiskProjects.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No at-risk projects detected</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Project</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Progress</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Budget Used</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskProjects.map((p) => {
                    const budgetPct = p.budgetAllocated && p.budgetAllocated > 0
                      ? Math.round(((p.budgetSpent || 0) / p.budgetAllocated) * 100)
                      : null;
                    return (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="py-2 px-2 font-medium text-gray-900 dark:text-white truncate max-w-[180px]">{p.name}</td>
                        <td className="py-2 px-2">
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: (STATUS_COLORS[p.status] || '#94a3b8') + '20',
                              color: STATUS_COLORS[p.status] || '#94a3b8',
                            }}
                          >
                            {STATUS_LABELS[p.status] || p.status}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200">{p.progressPercentage || 0}%</td>
                        <td className="py-2 px-2 text-right">
                          {budgetPct !== null ? (
                            <span className={budgetPct > 80 ? 'text-red-600 font-medium' : 'text-gray-700 dark:text-gray-200'}>
                              {budgetPct}%
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Upcoming Deadlines (7 Days)</h2>
          </div>
          {upcomingDeadlines.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No tasks due in the next 7 days</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Task</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Project</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Due</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingDeadlines.map((t, i) => {
                    const dueDate = new Date(t.dueDate);
                    const now = new Date();
                    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="py-2 px-2 font-medium text-gray-900 dark:text-white truncate max-w-[160px]">{t.taskName}</td>
                        <td className="py-2 px-2 text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{t.projectName}</td>
                        <td className="py-2 px-2">
                          <span className={daysLeft <= 1 ? 'text-red-600 font-medium' : daysLeft <= 3 ? 'text-amber-600' : 'text-gray-700 dark:text-gray-200'}>
                            {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {daysLeft <= 1 && ' (tomorrow)'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-gray-500 dark:text-gray-400 capitalize">{t.status.replace('_', ' ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </>}
    </div>
  );
};

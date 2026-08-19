import {
  FileText,
  Shield,
  DollarSign,
  Users,
  ShieldAlert,
  Milestone,
  AlertTriangle,
  Clock,
  UserCheck,
  Briefcase,
  TrendingUp,
  BarChart3,
  PieChart,
  Brain,
  CalendarClock,
  Activity,
  type LucideIcon,
} from 'lucide-react';

export interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  badge: 'ai' | 'instant';
  generationType: 'instant' | 'ai-background' | 'modal-existing';
  modalType?: 'status' | 'raid' | 'strategic-risk';
}

export interface ReportCategory {
  id: string;
  title: string;
  icon: LucideIcon;
  defaultExpanded: boolean;
  reports: ReportDefinition[];
  seeAlso?: Array<{ label: string; path: string }>;
}

export const REPORT_CATALOG: ReportCategory[] = [
  {
    id: 'project-status',
    title: 'Project Status',
    icon: FileText,
    defaultExpanded: true,
    reports: [
      {
        id: 'status-report',
        name: 'Status Report',
        description: 'Full project status report with RAG ratings, milestones, and achievements',
        icon: FileText,
        badge: 'ai',
        generationType: 'modal-existing',
        modalType: 'status',
      },
      {
        id: 'raid-report',
        name: 'RAID Report',
        description: 'Risks, assumptions, issues, and dependencies summary',
        icon: ShieldAlert,
        badge: 'instant',
        generationType: 'modal-existing',
        modalType: 'raid',
      },
      {
        id: 'milestone-report',
        name: 'Milestone Report',
        description: 'All milestones with dates, status, and progress',
        icon: Milestone,
        badge: 'instant',
        generationType: 'instant',
      },
    ],
  },
  {
    id: 'schedule-risk',
    title: 'Schedule & Risk',
    icon: AlertTriangle,
    defaultExpanded: true,
    reports: [
      {
        id: 'strategic-risk-scan',
        name: 'Strategic Risk Scan',
        description: 'AI-powered strategic risk analysis across 5 dimensions',
        icon: ShieldAlert,
        badge: 'ai',
        generationType: 'modal-existing',
        modalType: 'strategic-risk',
      },
      {
        id: 'critical-tasks',
        name: 'Critical Tasks',
        description: 'Tasks on the critical path with float analysis',
        icon: AlertTriangle,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'late-slipping-tasks',
        name: 'Late & Slipping Tasks',
        description: 'Past-due and stalled tasks requiring attention',
        icon: Clock,
        badge: 'instant',
        generationType: 'instant',
      },
    ],
    seeAlso: [
      { label: 'For Monte Carlo simulation, see Simulation', path: '/monte-carlo' },
    ],
  },
  {
    id: 'resources',
    title: 'Resources',
    icon: Users,
    defaultExpanded: false,
    reports: [
      {
        id: 'resource-overview',
        name: 'Resource Overview',
        description: 'All resources with roles, skills, and group assignments',
        icon: Users,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'resource-status',
        name: 'Resource Status',
        description: 'Dashboard overview — counts by role, group, and utilization distribution',
        icon: Activity,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'who-does-what',
        name: 'Who Does What',
        description: 'Resource-to-task assignments across the project',
        icon: UserCheck,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'who-does-what-when',
        name: 'Who Does What When',
        description: 'Time-phased weekly resource assignments with hours per week',
        icon: CalendarClock,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'resource-availability',
        name: 'Resource Availability',
        description: 'Weekly capacity and utilization for each resource',
        icon: Briefcase,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'resource-cost-overview',
        name: 'Resource Cost Overview',
        description: 'Cost rates, weekly costs, and total resource costs',
        icon: DollarSign,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'overallocated-resources',
        name: 'Overallocated Resources',
        description: 'Resources exceeding their weekly capacity',
        icon: AlertTriangle,
        badge: 'instant',
        generationType: 'instant',
      },
    ],
  },
  {
    id: 'budget-cost',
    title: 'Budget & Cost',
    icon: DollarSign,
    defaultExpanded: false,
    reports: [
      {
        id: 'budget-forecast',
        name: 'Budget Forecast',
        description: 'AI-powered budget analysis and cost projections',
        icon: TrendingUp,
        badge: 'ai',
        generationType: 'ai-background',
      },
      {
        id: 'cost-overview',
        name: 'Cost Overview',
        description: 'Project budget vs actual spend with task-level breakdown',
        icon: DollarSign,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'overbudget-resources',
        name: 'Overbudget Resources',
        description: 'Resources where actual cost exceeds planned cost',
        icon: AlertTriangle,
        badge: 'instant',
        generationType: 'instant',
      },
      {
        id: 'earned-value-summary',
        name: 'Earned Value Summary',
        description: 'EVM metrics: CPI, SPI, EAC, ETC, and variance analysis',
        icon: BarChart3,
        badge: 'instant',
        generationType: 'instant',
      },
    ],
    seeAlso: [
      { label: 'For interactive EVM forecasting, see EVM Dashboard', path: '/evm' },
    ],
  },
  {
    id: 'ai-analysis',
    title: 'AI Analysis',
    icon: Brain,
    defaultExpanded: false,
    reports: [
      {
        id: 'risk-assessment',
        name: 'Risk Assessment',
        description: 'AI-generated risk analysis and mitigation recommendations',
        icon: Shield,
        badge: 'ai',
        generationType: 'ai-background',
      },
      {
        id: 'resource-utilization',
        name: 'Resource Utilization',
        description: 'AI analysis of resource allocation and optimization',
        icon: PieChart,
        badge: 'ai',
        generationType: 'ai-background',
      },
    ],
  },
];

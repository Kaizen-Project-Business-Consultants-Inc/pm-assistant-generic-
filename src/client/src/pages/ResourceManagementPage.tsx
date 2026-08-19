import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, AlertTriangle, ChevronDown, TrendingUp, Clock, BarChart3, Plus, Edit2, Trash2, X, Lock, LineChart, Calendar } from 'lucide-react';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { UtilizationTrendChart } from '../components/resources/UtilizationTrendChart';
import { CalendarTemplateManager } from '../components/resources/CalendarTemplateManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project { id: string; name: string; }
interface Schedule { id: string; name: string; }

interface SkillWithProficiency {
  name: string;
  level: number;
}

interface WorkloadWeek {
  weekStart: string;
  allocated: number;
  actual: number;
  capacity: number;
  utilization: number;
  cost: number;
}

interface WorkloadEntry {
  resourceId: string;
  resourceName: string;
  role: string;
  costRateHourly: number | null;
  totalCost: number;
  weeks: WorkloadWeek[];
  averageUtilization: number;
  isOverAllocated: boolean;
}

interface HistogramDemand { date: string; hours: number; }
interface HistogramResource { resourceName: string; demand: HistogramDemand[]; }
interface OverAllocation { resourceName: string; date: string; demand: number; capacity: number; }
interface HistogramData { resources: HistogramResource[]; overAllocations: OverAllocation[]; }

interface ForecastBottleneck {
  resourceName: string;
  week: string;
  demand: number;
  capacity: number;
  severity: string;
}

interface ForecastData {
  bottlenecks: ForecastBottleneck[];
  recommendations: string[];
}

interface Resource {
  id: string;
  name: string;
  role: string;
  email: string;
  capacityHoursPerWeek?: number;
  skills?: SkillWithProficiency[];
  costRateHourly?: number | null;
  resourceGroup?: string | null;
  userId?: string | null;
  calendarTemplateId?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE_ROLES = [
  'Project Manager', 'Developer', 'Designer', 'QA Tester', 'Business Analyst',
  'Scrum Master', 'DevOps Engineer', 'Architect', 'Technical Lead', 'Data Analyst',
  'UX Researcher', 'Product Owner', 'System Administrator', 'Security Analyst',
];

const RESOURCE_GROUPS = [
  'Engineering', 'Design', 'QA', 'Management', 'Operations', 'Marketing', 'Sales', 'Support',
];

const PROFICIENCY_LABELS: Record<number, string> = {
  1: 'Junior', 2: 'Intermediate', 3: 'Mid', 4: 'Senior', 5: 'Expert',
};

const UTIL_COLORS = {
  low: '#22c55e',      // green — under 80%
  optimal: '#3b82f6',  // blue — 80-100%
  over: '#f59e0b',     // amber — 100-120%
  critical: '#ef4444', // red — 120%+
};

function utilColor(pct: number): string {
  if (pct <= 80) return UTIL_COLORS.low;
  if (pct <= 100) return UTIL_COLORS.optimal;
  if (pct <= 120) return UTIL_COLORS.over;
  return UTIL_COLORS.critical;
}

function formatWeek(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type TabKey = 'team' | 'workload' | 'histogram' | 'forecast' | 'trends' | 'templates';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResourceManagementPage() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('team');
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [isCustomRole, setIsCustomRole] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formCapacity, setFormCapacity] = useState('40');
  const [formCostRate, setFormCostRate] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formSkills, setFormSkills] = useState<SkillWithProficiency[]>([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillLevel, setNewSkillLevel] = useState(3);
  const [groupFilter, setGroupFilter] = useState('');
  const [trendResourceId, setTrendResourceId] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Queries
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });
  const projects: Project[] = projectsData?.data || projectsData?.projects || [];

  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', selectedProjectId],
    queryFn: () => apiService.getSchedules(selectedProjectId),
    enabled: !!selectedProjectId && selectedProjectId !== '__all__',
  });
  const schedules: Schedule[] = schedulesData?.schedules || [];

  const isGlobalWorkload = selectedProjectId === '__all__';

  const { data: workloadData, isLoading: workloadLoading } = useQuery({
    queryKey: ['workload', selectedProjectId],
    queryFn: () => isGlobalWorkload
      ? apiService.getGlobalResourceWorkload()
      : apiService.getResourceWorkload(selectedProjectId),
    enabled: !!selectedProjectId,
  });
  const workload: WorkloadEntry[] = workloadData?.workload || [];

  const { data: histogramData, isLoading: histogramLoading } = useQuery({
    queryKey: ['histogram', selectedScheduleId],
    queryFn: () => apiService.getResourceHistogram(selectedScheduleId),
    enabled: !!selectedScheduleId,
  });
  const histogram: HistogramData | null = histogramData?.histogram || null;

  const { data: forecastData, isLoading: forecastLoading } = useQuery({
    queryKey: ['forecast', selectedProjectId],
    queryFn: () => apiService.getResourceForecast(selectedProjectId, 8),
    enabled: !!selectedProjectId && !isGlobalWorkload,
  });
  const forecast: ForecastData | null = forecastData || null;

  // Resource CRUD
  const { data: resourcesData, isLoading: resourcesLoading } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
  });
  const resources: Resource[] = resourcesData?.resources || [];
  const isResourcesSample: boolean = resourcesData?.sample || false;

  const createResourceMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiService.createResource(data as any),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['resources'] }); resetForm(); },
  });

  const updateResourceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiService.updateResource(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['resources'] }); resetForm(); },
  });

  const deleteResourceMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteResource(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });

  function resetForm() {
    setShowResourceForm(false);
    setEditingResource(null);
    setFormName('');
    setFormRole('');
    setIsCustomRole(false);
    setFormEmail('');
    setFormCapacity('40');
    setFormCostRate('');
    setFormGroup('');
    setFormSkills([]);
    setNewSkillName('');
    setNewSkillLevel(3);
  }

  function openEdit(r: Resource) {
    setEditingResource(r);
    setFormName(r.name);
    setFormRole(r.role);
    setIsCustomRole(!RESOURCE_ROLES.includes(r.role));
    setFormEmail(r.email);
    setFormCapacity(String(r.capacityHoursPerWeek || 40));
    setFormCostRate(r.costRateHourly != null ? String(r.costRateHourly) : '');
    setFormGroup(r.resourceGroup || '');
    setFormSkills(r.skills || []);
    setShowResourceForm(true);
  }

  function handleSaveResource() {
    const costRate = formCostRate.trim() ? parseFloat(formCostRate) : null;
    const data = {
      name: formName,
      role: formRole,
      email: formEmail,
      capacityHoursPerWeek: parseInt(formCapacity) || 40,
      costRateHourly: costRate,
      resourceGroup: formGroup || null,
      skills: formSkills,
    };
    if (editingResource) {
      updateResourceMutation.mutate({ id: editingResource.id, data });
    } else {
      createResourceMutation.mutate(data);
    }
  }

  function addSkill() {
    const name = newSkillName.trim();
    if (!name || formSkills.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
    setFormSkills([...formSkills, { name, level: newSkillLevel }]);
    setNewSkillName('');
    setNewSkillLevel(3);
  }

  function removeSkill(idx: number) {
    setFormSkills(formSkills.filter((_, i) => i !== idx));
  }

  // Derived
  const allGroups = useMemo(() => {
    const groups = new Set<string>();
    resources.forEach(r => { if (r.resourceGroup) groups.add(r.resourceGroup); });
    return [...groups].sort();
  }, [resources]);

  const filteredResources = useMemo(() => {
    if (!groupFilter) return resources;
    return resources.filter(r => r.resourceGroup === groupFilter);
  }, [resources, groupFilter]);

  const stats = useMemo(() => {
    if (!workload.length) return { total: 0, overAllocated: 0, avgUtil: 0, totalCost: 0 };
    const overAllocated = workload.filter(w => w.isOverAllocated).length;
    const avgUtil = Math.round(workload.reduce((s, w) => s + w.averageUtilization, 0) / workload.length);
    const totalCost = workload.reduce((s, w) => s + (w.totalCost || 0), 0);
    return { total: workload.length, overAllocated, avgUtil, totalCost };
  }, [workload]);

  // Auto-select first schedule
  useEffect(() => {
    if (schedules.length > 0 && !selectedScheduleId) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  const needsProjectSelector = activeTab === 'workload' || activeTab === 'histogram' || activeTab === 'forecast';

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <Users className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Resource Management</h1>
            <p className="text-sm text-gray-500">Monitor workload, allocation, and capacity across projects</p>
          </div>
        </div>
      </div>

      {/* Top-level tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        <div className="flex gap-4 sm:gap-6 min-w-max">
          {([
            { key: 'team' as const, label: 'Team', icon: Users },
            { key: 'workload' as const, label: 'Workload Heatmap', icon: BarChart3 },
            { key: 'histogram' as const, label: 'Resource Histogram', icon: Clock },
            { key: 'forecast' as const, label: 'Capacity Forecast', icon: TrendingUp },
            { key: 'trends' as const, label: 'Trends', icon: LineChart },
            { key: 'templates' as const, label: 'Calendar Templates', icon: Calendar },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sample upgrade banner */}
      {isResourcesSample && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Resource Data</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                These are sample resources with demo data. Upgrade to a paid plan to manage your team's capacity, skills, assignments, and workload.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Team Tab */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-500">{filteredResources.length} resources</p>
              {allGroups.length > 0 && (
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">All Departments</option>
                  {allGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              )}
            </div>
            {!isResourcesSample && (
              <button
                onClick={() => { resetForm(); setShowResourceForm(true); }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Resource
              </button>
            )}
          </div>

          {/* Inline form */}
          {showResourceForm && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-primary-200 dark:border-primary-700 p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{editingResource ? 'Edit Resource' : 'New Resource'}</h3>
                <button onClick={resetForm} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close resource form"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
                  <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" placeholder="Full name" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Role</label>
                  <select
                    value={isCustomRole ? '__custom__' : formRole}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') { setIsCustomRole(true); setFormRole(''); }
                      else { setIsCustomRole(false); setFormRole(e.target.value); }
                    }}
                    className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="">Select role...</option>
                    {RESOURCE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    <option value="__custom__">Other (custom)...</option>
                  </select>
                  {isCustomRole && (
                    <input type="text" value={formRole} onChange={(e) => setFormRole(e.target.value)} className="input w-full text-sm mt-1 dark:bg-gray-700 dark:text-gray-100" placeholder="Enter custom role" autoFocus />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email</label>
                  <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" placeholder="email@example.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Hours/Week</label>
                  <input type="number" value={formCapacity} onChange={(e) => setFormCapacity(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" min="1" max="80" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cost Rate ($/hr)</label>
                  <input type="number" value={formCostRate} onChange={(e) => setFormCostRate(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" min="0" step="0.01" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Department</label>
                  <select value={formGroup} onChange={(e) => setFormGroup(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100">
                    <option value="">No department</option>
                    {RESOURCE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              {/* Skills with proficiency */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Skills</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {formSkills.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/30 text-xs text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700">
                      {s.name} <span className="text-[10px] opacity-70">({PROFICIENCY_LABELS[s.level] || s.level})</span>
                      <button type="button" onClick={() => removeSkill(i)} className="ml-0.5 text-primary-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                    className="input text-sm dark:bg-gray-700 dark:text-gray-100 flex-1"
                    placeholder="Add skill..."
                  />
                  <select value={newSkillLevel} onChange={(e) => setNewSkillLevel(Number(e.target.value))} className="input text-sm dark:bg-gray-700 dark:text-gray-100 w-32">
                    {[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>{PROFICIENCY_LABELS[l]}</option>)}
                  </select>
                  <button type="button" onClick={addSkill} disabled={!newSkillName.trim()} className="px-3 py-1.5 text-xs font-medium bg-primary-100 text-primary-700 rounded hover:bg-primary-200 disabled:opacity-40">Add</button>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveResource}
                  disabled={!formName.trim() || !formRole.trim() || !formEmail.trim() || createResourceMutation.isPending || updateResourceMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {(createResourceMutation.isPending || updateResourceMutation.isPending) ? 'Saving...' : editingResource ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          )}

          {/* Resource list */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            {resourcesLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : filteredResources.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>{groupFilter ? 'No resources in this department.' : 'No resources yet. Add your first team member.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Role</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Department</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Skills</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Email</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Hours/Wk</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">$/hr</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResources.map(r => (
                    <tr key={r.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.role}</td>
                      <td className="px-4 py-3">
                        {r.resourceGroup ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{r.resourceGroup}</span>
                        ) : <span className="text-gray-300 dark:text-gray-600">--</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {(r.skills || []).slice(0, 4).map((s, i) => (
                            <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300" title={`${s.name} (${PROFICIENCY_LABELS[s.level] || s.level})`}>
                              {s.name}
                              <span className="ml-0.5 opacity-60">{s.level}</span>
                            </span>
                          ))}
                          {(r.skills || []).length > 4 && <span className="text-[10px] text-gray-400">+{(r.skills || []).length - 4}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.email}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{r.capacityHoursPerWeek || 40}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{r.costRateHourly != null ? `$${r.costRateHourly.toFixed(2)}` : '--'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Edit resource"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setDeleteConfirmId(r.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Delete resource"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Project & Schedule selectors (for analytics tabs) */}
      {needsProjectSelector && <div className="flex items-center gap-4 flex-wrap">
        <div className="relative">
          <select
            value={selectedProjectId}
            onChange={(e) => { setSelectedProjectId(e.target.value); setSelectedScheduleId(''); }}
            className="appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-3 pr-8 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">Select project...</option>
            <option value="__all__">All Projects (Cross-Project)</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        {!isGlobalWorkload && schedules.length > 1 && (
          <div className="relative">
            <select
              value={selectedScheduleId}
              onChange={(e) => setSelectedScheduleId(e.target.value)}
              className="appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-3 pr-8 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>}

      {needsProjectSelector && !selectedProjectId && (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">Select a project to view resource data</p>
        </div>
      )}

      {needsProjectSelector && selectedProjectId && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg"><Users className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
                  <p className="text-xs text-gray-500">Total Resources</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${stats.overAllocated > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                  <AlertTriangle className={`w-5 h-5 ${stats.overAllocated > 0 ? 'text-red-600' : 'text-green-600'}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.overAllocated}</p>
                  <p className="text-xs text-gray-500">Over-allocated</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-50 rounded-lg"><TrendingUp className="w-5 h-5 text-purple-600" /></div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.avgUtil}%</p>
                  <p className="text-xs text-gray-500">Avg Utilization</p>
                </div>
              </div>
            </div>
            {stats.totalCost > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 rounded-lg"><TrendingUp className="w-5 h-5 text-emerald-600" /></div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">${stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-xs text-gray-500">Estimated Cost</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Workload heatmap tab */}
          {activeTab === 'workload' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              {workloadLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                </div>
              ) : workload.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <p>No workload data available{isGlobalWorkload ? '.' : ' for this project.'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700">
                        <th className="sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 min-w-[180px]">Resource</th>
                        <th className="text-left px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 w-16">Avg</th>
                        <th className="text-right px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 w-20">Cost</th>
                        {workload[0]?.weeks.map((w, i) => (
                          <th key={i} className="text-center px-1 py-3 font-medium text-gray-500 text-xs min-w-[60px]">{formatWeek(w.weekStart)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {workload.map(entry => (
                        <tr key={entry.resourceId} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="sticky left-0 bg-white dark:bg-gray-800 z-10 px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{entry.resourceName}</div>
                            <div className="text-xs text-gray-500">{entry.role}</div>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className="inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: utilColor(entry.averageUtilization) }}
                            >
                              {Math.round(entry.averageUtilization)}%
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-xs font-medium text-gray-600 dark:text-gray-400">
                            {entry.costRateHourly != null && entry.totalCost > 0
                              ? `$${entry.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                              : '—'}
                          </td>
                          {entry.weeks.map((w, i) => {
                            const pct = Math.round(w.utilization);
                            return (
                              <td key={i} className="px-1 py-3 text-center">
                                <div
                                  className="mx-auto w-10 h-8 rounded flex items-center justify-center text-[10px] font-bold text-white"
                                  style={{ backgroundColor: utilColor(pct), opacity: pct === 0 ? 0.15 : 0.85 }}
                                  title={`${w.allocated}h / ${w.capacity}h (${pct}%)${w.cost > 0 ? ` — $${w.cost.toLocaleString()}` : ''}${w.actual > 0 ? ` | Actual: ${w.actual}h` : ''}`}
                                >
                                  {pct > 0 ? `${pct}%` : ''}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Legend */}
              {workload.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-500">
                  <span className="font-medium">Utilization:</span>
                  {[
                    { label: '< 80% Under', color: UTIL_COLORS.low },
                    { label: '80-100% Optimal', color: UTIL_COLORS.optimal },
                    { label: '100-120% Warning', color: UTIL_COLORS.over },
                    { label: '> 120% Critical', color: UTIL_COLORS.critical },
                  ].map(l => (
                    <span key={l.label} className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: l.color }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Histogram tab */}
          {activeTab === 'histogram' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              {!selectedScheduleId ? (
                <div className="text-center py-12 text-gray-400">Select a schedule to view the histogram.</div>
              ) : histogramLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                </div>
              ) : !histogram || histogram.resources.length === 0 ? (
                <div className="text-center py-12 text-gray-400">No histogram data available.</div>
              ) : (
                <div className="space-y-6">
                  {histogram.overAllocations.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        <span className="text-sm font-semibold text-red-700 dark:text-red-400">{histogram.overAllocations.length} Over-allocation{histogram.overAllocations.length > 1 ? 's' : ''} Detected</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {histogram.overAllocations.slice(0, 6).map((oa, i) => (
                          <div key={i} className="text-xs text-red-600 dark:text-red-400">
                            <span className="font-medium">{oa.resourceName}</span> on {new Date(oa.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {oa.demand}h / {oa.capacity}h
                          </div>
                        ))}
                        {histogram.overAllocations.length > 6 && (
                          <div className="text-xs text-red-500">...and {histogram.overAllocations.length - 6} more</div>
                        )}
                      </div>
                    </div>
                  )}

                  {histogram.resources.map(res => {
                    const maxH = Math.max(...res.demand.map(d => d.hours), 8);
                    const chartH = 120;
                    const barW = Math.max(4, Math.min(20, 600 / Math.max(res.demand.length, 1)));
                    const chartW = res.demand.length * (barW + 2) + 40;

                    return (
                      <div key={res.resourceName}>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{res.resourceName}</h3>
                        <div className="overflow-x-auto">
                          <svg width={chartW} height={chartH + 30} className="block">
                            <line x1={30} y1={chartH - (8 / maxH) * chartH} x2={chartW} y2={chartH - (8 / maxH) * chartH} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" />
                            <text x={0} y={chartH - (8 / maxH) * chartH + 4} fontSize={9} fill="#ef4444">8h</text>
                            {res.demand.map((d, i) => {
                              const h = (d.hours / maxH) * chartH;
                              const isOver = d.hours > 8;
                              return (
                                <g key={i}>
                                  <rect x={30 + i * (barW + 2)} y={chartH - h} width={barW} height={h} fill={isOver ? '#ef4444' : '#3b82f6'} opacity={0.8} rx={1} />
                                  {i % Math.max(1, Math.floor(res.demand.length / 10)) === 0 && (
                                    <text x={30 + i * (barW + 2)} y={chartH + 14} fontSize={8} fill="#9ca3af" textAnchor="start" transform={`rotate(45, ${30 + i * (barW + 2)}, ${chartH + 14})`}>
                                      {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </text>
                                  )}
                                </g>
                              );
                            })}
                            <line x1={29} y1={0} x2={29} y2={chartH} stroke="#e5e7eb" strokeWidth={1} />
                          </svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Forecast tab */}
          {activeTab === 'forecast' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              {isGlobalWorkload ? (
                <div className="text-center py-12 text-gray-400">Select a specific project to view capacity forecast.</div>
              ) : forecastLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                </div>
              ) : !forecast ? (
                <div className="text-center py-12 text-gray-400">No forecast data available.</div>
              ) : (
                <div className="space-y-6">
                  {forecast.bottlenecks && forecast.bottlenecks.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        Predicted Bottlenecks (next 8 weeks)
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-700">
                              <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Resource</th>
                              <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Week</th>
                              <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Demand</th>
                              <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Capacity</th>
                              <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Severity</th>
                            </tr>
                          </thead>
                          <tbody>
                            {forecast.bottlenecks.map((b, i) => (
                              <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                                <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{b.resourceName}</td>
                                <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{formatWeek(b.week)}</td>
                                <td className="px-4 py-2 text-right text-gray-900 dark:text-white">{b.demand}h</td>
                                <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{b.capacity}h</td>
                                <td className="px-4 py-2">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white ${b.severity === 'critical' ? 'bg-red-500' : b.severity === 'high' ? 'bg-amber-500' : 'bg-yellow-400'}`}>
                                    {b.severity}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                      <TrendingUp className="w-5 h-5" />
                      <span className="text-sm font-medium">No bottlenecks predicted for the next 8 weeks</span>
                    </div>
                  )}

                  {forecast.recommendations && forecast.recommendations.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Recommendations</h3>
                      <ul className="space-y-1.5">
                        {forecast.recommendations.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <span className="text-primary-500 mt-0.5">&#8226;</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Trends tab */}
      {activeTab === 'trends' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-500">Resource:</label>
            <select
              value={trendResourceId}
              onChange={(e) => setTrendResourceId(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select a resource...</option>
              {resources.map(r => <option key={r.id} value={r.id}>{r.name} — {r.role}</option>)}
            </select>
          </div>
          {trendResourceId ? (
            <UtilizationTrendChart resourceId={trendResourceId} />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-400">
              Select a resource to view utilization trends over time.
            </div>
          )}
        </div>
      )}

      {/* Calendar Templates tab */}
      {activeTab === 'templates' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <CalendarTemplateManager />
        </div>
      )}

      {deleteConfirmId && (
        <ConfirmModal
          title="Delete Resource"
          message="Delete this resource? Any assignments will also be removed."
          confirmLabel="Delete"
          isPending={deleteResourceMutation.isPending}
          onConfirm={() => { deleteResourceMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
}

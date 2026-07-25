import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, AlertTriangle, TrendingUp, Clock, BarChart3, Plus, Edit2, Trash2, X, SlidersHorizontal } from 'lucide-react';
import { apiService } from '../../services/api';
import { ResourceLevelingPanel } from '../resources/ResourceLevelingPanel';
import { ResourceForecastPanel } from '../resources/ResourceForecastPanel';
import { CapacityChart } from '../resources/CapacityChart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkloadWeek {
  weekStart: string;
  allocated: number;
  capacity: number;
  utilization: number;
}

interface WorkloadEntry {
  resourceId: string;
  resourceName: string;
  role: string;
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
  skills?: string[];
  costRateHourly?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE_ROLES = [
  'Project Manager', 'Developer', 'Designer', 'QA Tester', 'Business Analyst',
  'Scrum Master', 'DevOps Engineer', 'Architect', 'Technical Lead', 'Data Analyst',
  'UX Researcher', 'Product Owner', 'System Administrator', 'Security Analyst',
];

const UTIL_COLORS = {
  low: '#22c55e',
  optimal: '#3b82f6',
  over: '#f59e0b',
  critical: '#ef4444',
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

type SubTab = 'team' | 'workload' | 'histogram' | 'forecast' | 'leveling';

const subTabs: { key: SubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'team', label: 'Team', icon: Users },
  { key: 'workload', label: 'Workload Heatmap', icon: BarChart3 },
  { key: 'histogram', label: 'Histogram', icon: Clock },
  { key: 'forecast', label: 'Forecast', icon: TrendingUp },
  { key: 'leveling', label: 'Leveling', icon: SlidersHorizontal },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResourcesTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('team');
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [isCustomRole, setIsCustomRole] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formCapacity, setFormCapacity] = useState('40');
  const [formCostRate, setFormCostRate] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');

  // Queries
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => apiService.getSchedules(projectId),
    enabled: !!projectId,
  });
  const schedules: { id: string; name: string }[] = schedulesData?.schedules || [];

  const { data: workloadData, isLoading: workloadLoading } = useQuery({
    queryKey: ['workload', projectId],
    queryFn: () => apiService.getResourceWorkload(projectId),
    enabled: !!projectId && (activeSubTab === 'workload'),
  });
  const workload: WorkloadEntry[] = workloadData?.workload || [];

  const { data: histogramData, isLoading: histogramLoading } = useQuery({
    queryKey: ['histogram', selectedScheduleId],
    queryFn: () => apiService.getResourceHistogram(selectedScheduleId),
    enabled: !!selectedScheduleId && activeSubTab === 'histogram',
  });
  const histogram: HistogramData | null = histogramData?.histogram || null;

  const { data: forecastData, isLoading: forecastLoading } = useQuery({
    queryKey: ['forecast', projectId],
    queryFn: () => apiService.getResourceForecast(projectId, 8),
    enabled: !!projectId && activeSubTab === 'forecast',
  });
  const forecast: ForecastData | null = forecastData || null;

  const { data: resourcesData, isLoading: resourcesLoading } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
  });
  const resources: Resource[] = resourcesData?.resources || [];

  // Auto-select first schedule
  React.useEffect(() => {
    if (schedules.length > 0 && !selectedScheduleId) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  // Mutations
  const createResourceMutation = useMutation({
    mutationFn: (data: { name: string; role: string; email: string; capacityHoursPerWeek: number }) =>
      apiService.createResource(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['resources'] }); resetForm(); },
  });

  const updateResourceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; role: string; email: string; capacityHoursPerWeek: number } }) =>
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
  }

  function openEdit(r: Resource) {
    setEditingResource(r);
    setFormName(r.name);
    setFormRole(r.role);
    setIsCustomRole(!RESOURCE_ROLES.includes(r.role));
    setFormEmail(r.email);
    setFormCapacity(String(r.capacityHoursPerWeek || 40));
    setFormCostRate(r.costRateHourly != null ? String(r.costRateHourly) : '');
    setShowResourceForm(true);
  }

  function handleSaveResource() {
    const costRate = formCostRate.trim() ? parseFloat(formCostRate) : null;
    const data = { name: formName, role: formRole, email: formEmail, capacityHoursPerWeek: parseInt(formCapacity) || 40, costRateHourly: costRate };
    if (editingResource) {
      updateResourceMutation.mutate({ id: editingResource.id, data });
    } else {
      createResourceMutation.mutate(data);
    }
  }

  // Derived stats
  const stats = useMemo(() => {
    if (!workload.length) return { total: 0, overAllocated: 0, avgUtil: 0 };
    const overAllocated = workload.filter(w => w.isOverAllocated).length;
    const avgUtil = Math.round(workload.reduce((s, w) => s + w.averageUtilization, 0) / workload.length);
    return { total: workload.length, overAllocated, avgUtil };
  }, [workload]);

  const needsScheduleSelector = activeSubTab === 'histogram' || activeSubTab === 'leveling';

  return (
    <div className="mt-6 space-y-6">
      {/* Sub-tab navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-6">
          {subTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key)}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${activeSubTab === tab.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule selector for tabs that need it */}
      {needsScheduleSelector && schedules.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Schedule:</span>
          <select
            value={selectedScheduleId}
            onChange={(e) => setSelectedScheduleId(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            {schedules.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Team sub-tab ── */}
      {activeSubTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{resources.length} resources</p>
            <button
              onClick={() => { resetForm(); setShowResourceForm(true); }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Resource
            </button>
          </div>

          {showResourceForm && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-primary-200 dark:border-primary-700 p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{editingResource ? 'Edit Resource' : 'New Resource'}</h3>
                <button onClick={resetForm} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close resource form"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveResource}
                  disabled={!formName.trim() || !formRole.trim() || !formEmail.trim() || createResourceMutation.isPending || updateResourceMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {(createResourceMutation.isPending || updateResourceMutation.isPending) ? 'Saving…' : editingResource ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            {resourcesLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : resources.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No resources yet. Add your first team member.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Role</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Email</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Hours/Wk</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">$/hr</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {resources.map(r => (
                    <tr key={r.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.role}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.email}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{r.capacityHoursPerWeek || 40}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{r.costRateHourly != null ? `$${r.costRateHourly.toFixed(2)}` : '--'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Edit resource"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deleteResourceMutation.mutate(r.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Delete resource"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Workload Heatmap sub-tab ── */}
      {activeSubTab === 'workload' && (
        <>
          {/* Summary cards */}
          {workload.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            {workloadLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : workload.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p>No workload data available for this project.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700">
                      <th className="sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 min-w-[180px]">Resource</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 w-16">Avg</th>
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
                        {entry.weeks.map((w, i) => {
                          const pct = Math.round(w.utilization);
                          return (
                            <td key={i} className="px-1 py-3 text-center">
                              <div
                                className="mx-auto w-10 h-8 rounded flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ backgroundColor: utilColor(pct), opacity: pct === 0 ? 0.15 : 0.85 }}
                                title={`${w.allocated}h / ${w.capacity}h (${pct}%)`}
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
        </>
      )}

      {/* ── Histogram sub-tab ── */}
      {activeSubTab === 'histogram' && (
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
                              <rect
                                x={30 + i * (barW + 2)}
                                y={chartH - h}
                                width={barW}
                                height={h}
                                fill={isOver ? '#ef4444' : '#3b82f6'}
                                opacity={0.8}
                                rx={1}
                              />
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

      {/* ── Forecast sub-tab ── */}
      {activeSubTab === 'forecast' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          {forecastLoading ? (
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

      {/* ── Leveling sub-tab ── */}
      {activeSubTab === 'leveling' && (
        <div className="space-y-6">
          {selectedScheduleId && <ResourceLevelingPanel projectId={projectId} scheduleId={selectedScheduleId} />}
          <ResourceForecastPanel projectId={projectId} />
          <CapacityForecastSection projectId={projectId} />
        </div>
      )}
    </div>
  );
}

function CapacityForecastSection({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['resourceForecast', projectId],
    queryFn: () => apiService.getResourceForecast(projectId),
    enabled: !!projectId,
  });

  const forecast = data?.result;
  if (isLoading || !forecast?.capacityForecast?.length) return null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Capacity Forecast</h3>
      <CapacityChart data={forecast.capacityForecast} />
    </div>
  );
}

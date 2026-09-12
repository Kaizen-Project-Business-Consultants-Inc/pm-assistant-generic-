import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Zap, ToggleLeft, ToggleRight, Pencil, Trash2, Sparkles, ChevronDown, ChevronRight, X, Check, ShieldCheck, Store, Clock } from 'lucide-react';
import { apiService } from '../../services/api';
import { ConfirmModal } from '../ui/ConfirmModal';

interface AutomationListProps {
  projectId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200',
  active: 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
  disabled: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
  error: 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
};

function statusLabel(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatScheduleFrequency(auto: any): string | null {
  if (!auto.scheduleConfig) return null;
  const cfg = auto.scheduleConfig;
  switch (cfg.type) {
    case 'interval': return `Every ${cfg.intervalMinutes}m`;
    case 'daily': return `Daily at ${cfg.time}`;
    case 'weekly': {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `${days[cfg.dayOfWeek] ?? 'Mon'} at ${cfg.time}`;
    }
    case 'monthly': return `Day ${cfg.dayOfMonth} at ${cfg.time}`;
    case 'cron': return `Cron: ${cfg.expression}`;
    default: return null;
  }
}

function formatRelativeDate(d: string | null): string {
  if (!d) return '-';
  const date = new Date(d);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  if (absDiffMs < 60_000) return diffMs > 0 ? 'in <1m' : '<1m ago';
  if (absDiffMs < 3600_000) { const m = Math.round(absDiffMs / 60_000); return diffMs > 0 ? `in ${m}m` : `${m}m ago`; }
  if (absDiffMs < 86400_000) { const h = Math.round(absDiffMs / 3600_000); return diffMs > 0 ? `in ${h}h` : `${h}h ago`; }
  return date.toLocaleDateString();
}

export function AutomationList({ projectId, onSelect, onNew, onEdit }: AutomationListProps) {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [packsOpen, setPacksOpen] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['automations', projectId],
    queryFn: () => apiService.getAutomations(projectId),
    enabled: !!projectId,
  });

  const toggleMutation = useMutation({
    mutationFn: (auto: { id: string; status: string }) =>
      auto.status === 'active'
        ? apiService.disableAutomation(projectId, auto.id)
        : apiService.enableAutomation(projectId, auto.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations', projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteAutomation(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
      setDeleteId(null);
    },
  });

  const { data: suggestionsData } = useQuery({
    queryKey: ['automation-suggestions', projectId],
    queryFn: () => apiService.getAutomationSuggestions(projectId),
    enabled: !!projectId,
  });

  const applyMutation = useMutation({
    mutationFn: (suggestionId: string) => apiService.applyAutomationSuggestion(projectId, suggestionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
      queryClient.invalidateQueries({ queryKey: ['automation-suggestions', projectId] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (suggestionId: string) => apiService.dismissAutomationSuggestion(projectId, suggestionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-suggestions', projectId] });
    },
  });

  const { data: packsData } = useQuery({
    queryKey: ['governance-packs', projectId],
    queryFn: () => apiService.getGovernancePacks(projectId),
    enabled: !!projectId,
  });

  const applyPackMutation = useMutation({
    mutationFn: (packId: string) => apiService.applyGovernancePack(projectId, packId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
    },
  });

  const { data: marketplaceData } = useQuery({
    queryKey: ['marketplace-automations', projectId],
    queryFn: () => apiService.getMarketplaceAutomations(projectId),
    enabled: showMarketplace,
  });

  const importMutation = useMutation({
    mutationFn: (marketplaceId: string) => apiService.importFromMarketplace(projectId, marketplaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
    },
  });

  const suggestions: any[] = suggestionsData?.suggestions || [];
  const automations: any[] = data?.automations || [];
  const filtered = statusFilter === 'all' ? automations : automations.filter((a: any) => a.status === statusFilter);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary-600" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Automations</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">({automations.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMarketplace(!showMarketplace)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            <Store className="w-4 h-4" />
            Marketplace
          </button>
          <button
            onClick={onNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Automation
          </button>
        </div>
      </div>

      {/* Filter */}
      {automations.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Zap className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {automations.length === 0 ? 'No automations yet. Create one to automate project workflows.' : 'No automations match the current filter.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Name</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Trigger</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Runs</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((auto: any) => (
                <tr
                  key={auto.id}
                  className="hover:bg-primary-50/50 dark:hover:bg-primary-900/20 cursor-pointer transition-colors"
                  onClick={() => onSelect(auto.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white">{auto.name}</span>
                      {auto.scope === 'portfolio' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">Portfolio</span>
                      )}
                    </div>
                    {auto.description && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{auto.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-300">
                      {auto.triggerEventType}
                    </code>
                    {auto.scheduleConfig && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 text-blue-500" />
                        <span className="text-[10px] text-blue-600 dark:text-blue-400">{formatScheduleFrequency(auto)}</span>
                        {auto.nextRunAt && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500" title={`Next: ${new Date(auto.nextRunAt).toLocaleString()}`}>
                            (next: {formatRelativeDate(auto.nextRunAt)})
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[auto.status] || STATUS_COLORS.draft}`}>
                      {statusLabel(auto.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                    {auto.triggerCount || 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleMutation.mutate({ id: auto.id, status: auto.status })}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title={auto.status === 'active' ? 'Disable' : 'Enable'}
                      >
                        {auto.status === 'active' ? (
                          <ToggleRight className="w-4 h-4 text-green-600" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => onEdit(auto.id)}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => setDeleteId(auto.id)}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Suggested Automations */}
      {suggestions.length > 0 && (
        <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setSuggestionsOpen(!suggestionsOpen)}
            className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-medium text-purple-800 dark:text-purple-300">Suggested Automations</span>
              <span className="text-xs bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full">{suggestions.length}</span>
            </div>
            {suggestionsOpen ? <ChevronDown className="w-4 h-4 text-purple-500" /> : <ChevronRight className="w-4 h-4 text-purple-500" />}
          </button>
          {suggestionsOpen && (
            <div className="p-3 space-y-2 bg-white dark:bg-gray-800">
              {suggestions.map((s: any) => (
                <div key={s.id} className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${s.confidence >= 0.8 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : s.confidence >= 0.6 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {Math.round(s.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.description}</p>
                    <p className="text-xs text-purple-600 dark:text-purple-400 mt-1 italic">{s.why}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => applyMutation.mutate(s.id)}
                      disabled={applyMutation.isPending}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors disabled:opacity-50"
                      title="Apply as draft"
                    >
                      <Check className="w-3 h-3" />
                      Apply
                    </button>
                    <button
                      onClick={() => dismissMutation.mutate(s.id)}
                      disabled={dismissMutation.isPending}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Governance Packs */}
      {packsData?.packs?.length > 0 && (
        <div className="border border-emerald-200 dark:border-emerald-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setPacksOpen(!packsOpen)}
            className="w-full flex items-center justify-between px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Governance Packs</span>
              <span className="text-xs bg-emerald-200 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">{packsData.packs.length}</span>
            </div>
            {packsOpen ? <ChevronDown className="w-4 h-4 text-emerald-500" /> : <ChevronRight className="w-4 h-4 text-emerald-500" />}
          </button>
          {packsOpen && (
            <div className="p-3 space-y-2 bg-white dark:bg-gray-800">
              {packsData.packs.map((pack: any) => (
                <div key={pack.id} className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{pack.name}</div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{pack.description}</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{pack.automations.length} automations</p>
                  </div>
                  <button
                    onClick={() => applyPackMutation.mutate(pack.id)}
                    disabled={applyPackMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors disabled:opacity-50 shrink-0"
                  >
                    <Check className="w-3 h-3" />
                    Apply
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Marketplace */}
      {showMarketplace && (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/20">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-300">Automation Marketplace</span>
            </div>
            <button onClick={() => setShowMarketplace(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 space-y-2 bg-white dark:bg-gray-800">
            {!marketplaceData?.automations?.length ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No automations in the marketplace yet. Publish your automations to share them.</p>
            ) : (
              marketplaceData.automations.map((mp: any) => (
                <div key={mp.id} className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{mp.name}</span>
                      <code className="text-[10px] bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded">{mp.triggerEventType}</code>
                    </div>
                    {mp.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{mp.description}</p>}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                      <span>By {mp.publishedByOrgName}</span>
                      <span>{mp.downloadCount} imports</span>
                    </div>
                  </div>
                  <button
                    onClick={() => importMutation.mutate(mp.id)}
                    disabled={importMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 shrink-0"
                  >
                    Import
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmModal
          title="Delete Automation"
          message="Are you sure you want to delete this automation? This action cannot be undone."
          confirmLabel="Delete"
          variant="danger"
          isPending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

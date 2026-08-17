import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Bot, Activity, ShieldAlert, Search, Filter, X, ChevronUp, ChevronDown,
  ArrowUpDown, AlertTriangle,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { RiskFormModal } from '../../components/risks/RiskFormModal';
import { AIScanReviewModal } from '../../components/risks/AIScanReviewModal';
import { RAIDDetailPanel } from '../../components/risks/RAIDDetailPanel';

type RaidType = 'risk' | 'issue' | 'action' | 'decision';
type ViewMode = 'table' | 'board' | 'matrix';
type SortField = 'recordId' | 'title' | 'type' | 'severity' | 'status' | 'owner' | 'riskScore' | 'createdAt';
type SortDir = 'asc' | 'desc';

const VALID_STATUSES: Record<string, string[]> = {
  risk:     ['open', 'monitoring', 'mitigating', 'mitigated', 'closed'],
  issue:    ['open', 'in_progress', 'resolved', 'closed'],
  action:   ['open', 'in_progress', 'completed', 'closed', 'deferred'],
  decision: ['pending_decision', 'decided', 'deferred'],
};

const BOARD_COLUMNS = ['open', 'monitoring', 'mitigating', 'in_progress', 'mitigated', 'resolved', 'completed', 'decided', 'closed'];

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const MATRIX_LABELS = ['1', '2', '3', '4', '5'];
const MATRIX_COLORS: Record<number, string> = {
  1: 'bg-green-100 dark:bg-green-900/30', 2: 'bg-green-100 dark:bg-green-900/30',
  3: 'bg-yellow-100 dark:bg-yellow-900/30', 4: 'bg-yellow-100 dark:bg-yellow-900/30',
  5: 'bg-orange-100 dark:bg-orange-900/30', 6: 'bg-orange-100 dark:bg-orange-900/30',
  8: 'bg-orange-100 dark:bg-orange-900/30', 9: 'bg-orange-100 dark:bg-orange-900/30',
  10: 'bg-red-100 dark:bg-red-900/30', 12: 'bg-red-100 dark:bg-red-900/30',
  15: 'bg-red-100 dark:bg-red-900/30', 16: 'bg-red-200 dark:bg-red-900/50',
  20: 'bg-red-200 dark:bg-red-900/50', 25: 'bg-red-300 dark:bg-red-900/70',
};

export function RAIDTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editRisk, setEditRisk] = useState<any>(null);
  const [defaultType, setDefaultType] = useState<RaidType>('risk');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedRaidId, setSelectedRaidId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanCandidates, setScanCandidates] = useState<any[] | null>(null);
  const [showScanReview, setShowScanReview] = useState(false);
  const [scanAiPowered, setScanAiPowered] = useState(true);
  const [importing, setImporting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inlineStatusId, setInlineStatusId] = useState<string | null>(null);

  const filters: Record<string, string> = {};
  if (filterType) filters.type = filterType;
  if (filterStatus) filters.status = filterStatus;
  if (filterSeverity) filters.severity = filterSeverity;
  if (filterSource) filters.source = filterSource;
  if (searchText.trim()) filters.search = searchText.trim();

  const activeFilterCount = [filterType, filterStatus, filterSeverity, filterSource].filter(Boolean).length;

  const { data: risksData, isLoading } = useQuery({
    queryKey: ['project-risks', projectId, filters],
    queryFn: () => apiService.getRiskItems(projectId, filters),
    enabled: !!projectId,
  });

  const { data: statsData } = useQuery({
    queryKey: ['project-risks-stats', projectId],
    queryFn: () => apiService.getRiskStats(projectId),
    enabled: !!projectId,
  });

  const { data: membersData } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => apiService.getProjectMembers(projectId),
    enabled: !!projectId,
  });

  const risks: any[] = risksData?.data || [];
  const stats = statsData?.data || {};
  const members: any[] = membersData?.members || [];

  const invalidateRaid = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['project-risks', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project-risks-stats', projectId] });
  }, [queryClient, projectId]);

  const updateMutation = useMutation({
    mutationFn: ({ raidId, data }: { raidId: string; data: Record<string, any> }) =>
      apiService.updateRiskItem(projectId, raidId, data),
    onSuccess: invalidateRaid,
  });

  // Sorting
  const sortedRisks = useMemo(() => {
    const arr = [...risks];
    arr.sort((a, b) => {
      let va: any, vb: any;
      switch (sortField) {
        case 'recordId': va = a.recordId || ''; vb = b.recordId || ''; break;
        case 'title': va = a.title?.toLowerCase() || ''; vb = b.title?.toLowerCase() || ''; break;
        case 'type': va = a.type; vb = b.type; break;
        case 'severity': va = SEVERITY_ORDER[a.severity] ?? 4; vb = SEVERITY_ORDER[b.severity] ?? 4; break;
        case 'status': va = a.status; vb = b.status; break;
        case 'owner': va = memberName(a.ownerId)?.toLowerCase() || ''; vb = memberName(b.ownerId)?.toLowerCase() || ''; break;
        case 'riskScore': va = a.riskScore ?? 0; vb = b.riskScore ?? 0; break;
        case 'createdAt': va = a.createdAt || ''; vb = b.createdAt || ''; break;
        default: va = ''; vb = '';
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [risks, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Severity distribution
  const severityDist = useMemo(() => {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    risks.forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });
    return counts;
  }, [risks]);

  // Risk matrix data
  const matrixData = useMemo(() => {
    const grid: Record<string, any[]> = {};
    risks.filter(r => r.type === 'risk' && r.probability && r.impact).forEach(r => {
      const key = `${r.probability}-${r.impact}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(r);
    });
    return grid;
  }, [risks]);

  const handleAiScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await apiService.runAiRiskScan(projectId);
      setScanCandidates(result.data?.candidates || []);
      setScanAiPowered(result.aiPowered !== false);
      setShowScanReview(true);
    } catch (err: any) {
      const msg = err?.response?.status === 429
        ? 'AI budget exceeded for this month. Try again next billing cycle.'
        : err?.response?.data?.error || 'AI risk scan failed. Please try again.';
      setScanError(msg);
    }
    setScanning(false);
  };

  const handleImportSelected = async (items: Record<string, any>[]) => {
    setImporting(true);
    try {
      await apiService.batchImportRisks(projectId, items);
      invalidateRaid();
      setShowScanReview(false);
      setScanCandidates(null);
    } catch { /* */ }
    setImporting(false);
  };

  const openAdd = (type: RaidType) => { setEditRisk(null); setDefaultType(type); setShowForm(true); };
  const openEdit = (risk: any) => { setEditRisk(risk); setDefaultType(risk.type); setShowForm(true); };

  const clearFilters = () => { setFilterType(''); setFilterStatus(''); setFilterSeverity(''); setFilterSource(''); setSearchText(''); };

  // Bulk actions
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === sortedRisks.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(sortedRisks.map(r => r.id)));
  };
  const handleBulkStatus = async (status: string) => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map(id => apiService.updateRiskItem(projectId, id, { status })));
    invalidateRaid();
    setSelectedIds(new Set());
  };
  const handleBulkSeverity = async (severity: string) => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map(id => apiService.updateRiskItem(projectId, id, { severity })));
    invalidateRaid();
    setSelectedIds(new Set());
  };

  // Inline status change
  const handleInlineStatus = (raidId: string, newStatus: string) => {
    updateMutation.mutate({ raidId, data: { status: newStatus } });
    setInlineStatusId(null);
  };

  // Board drag
  const handleBoardDrop = (raidId: string, newStatus: string) => {
    updateMutation.mutate({ raidId, data: { status: newStatus } });
  };

  // Style helpers
  const severityColor = (s: string) => {
    if (s === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    if (s === 'high') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
    if (s === 'medium') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  };

  const statusColor = (s: string) => {
    if (s === 'open') return 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400';
    if (s === 'monitoring') return 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400';
    if (s === 'mitigating' || s === 'in_progress') return 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400';
    if (s === 'mitigated' || s === 'resolved' || s === 'completed' || s === 'decided') return 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400';
    if (s === 'pending_decision') return 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400';
    if (s === 'deferred') return 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400';
    if (s === 'cancelled' || s === 'reversed') return 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500';
    return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  };

  const typeIndicatorColor = (t: string) => {
    if (t === 'risk') return 'bg-red-500';
    if (t === 'issue') return 'bg-orange-500';
    if (t === 'action') return 'bg-blue-500';
    if (t === 'decision') return 'bg-purple-500';
    return 'bg-gray-500';
  };

  const typeBadgeColor = (t: string) => {
    if (t === 'risk') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    if (t === 'issue') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
    if (t === 'action') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
  };

  const scoreColor = (score: number) => {
    if (score >= 16) return 'text-red-600 dark:text-red-400';
    if (score >= 10) return 'text-orange-600 dark:text-orange-400';
    if (score >= 5) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  };

  const formatDate = (d: string | undefined) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  function memberName(userId: string | null) {
    if (!userId) return '';
    const m = members.find((m: any) => (m.userId || m.id) === userId);
    return m ? (m.userName || m.user?.name || m.name || m.email || '') : '';
  }

  const dueInfo = (risk: any) => {
    if (!risk.dueDate) return null;
    const now = new Date();
    const due = new Date(risk.dueDate);
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isResolved = ['completed', 'resolved', 'closed', 'cancelled', 'reversed', 'decided'].includes(risk.status);
    if (isResolved) return null;
    if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, color: 'text-red-600 dark:text-red-400', icon: true };
    if (diffDays <= 3) return { label: `${diffDays}d left`, color: 'text-amber-600 dark:text-amber-400', icon: true };
    return null;
  };

  const cardClass = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800';
  const selectClass = 'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary-500';

  const SortHeader = ({ field, children, className = '' }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={`flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-200 ${className}`}
    >
      {children}
      {sortField === field ? (
        sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />
      )}
    </button>
  );

  // Board view grouped by status
  const boardGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    BOARD_COLUMNS.forEach(s => { groups[s] = []; });
    sortedRisks.forEach(r => {
      if (groups[r.status]) groups[r.status].push(r);
      else {
        // Put unknown statuses in the closest column
        if (!groups['open']) groups['open'] = [];
        groups['open'].push(r);
      }
    });
    return groups;
  }, [sortedRisks]);

  const activeColumns = useMemo(() => BOARD_COLUMNS.filter(s => boardGroups[s]?.length > 0), [boardGroups]);

  return (
    <div className="space-y-4">
      {/* Stats row + severity distribution */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-wrap gap-3 flex-1">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20">
            <span className="text-xs text-gray-500 dark:text-gray-400">Open Risks</span>
            <span className="text-sm font-bold text-red-600 dark:text-red-400">{stats.openRisks ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20">
            <span className="text-xs text-gray-500 dark:text-gray-400">Open Issues</span>
            <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{stats.openIssues ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
            <span className="text-xs text-gray-500 dark:text-gray-400">Open Actions</span>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{stats.openActions ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/20">
            <span className="text-xs text-gray-500 dark:text-gray-400">Pending Decisions</span>
            <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{stats.pendingDecisions ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20">
            <span className="text-xs text-gray-500 dark:text-gray-400">Critical</span>
            <span className="text-sm font-bold text-red-700 dark:text-red-300">{stats.critical ?? 0}</span>
          </div>
          {(stats.triggered ?? 0) > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <span className="text-xs text-gray-500 dark:text-gray-400">Triggered</span>
              <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{stats.triggered}</span>
            </div>
          )}
        </div>

        {/* Severity distribution bar */}
        {risks.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Severity</span>
            <div className="flex h-5 w-32 rounded overflow-hidden">
              {severityDist.critical > 0 && <div className="bg-red-500" style={{ width: `${(severityDist.critical / risks.length) * 100}%` }} title={`Critical: ${severityDist.critical}`} />}
              {severityDist.high > 0 && <div className="bg-orange-500" style={{ width: `${(severityDist.high / risks.length) * 100}%` }} title={`High: ${severityDist.high}`} />}
              {severityDist.medium > 0 && <div className="bg-yellow-400" style={{ width: `${(severityDist.medium / risks.length) * 100}%` }} title={`Medium: ${severityDist.medium}`} />}
              {severityDist.low > 0 && <div className="bg-green-400" style={{ width: `${(severityDist.low / risks.length) * 100}%` }} title={`Low: ${severityDist.low}`} />}
            </div>
            <div className="flex gap-1.5 text-[9px] text-gray-500 dark:text-gray-400">
              {severityDist.critical > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-red-500" />{severityDist.critical}</span>}
              {severityDist.high > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-orange-500" />{severityDist.high}</span>}
              {severityDist.medium > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-yellow-400" />{severityDist.medium}</span>}
              {severityDist.low > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-green-400" />{severityDist.low}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Actions + Filters bar */}
      <div className={`${cardClass} p-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => openAdd('risk')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> Risk
          </button>
          <button onClick={() => openAdd('issue')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> Issue
          </button>
          <button onClick={() => openAdd('action')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> Action
          </button>
          <button onClick={() => openAdd('decision')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> Decision
          </button>
          <button
            onClick={handleAiScan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 rounded-lg transition-colors disabled:opacity-50"
          >
            {scanning ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
            {scanning ? 'Scanning...' : 'AI Scan'}
          </button>
          {scanError && (
            <span className="text-xs text-red-600 dark:text-red-400 max-w-xs truncate" title={scanError}>
              {scanError}
            </span>
          )}

          <div className="flex-1" />

          {/* View toggle */}
          <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
            {(['table', 'board', 'matrix'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-2.5 py-1 text-[10px] font-medium capitalize ${viewMode === v ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                {v === 'matrix' ? 'Risk Matrix' : v}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Search..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 w-40 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showFilters ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-primary-600 text-white text-[9px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Collapsible filter row */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selectClass}>
              <option value="">All Types</option>
              <option value="risk">Risks</option>
              <option value="issue">Issues</option>
              <option value="action">Actions</option>
              <option value="decision">Decisions</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={selectClass}>
              <option value="">All Statuses</option>
              <option value="open">Open</option>
              <option value="monitoring">Monitoring</option>
              <option value="mitigating">Mitigating</option>
              <option value="in_progress">In Progress</option>
              <option value="mitigated">Mitigated</option>
              <option value="resolved">Resolved</option>
              <option value="completed">Completed</option>
              <option value="pending_decision">Pending Decision</option>
              <option value="decided">Decided</option>
              <option value="deferred">Deferred</option>
              <option value="cancelled">Cancelled</option>
              <option value="reversed">Reversed</option>
              <option value="closed">Closed</option>
            </select>
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className={selectClass}>
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className={selectClass}>
              <option value="">All Sources</option>
              <option value="manual">Manual</option>
              <option value="ai_detected">AI Detected</option>
              <option value="agent">Agent</option>
            </select>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
            <span className="text-[10px] text-gray-400 ml-auto">{risks.length} items</span>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className={`${cardClass} p-2.5 flex items-center gap-3 sticky top-0 z-10`}>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{selectedIds.size} selected</span>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) handleBulkStatus(e.target.value); e.target.value = ''; }}
            className={selectClass}
          >
            <option value="" disabled>Set Status...</option>
            <option value="open">Open</option>
            <option value="monitoring">Monitoring</option>
            <option value="mitigating">Mitigating</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="completed">Completed</option>
            <option value="closed">Closed</option>
          </select>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) handleBulkSeverity(e.target.value); e.target.value = ''; }}
            className={selectClass}
          >
            <option value="" disabled>Set Severity...</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Main content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : risks.length === 0 ? (
        <div className={`${cardClass} p-8 text-center`}>
          <ShieldAlert className="mx-auto mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">No RAID Items</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Add a Risk, Issue, Action, or Decision — or run AI Scan.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* ===== TABLE VIEW ===== */
        <div className={`${cardClass} overflow-hidden`}>
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[32px_60px_1fr_80px_72px_100px_100px_60px_80px] gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-700/30 text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={selectedIds.size === sortedRisks.length && sortedRisks.length > 0}
              onChange={toggleSelectAll}
              className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600"
            />
            <SortHeader field="recordId">ID</SortHeader>
            <SortHeader field="title">Title</SortHeader>
            <SortHeader field="type">Type</SortHeader>
            <SortHeader field="severity">Severity</SortHeader>
            <SortHeader field="status">Status</SortHeader>
            <SortHeader field="owner">Owner</SortHeader>
            <SortHeader field="riskScore">Score</SortHeader>
            <SortHeader field="createdAt">Date</SortHeader>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {sortedRisks.map((risk: any) => {
              const isTerminal = ['cancelled', 'reversed'].includes(risk.status);
              const due = dueInfo(risk);
              const validStatuses = VALID_STATUSES[risk.type] || [];
              return (
                <div
                  key={risk.id}
                  className={`group grid grid-cols-1 md:grid-cols-[32px_60px_1fr_80px_72px_100px_100px_60px_80px] gap-2 px-4 py-2.5 items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors ${isTerminal ? 'opacity-50' : ''}`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedIds.has(risk.id)}
                    onChange={() => toggleSelect(risk.id)}
                    onClick={e => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600"
                  />

                  {/* Record ID */}
                  <span className="text-xs font-mono font-bold text-gray-600 dark:text-gray-400" onClick={() => setSelectedRaidId(risk.id)}>
                    {risk.recordId || '—'}
                  </span>

                  {/* Title + type indicator + due warning */}
                  <div className="flex items-center gap-2 min-w-0" onClick={() => setSelectedRaidId(risk.id)}>
                    <div className={`w-1.5 h-6 rounded-full flex-shrink-0 ${typeIndicatorColor(risk.type)}`} />
                    <p className={`text-sm font-medium text-gray-900 dark:text-white truncate ${isTerminal ? 'line-through' : ''}`}>
                      {risk.title}
                    </p>
                    {risk.triggered && <span className="text-amber-500 flex-shrink-0" title="Triggered">⚡</span>}
                    {due && (
                      <span className={`flex items-center gap-0.5 text-[10px] font-medium flex-shrink-0 ${due.color}`}>
                        {due.icon && <AlertTriangle className="w-3 h-3" />}
                        {due.label}
                      </span>
                    )}
                  </div>

                  {/* Type badge */}
                  <span onClick={() => setSelectedRaidId(risk.id)} className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize w-fit ${typeBadgeColor(risk.type)}`}>
                    {risk.type}
                  </span>

                  {/* Severity */}
                  <span onClick={() => setSelectedRaidId(risk.id)} className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize w-fit ${severityColor(risk.severity)}`}>
                    {risk.severity}
                  </span>

                  {/* Status — inline change */}
                  <div className="relative" onClick={e => e.stopPropagation()}>
                    {inlineStatusId === risk.id && !isTerminal ? (
                      <select
                        autoFocus
                        value={risk.status}
                        onChange={e => handleInlineStatus(risk.id, e.target.value)}
                        onBlur={() => setInlineStatusId(null)}
                        className="text-[10px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-1 py-0.5 w-full"
                      >
                        {validStatuses.map(s => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => !isTerminal && setInlineStatusId(risk.id)}
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize w-fit ${statusColor(risk.status)} ${!isTerminal ? 'cursor-pointer hover:ring-2 hover:ring-primary-300' : ''}`}
                      >
                        {risk.status.replace(/_/g, ' ')}
                      </button>
                    )}
                  </div>

                  {/* Owner */}
                  <span onClick={() => setSelectedRaidId(risk.id)} className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {memberName(risk.ownerId) || '—'}
                  </span>

                  {/* Score */}
                  <span onClick={() => setSelectedRaidId(risk.id)} className={`text-sm font-bold ${scoreColor(risk.riskScore)}`}>
                    {(risk.type === 'risk' || risk.type === 'issue') ? risk.riskScore : '—'}
                  </span>

                  {/* Date */}
                  <span onClick={() => setSelectedRaidId(risk.id)} className="text-[10px] text-gray-400 dark:text-gray-500">
                    {formatDate(risk.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700/50">
            {sortedRisks.map((risk: any) => {
              const isTerminal = ['cancelled', 'reversed'].includes(risk.status);
              const due = dueInfo(risk);
              return (
                <div
                  key={`m-${risk.id}`}
                  className={`p-4 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700/20 ${isTerminal ? 'opacity-50' : ''}`}
                  onClick={() => setSelectedRaidId(risk.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-1.5 h-5 rounded-full flex-shrink-0 ${typeIndicatorColor(risk.type)}`} />
                      <div className="min-w-0">
                        <p className={`text-sm font-medium text-gray-900 dark:text-white truncate ${isTerminal ? 'line-through' : ''}`}>{risk.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-mono text-gray-400">{risk.recordId}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${severityColor(risk.severity)}`}>{risk.severity}</span>
                          {due && <span className={`text-[10px] font-medium ${due.color}`}>{due.label}</span>}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${statusColor(risk.status)}`}>
                      {risk.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === 'board' ? (
        /* ===== BOARD VIEW ===== */
        <div className="flex gap-3 overflow-x-auto pb-2">
          {activeColumns.map(status => (
            <div
              key={status}
              className={`${cardClass} flex-shrink-0 w-64 flex flex-col`}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-primary-400'); }}
              onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-primary-400'); }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.classList.remove('ring-2', 'ring-primary-400');
                const raidId = e.dataTransfer.getData('text/plain');
                if (raidId) handleBoardDrop(raidId, status);
              }}
            >
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColor(status)}`}>
                  {status.replace(/_/g, ' ')}
                </span>
                <span className="text-[10px] text-gray-400">{boardGroups[status].length}</span>
              </div>
              <div className="p-2 space-y-2 flex-1 min-h-[60px]">
                {boardGroups[status].map((risk: any) => {
                  const due = dueInfo(risk);
                  return (
                    <div
                      key={risk.id}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('text/plain', risk.id)}
                      onClick={() => setSelectedRaidId(risk.id)}
                      className="p-2.5 rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-sm cursor-pointer transition-shadow"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-1.5 h-4 rounded-full ${typeIndicatorColor(risk.type)}`} />
                        <span className="text-[10px] font-mono text-gray-400">{risk.recordId}</span>
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full capitalize ml-auto ${severityColor(risk.severity)}`}>{risk.severity}</span>
                      </div>
                      <p className="text-xs font-medium text-gray-900 dark:text-white line-clamp-2">{risk.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        {memberName(risk.ownerId) && (
                          <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{memberName(risk.ownerId)}</span>
                        )}
                        {due && <span className={`text-[9px] font-medium ml-auto ${due.color}`}>{due.label}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ===== RISK MATRIX VIEW ===== */
        <div className={`${cardClass} p-4`}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Risk Matrix (Probability x Impact)</h3>
          <div className="overflow-x-auto">
            <table className="w-full max-w-lg mx-auto">
              <thead>
                <tr>
                  <th className="w-12" />
                  {MATRIX_LABELS.map(i => (
                    <th key={i} className="text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 py-1 w-16">Impact {i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...MATRIX_LABELS].reverse().map(p => (
                  <tr key={p}>
                    <td className="text-[10px] font-medium text-gray-500 dark:text-gray-400 pr-2 text-right">P{p}</td>
                    {MATRIX_LABELS.map(i => {
                      const key = `${p}-${i}`;
                      const items = matrixData[key] || [];
                      const score = parseInt(p) * parseInt(i);
                      const bg = MATRIX_COLORS[score] || 'bg-green-50 dark:bg-green-900/20';
                      return (
                        <td key={i} className="p-0.5">
                          <div
                            className={`${bg} rounded h-14 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary-300 transition-all`}
                            onClick={() => {
                              if (items.length === 1) setSelectedRaidId(items[0].id);
                              else if (items.length > 1) setSelectedRaidId(items[0].id);
                            }}
                            title={items.length > 0 ? items.map((r: any) => r.title).join(', ') : `P${p} x I${i} = ${score}`}
                          >
                            {items.length > 0 ? (
                              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{items.length}</span>
                            ) : (
                              <span className="text-[9px] text-gray-300 dark:text-gray-600">{score}</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 text-center mt-2">Click a cell to view its risks. Only items of type "Risk" with probability and impact values appear here.</p>
        </div>
      )}

      {/* Slide-out detail panel */}
      {selectedRaidId && (
        <RAIDDetailPanel
          projectId={projectId}
          raidId={selectedRaidId}
          onClose={() => setSelectedRaidId(null)}
          onEdit={(item) => { openEdit(item); }}
          members={members}
        />
      )}

      {/* Form modal */}
      <RiskFormModal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSaved={() => { invalidateRaid(); if (selectedRaidId) { queryClient.invalidateQueries({ queryKey: ['raid-item', selectedRaidId] }); } }}
        projectId={projectId}
        editRisk={editRisk}
        defaultType={defaultType}
        members={members}
      />

      {/* AI Scan Review modal */}
      <AIScanReviewModal
        isOpen={showScanReview}
        onClose={() => { setShowScanReview(false); setScanCandidates(null); }}
        onImport={handleImportSelected}
        candidates={scanCandidates || []}
        importing={importing}
        aiPowered={scanAiPowered}
      />
    </div>
  );
}

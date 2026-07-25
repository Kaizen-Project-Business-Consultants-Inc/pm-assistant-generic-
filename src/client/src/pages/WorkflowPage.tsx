import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Workflow, Plus, Trash2, ToggleLeft, ToggleRight, Zap, Clock, ChevronDown, ChevronRight, ArrowRight, Eye, Sparkles, Loader2, Lock } from 'lucide-react';
import { apiService } from '../services/api';
import { WorkflowNodeEditor } from '../components/workflows/WorkflowNodeEditor';
import { ExecutionDetail } from '../components/workflows/ExecutionDetail';

// ── Types ──────────────────────────────────────────────────────────────────

type NodeType = 'trigger' | 'condition' | 'action' | 'approval' | 'delay';

interface NodeDraft {
  nodeType: NodeType;
  name: string;
  config: Record<string, any>;
}

interface EdgeDraft {
  sourceIndex: number;
  targetIndex: number;
  label?: string;
  conditionExpr?: Record<string, any>;
}

interface WorkflowDef {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  nodes?: any[];
  edges?: any[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const defaultNodes: NodeDraft[] = [
  { nodeType: 'trigger', name: 'Trigger', config: { triggerType: 'status_change' } },
  { nodeType: 'action', name: 'Action', config: { actionType: 'log_activity', message: '' } },
];

const defaultEdges: EdgeDraft[] = [
  { sourceIndex: 0, targetIndex: 1 },
];

const nodeTypeColors: Record<string, string> = {
  trigger: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
  condition: 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20',
  action: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20',
  approval: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20',
  delay: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20',
};

const nodeTypeLabel: Record<string, string> = {
  trigger: 'Trigger',
  condition: 'Condition',
  action: 'Action',
  approval: 'Approval Gate',
  delay: 'Delay',
};

// ── Component ──────────────────────────────────────────────────────────────

export function WorkflowPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'definitions' | 'executions'>('definitions');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewExecId, setViewExecId] = useState<string | null>(null);

  // AI generation state
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlError, setNlError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nodes, setNodes] = useState<NodeDraft[]>([...defaultNodes]);
  const [edges, setEdges] = useState<EdgeDraft[]>([...defaultEdges]);

  // Queries
  const { data: defsData, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => apiService.getWorkflows(),
  });

  const { data: execsData } = useQuery({
    queryKey: ['workflowExecutions'],
    queryFn: () => apiService.getWorkflowExecutions(),
  });

  const { data: execDetail } = useQuery({
    queryKey: ['workflowExecution', viewExecId],
    queryFn: () => apiService.getWorkflowExecution(viewExecId!),
    enabled: !!viewExecId,
  });

  const definitions: WorkflowDef[] = defsData?.definitions || [];
  const executions = execsData?.executions || [];
  const isSample: boolean = defsData?.sample || false;

  // Mutations
  const createMut = useMutation({
    mutationFn: (data: any) => apiService.createWorkflow(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workflows'] }); resetForm(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiService.updateWorkflow(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workflows'] }); resetForm(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiService.deleteWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => apiService.toggleWorkflow(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const resumeMut = useMutation({
    mutationFn: ({ execId, nodeId }: { execId: string; nodeId: string }) =>
      apiService.resumeWorkflowExecution(execId, nodeId, { approved: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowExecutions'] });
      queryClient.invalidateQueries({ queryKey: ['workflowExecution', viewExecId] });
    },
  });

  const generateMut = useMutation({
    mutationFn: (desc: string) => apiService.generateWorkflow(desc),
    onSuccess: (data) => {
      const wf = data.workflow;
      setName(wf.name || '');
      setDescription(wf.description || '');
      setNodes(wf.nodes || [...defaultNodes]);
      setEdges(wf.edges || [...defaultEdges]);
      setShowForm(true);
      setNlPrompt('');
      setNlError(null);
    },
    onError: (err: any) => {
      setNlError(err?.response?.data?.error || 'Failed to generate workflow. Please try again.');
    },
  });

  // Form helpers
  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setName('');
    setDescription('');
    setNodes([...defaultNodes]);
    setEdges([...defaultEdges]);
  };

  const openEdit = async (def: WorkflowDef) => {
    const full = await apiService.getWorkflow(def.id);
    const d = full.definition;
    setEditingId(d.id);
    setName(d.name);
    setDescription(d.description || '');
    // Map server nodes/edges to drafts
    const nodeList: NodeDraft[] = (d.nodes || []).map((n: any) => ({
      nodeType: n.nodeType,
      name: n.name,
      config: n.config,
    }));
    setNodes(nodeList.length > 0 ? nodeList : [...defaultNodes]);
    // Build edges from server data using node index mapping
    const nodeIdToIdx = new Map<string, number>();
    (d.nodes || []).forEach((n: any, i: number) => nodeIdToIdx.set(n.id, i));
    const edgeList: EdgeDraft[] = (d.edges || []).map((e: any) => ({
      sourceIndex: nodeIdToIdx.get(e.sourceNodeId) ?? 0,
      targetIndex: nodeIdToIdx.get(e.targetNodeId) ?? 1,
      label: e.label || undefined,
      conditionExpr: e.conditionExpr || undefined,
    }));
    setEdges(edgeList.length > 0 ? edgeList : [...defaultEdges]);
    setShowForm(true);
  };

  const handleSave = () => {
    const payload = { name, description, nodes, edges };
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const addNode = (type: NodeType) => {
    const newNode: NodeDraft = {
      nodeType: type,
      name: nodeTypeLabel[type] || type,
      config: type === 'trigger' ? { triggerType: 'status_change' }
        : type === 'action' ? { actionType: 'log_activity' }
        : type === 'condition' ? { field: '', operator: 'equals', value: '' }
        : {},
    };
    const newIdx = nodes.length;
    setNodes([...nodes, newNode]);
    // Auto-connect from last node
    if (newIdx > 0) {
      setEdges([...edges, { sourceIndex: newIdx - 1, targetIndex: newIdx }]);
    }
  };

  const removeNode = (idx: number) => {
    if (nodes.length <= 1) return;
    setNodes(nodes.filter((_, i) => i !== idx));
    setEdges(edges
      .filter(e => e.sourceIndex !== idx && e.targetIndex !== idx)
      .map(e => ({
        ...e,
        sourceIndex: e.sourceIndex > idx ? e.sourceIndex - 1 : e.sourceIndex,
        targetIndex: e.targetIndex > idx ? e.targetIndex - 1 : e.targetIndex,
      })),
    );
  };

  const updateNode = (idx: number, updates: Partial<NodeDraft>) => {
    setNodes(nodes.map((n, i) => i === idx ? { ...n, ...updates } : n));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/40">
            <Workflow className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Workflow Automation</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">DAG-based workflow engine with conditions, approvals, and execution history</p>
          </div>
        </div>
        {!isSample && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Workflow
          </button>
        )}
      </div>

      {isSample && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Workflow Definitions</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                These are sample workflows with demo data. Upgrade to a paid plan to create automated workflows with triggers, conditions, approvals, and AI generation.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* AI Generate */}
      {!isSample && (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Generate with AI</h3>
        </div>
        <div className="flex gap-2">
          <textarea
            value={nlPrompt}
            onChange={e => { setNlPrompt(e.target.value); setNlError(null); }}
            placeholder="Describe your workflow in plain English, e.g. &quot;When a task is marked complete, notify the project manager and log the activity&quot;"
            rows={2}
            maxLength={500}
            className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={() => generateMut.mutate(nlPrompt)}
            disabled={nlPrompt.trim().length < 10 || generateMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 self-end"
          >
            {generateMut.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {generateMut.isPending ? 'Generating...' : 'Generate'}
          </button>
        </div>
        {nlError && (
          <p className="text-xs text-red-500 mt-1.5">{nlError}</p>
        )}
      </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setTab('definitions')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${tab === 'definitions' ? 'border-primary-600 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200'}`}
        >
          Definitions ({definitions.length})
        </button>
        <button
          onClick={() => setTab('executions')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${tab === 'executions' ? 'border-primary-600 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200'}`}
        >
          Executions ({executions.length})
        </button>
      </div>

      {/* Builder Form */}
      {showForm && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{editingId ? 'Edit Workflow' : 'Create Workflow'}</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="e.g., Auto-complete on 100%" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">Description</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Optional description" />
            </div>
          </div>

          {/* Nodes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">Nodes ({nodes.length})</h4>
              <div className="flex gap-1">
                {(['condition', 'action', 'approval', 'delay'] as NodeType[]).map(t => (
                  <button key={t} onClick={() => addNode(t)}
                    className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 rounded transition-colors">
                    + {nodeTypeLabel[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {nodes.map((node, idx) => (
                <div key={idx}>
                  {idx > 0 && (
                    <div className="flex justify-center py-1">
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 rotate-90" />
                    </div>
                  )}
                  <div className={`p-3 rounded-lg border ${nodeTypeColors[node.nodeType] || 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-white dark:bg-gray-800/60 font-medium uppercase tracking-wide text-gray-600 dark:text-gray-300">
                          {nodeTypeLabel[node.nodeType]}
                        </span>
                        <input type="text" value={node.name} onChange={e => updateNode(idx, { name: e.target.value })}
                          className="text-xs font-medium text-gray-800 dark:text-gray-100 bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:border-gray-600 focus:border-primary-500 focus:outline-none px-1 py-0.5" />
                      </div>
                      {idx > 0 && (
                        <button onClick={() => removeNode(idx)} className="p-0.5 text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <WorkflowNodeEditor
                      nodeType={node.nodeType}
                      config={node.config}
                      onChange={config => updateNode(idx, { config })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save/Cancel */}
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={handleSave}
              disabled={!name.trim() || nodes.length === 0 || createMut.isPending || updateMut.isPending}
              className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50">
              {editingId ? 'Update Workflow' : 'Create Workflow'}
            </button>
          </div>
        </div>
      )}

      {/* Definitions List */}
      {tab === 'definitions' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Workflows ({definitions.length})</h3>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : definitions.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">No workflows defined yet.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {definitions.map((def) => (
                <div key={def.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleMut.mutate({ id: def.id, enabled: !def.isEnabled })}
                        title={def.isEnabled ? 'Disable' : 'Enable'}
                      >
                        {def.isEnabled ? (
                          <ToggleRight className="w-5 h-5 text-green-500" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-gray-300" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${def.isEnabled ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                            {def.name}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">v{def.version}</span>
                          {!def.isEnabled && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">Disabled</span>
                          )}
                        </div>
                        {def.description && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{def.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(def)}
                        className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded transition-colors">
                        Edit
                      </button>
                      <button onClick={() => deleteMut.mutate(def.id)}
                        className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Executions Tab */}
      {tab === 'executions' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Execution History</h3>
              </div>
            </div>
            {executions.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-400 dark:text-gray-500">No workflow executions yet.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {executions.map((exec: any) => (
                  <div key={exec.id} className="px-4 py-2 text-xs flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    onClick={() => setViewExecId(viewExecId === exec.id ? null : exec.id)}>
                    <div className="flex-shrink-0">
                      {viewExecId === exec.id ? <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-500" />}
                    </div>
                    <Zap className="w-3 h-3 text-yellow-500 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="font-medium text-gray-700 dark:text-gray-200">{exec.workflowId}</span>
                      <span className="text-gray-400 dark:text-gray-500"> — {exec.entityType}:{exec.entityId}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-xs capitalize ${
                      exec.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                      exec.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                      exec.status === 'waiting' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                      exec.status === 'running' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                      'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      {exec.status}
                    </span>
                    <span className="text-gray-300 flex-shrink-0">{new Date(exec.startedAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Execution detail */}
          {viewExecId && execDetail?.execution && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Execution Detail</h4>
                <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{viewExecId}</span>
              </div>
              <ExecutionDetail
                execution={execDetail.execution}
                onResume={(nodeId) => resumeMut.mutate({ execId: viewExecId, nodeId })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Square,
  Plus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { apiService } from '../../services/api';

interface ActionItem {
  id: string;
  meetingId: string;
  projectId: string;
  description: string;
  assigneeName: string | null;
  assigneeUserId: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  completedAt: string | null;
  source: string;
  notes: string | null;
  meetingTitle?: string;
  projectName?: string;
}

interface MeetingActionItemListProps {
  projectId?: string;
  meetingId?: string;
  showCreateButton?: boolean;
  showMeetingColumn?: boolean;
  showProjectColumn?: boolean;
}

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

export const MeetingActionItemList: React.FC<MeetingActionItemListProps> = ({
  projectId,
  meetingId,
  showCreateButton = false,
  showMeetingColumn = false,
  showProjectColumn = false,
}) => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newPriority, setNewPriority] = useState('medium');

  const queryKey = ['meetingActionItems', projectId, meetingId, statusFilter, overdueOnly];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      if (meetingId) {
        return apiService.getMeetingActionItems({ meetingId, status: statusFilter || undefined });
      }
      return apiService.getMeetingActionItems({
        projectId,
        status: statusFilter || undefined,
        overdue: overdueOnly,
      });
    },
    enabled: !!(projectId || meetingId),
  });

  const items: ActionItem[] = data?.items || [];

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiService.completeActionItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meetingActionItems'] }),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => apiService.reopenActionItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meetingActionItems'] }),
  });

  const createMutation = useMutation({
    mutationFn: () => apiService.createActionItem({
      meetingId: meetingId!,
      description: newDescription.trim(),
      assigneeName: newAssignee.trim() || undefined,
      dueDate: newDueDate || undefined,
      priority: newPriority,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetingActionItems'] });
      setCreating(false);
      setNewDescription('');
      setNewAssignee('');
      setNewDueDate('');
      setNewPriority('medium');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiService.updateActionItem(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meetingActionItems'] }),
  });

  const isOverdue = (item: ActionItem) =>
    item.dueDate && new Date(item.dueDate) < new Date() && !['completed', 'cancelled'].includes(item.status);

  const toggleComplete = (item: ActionItem) => {
    if (item.status === 'completed') {
      reopenMutation.mutate(item.id);
    } else {
      completeMutation.mutate(item.id);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
          <CheckSquare className="w-3.5 h-3.5" /> Action Items
          {items.length > 0 && <span className="text-gray-400">({items.length})</span>}
        </h3>
        <div className="flex items-center gap-2">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="input text-xs py-1 px-2"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {!meetingId && (
            <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={e => setOverdueOnly(e.target.checked)}
                className="rounded border-gray-300"
              />
              Overdue
            </label>
          )}
          {showCreateButton && meetingId && (
            <button
              onClick={() => setCreating(true)}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="mb-3 p-3 rounded-lg border border-primary-200 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10 space-y-2">
          <input
            type="text"
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
            className="input w-full text-sm"
            placeholder="Action item description..."
            autoFocus
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={newAssignee}
              onChange={e => setNewAssignee(e.target.value)}
              className="input text-xs"
              placeholder="Assignee"
            />
            <input
              type="date"
              value={newDueDate}
              onChange={e => setNewDueDate(e.target.value)}
              className="input text-xs"
            />
            <select value={newPriority} onChange={e => setNewPriority(e.target.value)} className="input text-xs">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="btn btn-secondary text-xs px-2 py-1">Cancel</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newDescription.trim() || createMutation.isPending}
              className="btn btn-primary text-xs px-2 py-1 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-xs text-gray-400 py-4 text-center">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center italic">
          No action items{statusFilter ? ` with status "${statusFilter}"` : ''}.
        </div>
      ) : (
        <div className="space-y-1">
          {items.map(item => (
            <div key={item.id}>
              <div
                className={`flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  item.status === 'completed' ? 'opacity-60' : ''
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleComplete(item)}
                  className="mt-0.5 flex-shrink-0"
                  title={item.status === 'completed' ? 'Reopen' : 'Complete'}
                >
                  {item.status === 'completed' ? (
                    <CheckSquare className="w-4 h-4 text-green-500" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-400 hover:text-primary-500" />
                  )}
                </button>

                {/* Content */}
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm ${item.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                      {item.description}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${PRIORITY_STYLES[item.priority] || ''}`}>
                      {item.priority}
                    </span>
                    {item.status !== 'open' && item.status !== 'completed' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_STYLES[item.status] || ''}`}>
                        {item.status.replace('_', ' ')}
                      </span>
                    )}
                    {item.source === 'ai_extracted' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300">
                        AI
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                    {item.assigneeName && <span>{item.assigneeName}</span>}
                    {item.dueDate && (
                      <span className={isOverdue(item) ? 'text-red-500 font-medium flex items-center gap-0.5' : ''}>
                        {isOverdue(item) && <AlertTriangle className="w-3 h-3" />}
                        Due {item.dueDate}
                      </span>
                    )}
                    {showMeetingColumn && item.meetingTitle && (
                      <span className="truncate max-w-[150px]">{item.meetingTitle}</span>
                    )}
                    {showProjectColumn && item.projectName && (
                      <span className="truncate max-w-[150px]">{item.projectName}</span>
                    )}
                  </div>
                </div>

                {/* Expand arrow */}
                <button
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  className="p-0.5 mt-0.5"
                >
                  {expandedId === item.id ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  )}
                </button>
              </div>

              {/* Expanded edit */}
              {expandedId === item.id && (
                <div className="ml-8 mt-1 mb-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-2">
                  <InlineEdit item={item} onSave={(data) => updateMutation.mutate({ id: item.id, data })} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Inline editor for expanded action item
const InlineEdit: React.FC<{
  item: ActionItem;
  onSave: (data: Record<string, any>) => void;
}> = ({ item, onSave }) => {
  const [description, setDescription] = useState(item.description);
  const [assigneeName, setAssigneeName] = useState(item.assigneeName || '');
  const [dueDate, setDueDate] = useState(item.dueDate || '');
  const [priority, setPriority] = useState(item.priority);
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.notes || '');
  const [dirty, setDirty] = useState(false);

  const handleChange = (setter: Function) => (val: any) => {
    setter(val);
    setDirty(true);
  };

  const handleSave = () => {
    onSave({ description, assigneeName, dueDate, priority, status, notes });
    setDirty(false);
  };

  return (
    <>
      <textarea
        value={description}
        onChange={e => handleChange(setDescription)(e.target.value)}
        className="input w-full text-sm resize-y"
        rows={2}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input
          type="text"
          value={assigneeName}
          onChange={e => handleChange(setAssigneeName)(e.target.value)}
          className="input text-xs"
          placeholder="Assignee"
        />
        <input
          type="date"
          value={dueDate}
          onChange={e => handleChange(setDueDate)(e.target.value)}
          className="input text-xs"
        />
        <select value={priority} onChange={e => handleChange(setPriority)(e.target.value)} className="input text-xs">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <select value={status} onChange={e => handleChange(setStatus)(e.target.value)} className="input text-xs">
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <textarea
        value={notes}
        onChange={e => handleChange(setNotes)(e.target.value)}
        className="input w-full text-xs resize-y"
        rows={2}
        placeholder="Notes..."
      />
      {dirty && (
        <div className="flex justify-end">
          <button onClick={handleSave} className="btn btn-primary text-xs px-3 py-1">
            Save Changes
          </button>
        </div>
      )}
    </>
  );
};

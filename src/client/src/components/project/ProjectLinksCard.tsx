import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { apiService } from '../../services/api';

interface ProjectLink {
  id: string;
  label: string;
  url: string;
  icon: string | null;
  sortOrder: number;
}

interface Props {
  projectId: string;
  canEdit?: boolean;
}

const ICON_OPTIONS = [
  { value: '', label: 'Link' },
  { value: 'sharepoint', label: 'SharePoint' },
  { value: 'jira', label: 'Jira' },
  { value: 'confluence', label: 'Confluence' },
  { value: 'figma', label: 'Figma' },
  { value: 'github', label: 'GitHub' },
  { value: 'drive', label: 'Google Drive' },
  { value: 'slack', label: 'Slack' },
  { value: 'teams', label: 'Teams' },
  { value: 'notion', label: 'Notion' },
  { value: 'miro', label: 'Miro' },
  { value: 'docs', label: 'Docs' },
];

function getLinkIcon(icon: string | null): string {
  const map: Record<string, string> = {
    sharepoint: 'SP',
    jira: 'JR',
    confluence: 'CF',
    figma: 'FG',
    github: 'GH',
    drive: 'GD',
    slack: 'SL',
    teams: 'TM',
    notion: 'NT',
    miro: 'MR',
    docs: 'DC',
  };
  return icon ? map[icon] || 'LK' : 'LK';
}

function getLinkColor(icon: string | null): string {
  const map: Record<string, string> = {
    sharepoint: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    jira: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    confluence: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    figma: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    github: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    drive: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    slack: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    teams: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    notion: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    miro: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    docs: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  return icon ? map[icon] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
}

export function ProjectLinksCard({ projectId, canEdit }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['project-links', projectId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiService.getProjectLinks(projectId),
    enabled: !!projectId,
  });
  const links: ProjectLink[] = data?.links || [];

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', url: '', icon: '' });

  const createMutation = useMutation({
    mutationFn: (data: { label: string; url: string; icon?: string }) =>
      apiService.createProjectLink(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setAdding(false);
      setForm({ label: '', url: '', icon: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ linkId, data }: { linkId: string; data: { label?: string; url?: string; icon?: string | null } }) =>
      apiService.updateProjectLink(projectId, linkId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (linkId: string) => apiService.deleteProjectLink(projectId, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const handleSubmit = () => {
    if (!form.label.trim() || !form.url.trim()) return;
    if (editingId) {
      updateMutation.mutate({ linkId: editingId, data: { label: form.label, url: form.url, icon: form.icon || null } });
    } else {
      createMutation.mutate({ label: form.label, url: form.url, icon: form.icon || undefined });
    }
  };

  const startEdit = (link: ProjectLink) => {
    setEditingId(link.id);
    setForm({ label: link.label, url: link.url, icon: link.icon || '' });
    setAdding(true);
  };

  const cancelForm = () => {
    setAdding(false);
    setEditingId(null);
    setForm({ label: '', url: '', icon: '' });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {links.length === 0 && !adding && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {canEdit ? 'Pin important links — SharePoint, Jira, Figma, shared drives, etc.' : 'No pinned links yet.'}
        </p>
      )}

      {links.map(link => (
        <div
          key={link.id}
          className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <span className={`flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold ${getLinkColor(link.icon)}`}>
            {getLinkIcon(link.icon)}
          </span>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 truncate"
            title={link.url}
          >
            {link.label}
          </a>
          <ExternalLink className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          {canEdit && (
            <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => startEdit(link)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => deleteMutation.mutate(link.id)}
                className="p-1 text-gray-400 hover:text-red-500"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {adding && (
        <div className="space-y-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
          <input
            type="text"
            placeholder="Label (e.g., SharePoint Folder)"
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') cancelForm();
            }}
          />
          <input
            type="url"
            placeholder="URL (e.g., https://...)"
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') cancelForm();
            }}
          />
          <div className="flex items-center gap-2">
            <select
              value={form.icon}
              onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {ICON_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={handleSubmit}
              disabled={!form.label.trim() || !form.url.trim()}
              className="p-1.5 text-green-600 hover:text-green-700 disabled:text-gray-300 disabled:cursor-not-allowed"
              title="Save"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={cancelForm}
              className="p-1.5 text-gray-400 hover:text-gray-600"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {canEdit && !adding && (
        <button
          onClick={() => { setAdding(true); setEditingId(null); setForm({ label: '', url: '', icon: '' }); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors mt-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Add link
        </button>
      )}
    </div>
  );
}

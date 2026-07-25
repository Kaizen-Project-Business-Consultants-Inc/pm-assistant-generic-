import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, FolderKanban, CheckSquare, ArrowRight, Plus, BarChart3, FileText,
  AlertTriangle, Target, Users, BookOpen, GitPullRequest, Zap, MessageSquare,
  Gauge, Briefcase, Layers, Clock, Bell, TrendingUp, Dices, FlaskConical,
  Workflow, FileBarChart, ClipboardList, Plug, Bot, Settings, HelpCircle,
  UserCog, CreditCard,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { useModal } from '../../hooks/useModal';

// --- Types ---

interface SearchResult {
  type: 'project' | 'task' | 'goal' | 'lesson' | 'resource' | 'change_request' | 'risk' | 'sprint' | 'comment';
  id: string;
  name: string;
  description?: string;
  status?: string;
  projectId?: string;
  projectName?: string;
  priority?: string;
  severity?: string;
  recordId?: string;
  assignedTo?: string;
  progress?: number;
  raidType?: string;
  taskId?: string;
}

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  section: 'recent' | 'action' | 'navigate';
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

// --- Constants ---

const RECENTS_KEY = 'pm-command-recents';
const MAX_RECENTS = 5;

const actionCommands: CommandItem[] = [
  { id: 'new-project', label: 'New Project', description: 'Create a new project', icon: Plus, path: '/projects', section: 'action' },
  { id: 'log-time', label: 'Log Time', description: 'Open timesheet', icon: Clock, path: '/timesheet', section: 'action' },
  { id: 'ask-ai', label: 'Ask AI', description: 'Natural language query', icon: Search, path: '/query', section: 'action' },
  { id: 'report-builder', label: 'Build Report', description: 'Create a custom report', icon: FileBarChart, path: '/report-builder', section: 'action' },
];

const navigateCommands: CommandItem[] = [
  { id: 'go-dashboard', label: 'Go to Dashboard', icon: Gauge, path: '/dashboard', section: 'navigate' },
  { id: 'go-projects', label: 'Go to Projects', icon: Briefcase, path: '/projects', section: 'navigate' },
  { id: 'go-portfolio', label: 'Go to Portfolio', icon: Layers, path: '/portfolio', section: 'navigate' },
  { id: 'go-resources', label: 'Go to Resources', icon: UserCog, path: '/resources', section: 'navigate' },
  { id: 'go-meetings', label: 'Go to Meetings', icon: MessageSquare, path: '/meetings', section: 'navigate' },
  { id: 'go-lessons', label: 'Go to Lessons Learned', icon: BookOpen, path: '/lessons', section: 'navigate' },
  { id: 'go-change-requests', label: 'Go to Change Requests', icon: GitPullRequest, path: '/change-requests', section: 'navigate' },
  { id: 'go-workflows', label: 'Go to Workflows', icon: Workflow, path: '/workflows', section: 'navigate' },
  { id: 'go-intake', label: 'Go to Intake Forms', icon: ClipboardList, path: '/intake', section: 'navigate' },
  { id: 'go-integrations', label: 'Go to Integrations', icon: Plug, path: '/integrations', section: 'navigate' },
  { id: 'go-analytics', label: 'Go to Analytics', icon: BarChart3, path: '/analytics', section: 'navigate' },
  { id: 'go-evm', label: 'Go to EVM', icon: TrendingUp, path: '/evm', section: 'navigate' },
  { id: 'go-monte-carlo', label: 'Go to Monte Carlo', icon: Dices, path: '/monte-carlo', section: 'navigate' },
  { id: 'go-scenarios', label: 'Go to Scenarios', icon: FlaskConical, path: '/scenarios', section: 'navigate' },
  { id: 'go-reports', label: 'Go to Reports', icon: FileText, path: '/reports', section: 'navigate' },
  { id: 'go-report-builder', label: 'Go to Report Builder', icon: FileBarChart, path: '/report-builder', section: 'navigate' },
  { id: 'go-query', label: 'Go to Ask AI', icon: Search, path: '/query', section: 'navigate' },
  { id: 'go-agent', label: 'Go to Agent Proposals', icon: Bot, path: '/agent', section: 'navigate' },
  { id: 'go-notifications', label: 'Go to Notifications', icon: Bell, path: '/notifications', section: 'navigate' },
  { id: 'go-timesheet', label: 'Go to Timesheet', icon: Clock, path: '/timesheet', section: 'navigate' },
  { id: 'go-goals', label: 'Go to Goals', icon: Target, path: '/goals', section: 'navigate' },
  { id: 'go-settings', label: 'Go to Settings', icon: Settings, path: '/settings', section: 'navigate' },
  { id: 'go-account', label: 'Go to Account & Billing', icon: CreditCard, path: '/account', section: 'navigate' },
  { id: 'go-help', label: 'Go to Help', icon: HelpCircle, path: '/help', section: 'navigate' },
];

const allCommands = [...actionCommands, ...navigateCommands];

// --- Helpers ---

function getRecents(): string[] {
  try {
    const stored = localStorage.getItem(RECENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function pushRecent(commandId: string) {
  try {
    const recents = getRecents().filter(id => id !== commandId);
    recents.unshift(commandId);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch { /* ignore */ }
}

// --- Search result helpers (unchanged) ---

const statusColors: Record<string, string> = {
  active: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  planning: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  on_hold: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  completed: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  not_started: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  done: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  cancelled: 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300',
};

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  high: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  low: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
};

const priorityColors: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  high: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  low: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
};

interface CategoryConfig {
  type: SearchResult['type'];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const categories: CategoryConfig[] = [
  { type: 'project', label: 'Projects', icon: FolderKanban },
  { type: 'task', label: 'Tasks', icon: CheckSquare },
  { type: 'risk', label: 'Risks & Issues', icon: AlertTriangle },
  { type: 'goal', label: 'Goals', icon: Target },
  { type: 'resource', label: 'Resources', icon: Users },
  { type: 'lesson', label: 'Lessons', icon: BookOpen },
  { type: 'change_request', label: 'Change Requests', icon: GitPullRequest },
  { type: 'sprint', label: 'Sprints', icon: Zap },
  { type: 'comment', label: 'Comments', icon: MessageSquare },
];

function getStatusColor(status?: string): string {
  if (!status) return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
  return statusColors[status] || 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
}

function formatStatus(status?: string): string {
  if (!status) return '';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function ResultBadges({ result }: { result: SearchResult }) {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {result.type === 'risk' && result.recordId && (
        <span className="text-xs text-gray-400 font-mono">{result.recordId}</span>
      )}
      {result.type === 'risk' && result.severity && (
        <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-full ${severityColors[result.severity] || 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
          {formatStatus(result.severity)}
        </span>
      )}
      {result.type === 'task' && result.priority && (
        <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-full ${priorityColors[result.priority] || 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
          {formatStatus(result.priority)}
        </span>
      )}
      {result.type === 'goal' && result.progress != null && result.progress > 0 && (
        <div className="flex items-center gap-1">
          <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.min(result.progress, 100)}%` }} />
          </div>
          <span className="text-xs text-gray-400">{result.progress}%</span>
        </div>
      )}
      {result.status && (
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(result.status)}`}>
          {formatStatus(result.status)}
        </span>
      )}
    </div>
  );
}

// --- Component ---

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { dialogRef, handleKeyDown: modalKeyDown } = useModal(isOpen, onClose);

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (query.length >= 2) return []; // Switch to entity search mode
    if (!query) return [];
    const lower = query.toLowerCase();
    return allCommands.filter(c =>
      c.label.toLowerCase().includes(lower) ||
      (c.description && c.description.toLowerCase().includes(lower))
    );
  }, [query]);

  // Build recent command items
  const recentCommands = useMemo(() => {
    if (query) return []; // Hide recents when filtering
    const recentIds = getRecents();
    return recentIds
      .map(id => allCommands.find(c => c.id === id))
      .filter((c): c is CommandItem => !!c)
      .map(c => ({ ...c, section: 'recent' as const }));
  }, [query, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine what to show in empty/command mode
  const showEntitySearch = query.length >= 2;
  const showCommandFilter = query.length === 1;
  const showDefaultCommands = !query;

  // Items for keyboard navigation in command mode
  const commandItems = showDefaultCommands
    ? [...recentCommands, ...actionCommands, ...navigateCommands]
    : showCommandFilter
      ? filteredCommands
      : [];

  const totalItems = showEntitySearch ? results.length : commandItems.length;

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced entity search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiService.search(query);
        setResults(data.results || []);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const navigateTo = useCallback(
    (path: string) => {
      onClose();
      navigate(path);
    },
    [navigate, onClose]
  );

  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      pushRecent(cmd.id);
      navigateTo(cmd.path);
    },
    [navigateTo]
  );

  const selectResult = useCallback(
    (result: SearchResult) => {
      switch (result.type) {
        case 'project':
          navigateTo(`/project/${result.id}`);
          break;
        case 'task':
        case 'risk':
        case 'change_request':
        case 'sprint':
        case 'comment':
          if (result.projectId) navigateTo(`/project/${result.projectId}`);
          break;
        case 'goal':
          navigateTo('/goals');
          break;
        case 'resource':
          navigateTo('/resources');
          break;
        case 'lesson':
          onClose();
          break;
      }
    },
    [navigateTo, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Let useModal handle Escape and Tab (focus trap)
    modalKeyDown(e);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(totalItems, 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showEntitySearch && results.length > 0) {
        selectResult(results[selectedIndex]);
      } else if (!showEntitySearch && commandItems.length > 0) {
        const cmd = commandItems[selectedIndex];
        if (cmd) executeCommand(cmd);
      }
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector('[data-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Group entity search results by category
  const groupedResults: { config: CategoryConfig; items: SearchResult[] }[] = [];
  let flatIndex = 0;
  const flatIndexMap: Map<SearchResult, number> = new Map();
  for (const result of results) {
    flatIndexMap.set(result, flatIndex++);
  }
  for (const cat of categories) {
    const items = results.filter(r => r.type === cat.type);
    if (items.length > 0) {
      groupedResults.push({ config: cat, items });
    }
  }

  const hasResults = showEntitySearch && results.length > 0;
  const showEmpty = showEntitySearch && !loading && results.length === 0;

  // Group command items by section for display
  const recentSection = commandItems.filter(c => c.section === 'recent');
  const actionSection = commandItems.filter(c => c.section === 'action');
  const navSection = commandItems.filter(c => c.section === 'navigate');

  // Track cumulative index for keyboard selection
  let cumulativeIndex = 0;

  function renderCommandSection(title: string, items: CommandItem[]) {
    if (items.length === 0) return null;
    const startIdx = cumulativeIndex;
    cumulativeIndex += items.length;
    return (
      <React.Fragment key={title}>
        <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-1 first:mt-0">
          {title}
        </div>
        {items.map((cmd, i) => {
          const Icon = cmd.icon;
          const idx = startIdx + i;
          const isSelected = selectedIndex === idx;
          return (
            <button
              key={cmd.id}
              data-selected={isSelected}
              onClick={() => executeCommand(cmd)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isSelected ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-primary-500 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{cmd.label}</p>
                {cmd.description && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{cmd.description}</p>
                )}
              </div>
              <ArrowRight className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-primary-400' : 'text-gray-300 dark:text-gray-600'}`} />
            </button>
          );
        })}
      </React.Fragment>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />

      {/* Modal */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="flex items-center px-4 border-b border-gray-200 dark:border-gray-700">
          <Search className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-12 pl-3 pr-4 text-sm bg-transparent border-0 outline-none focus:ring-0 placeholder-gray-400 dark:placeholder-gray-500 text-gray-900 dark:text-white"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-xs font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-80 overflow-y-auto">
          {/* Loading */}
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Searching…</div>
          )}

          {/* Commands (default + filtered) */}
          {!showEntitySearch && !loading && (
            <div className="py-2">
              {recentSection.length > 0 && renderCommandSection('Recent', recentSection)}
              {renderCommandSection('Actions', actionSection)}
              {renderCommandSection('Navigate', navSection)}

              {commandItems.length === 0 && query.length === 1 && (
                <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No commands match "{query}" — keep typing to search
                </div>
              )}

              {showDefaultCommands && (
                <div className="px-4 py-3 text-center text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 mt-1">
                  Type 2+ characters to search projects, tasks, and more
                </div>
              )}
            </div>
          )}

          {/* Entity Search Results */}
          {hasResults && !loading && (
            <div className="py-2">
              {groupedResults.map(({ config, items }) => {
                const Icon = config.icon;
                return (
                  <React.Fragment key={config.type}>
                    <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-1 first:mt-0">
                      {config.label}
                    </div>
                    {items.map((result) => {
                      const idx = flatIndexMap.get(result) ?? -1;
                      const isSelected = selectedIndex === idx;
                      const subtitle = result.projectName || result.description;
                      return (
                        <button
                          key={`${result.type}-${result.id}`}
                          data-selected={isSelected}
                          onClick={() => selectResult(result)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isSelected ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-primary-500 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{result.name}</p>
                            {subtitle && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{subtitle}</p>
                            )}
                          </div>
                          <ResultBadges result={result} />
                        </button>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {/* No results */}
          {showEmpty && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">No results found for "{query}"</p>
              <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Try a different search term</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Notification {
  id: string;
  type: 'risk' | 'budget' | 'schedule' | 'resource' | 'info' | 'reschedule_proposal' | 'budget_alert' | 'monte_carlo_alert' | 'meeting_followup' | 'task_assigned' | 'task_completed' | 'deadline_approaching' | 'task_comment' | 'member_added' | 'agent_proposal' | 'agent_low_confidence' | 'agent_execution_complete' | 'agent_execution_failed' | 'agent_notification' | 'agent_rollback' | 'raid_item' | 'system_alert' | 'workflow_action' | 'mention' | 'ai_budget_warning';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  projectId?: string;
  projectName?: string;
  scheduleId?: string;
  linkType?: string;
  linkId?: string;
  suggestedActions?: Array<{ toolName: string; params: Record<string, any>; label: string }>;
  read: boolean;
  createdAt: string;
}

export interface AIPanelContext {
  type: 'dashboard' | 'project' | 'schedule' | 'reports' | 'general';
  projectId?: string;
  projectName?: string;
}

interface UIState {
  sidebarCollapsed: boolean;
  aiPanelOpen: boolean;
  aiPanelContext: AIPanelContext;
  notifications: Notification[];
  unreadCount: number;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleAIPanel: () => void;
  setAIPanelOpen: (open: boolean) => void;
  setAIPanelContext: (context: AIPanelContext) => void;
  /** `id` = the server's id (so marking read reaches the server); an id already shown is ignored */
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) => void;
  /** The server's unread total — the list only holds a page of them */
  setUnreadCount: (n: number) => void;
  dismissNotification: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
}

let notificationIdCounter = 0;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      aiPanelOpen: false,
      aiPanelContext: { type: 'dashboard' },
      notifications: [],
      unreadCount: 0,

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      toggleAIPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),

      setAIPanelOpen: (open) => set({ aiPanelOpen: open }),

      setAIPanelContext: (context) => set({ aiPanelContext: context }),

      addNotification: (notification) =>
        set((state) => {
          // It used to invent an id and force "unread": marking one read sent the server an id it
          // didn't know, so nothing was ever read and everything came back unread next visit.
          if (notification.id && state.notifications.some((n) => n.id === notification.id)) return state;
          const id = notification.id ?? `notif-${Date.now()}-${++notificationIdCounter}`;
          const newNotification: Notification = {
            ...notification,
            id,
            read: !!notification.read,
            createdAt: notification.createdAt ?? new Date().toISOString(),
          };
          const merged = [newNotification, ...state.notifications]
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .slice(0, 200);
          return {
            notifications: merged,
            unreadCount: newNotification.read ? state.unreadCount : state.unreadCount + 1,
          };
        }),
      setUnreadCount: (n) => set({ unreadCount: Math.max(0, n) }),

      dismissNotification: (id) =>
        set((state) => {
          const notification = state.notifications.find((n) => n.id === id);
          const wasUnread = notification && !notification.read;
          return {
            notifications: state.notifications.map((n) =>
              n.id === id ? { ...n, read: true } : n
            ),
            unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
          };
        }),

      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        })),

      clearNotifications: () => set({ notifications: [], unreadCount: 0 }),
    }),
    {
      name: 'pm-generic-ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        aiPanelOpen: state.aiPanelOpen,
      }),
    }
  )
);

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'admin' | 'executive' | 'project_manager' | 'team_member' | 'scrum_master' | 'finance_officer' | 'risk_manager' | 'pmo' | 'ba' | 'qa' | 'tester' | 'devops' | 'claude_sme' | 'viewer';
  subscriptionTier?: 'trial' | 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise';
  subscriptionStatus?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  /** Plan an unpaid signup is buying. Set while 'incomplete', cleared once they pay. */
  pendingTier?: 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise' | null;
  trialEndsAt?: string | null;
  isFounder?: boolean;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
  isGuest?: boolean;
  guestExpiresAt?: string | null;
  /** The user's company; null = none (the platform admin). Undefined until /me has answered. */
  organization?: { id: string; name: string; slug: string; isOwner?: boolean } | null;
  /** Set during the platform admin's read-only Support view visit (the app shows that company) */
  supportSession?: { organizationName: string; reason: string; expiresAt: string } | null;
}

/** Personal pages any signed-in account can use, company or not */
const PERSONAL_PATHS = ['/settings', '/help', '/notifications', '/admin'];

/**
 * An account with no company (the platform admin) has no project data: company pages would
 * only show "not part of a company" errors. Only true once /me has said so.
 */
export function withoutCompany(user: User | null | undefined): boolean {
  return !!user && user.organization === null;
}

/**
 * The Kovarti platform admin: role 'admin' AND no company ("admin owns nothing", user rule
 * 2026-10-04). Company members can't be admin; the server refuses it too (utils/platformAdmin.ts).
 */
export function isPlatformAdmin(user: User | null | undefined): boolean {
  return !!user && user.role === 'admin' && withoutCompany(user);
}

export function isPersonalPath(pathname: string): boolean {
  return PERSONAL_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
          isLoading: false,
          error: null,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) =>
        set({
          error,
          isLoading: false,
        }),

      logout: () => {
        localStorage.removeItem('pm-generic-auth-storage');
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'pm-generic-auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      // Force isLoading=true after rehydration so the /auth/me check
      // completes before any PrivateRoute renders (prevents flash of stale page)
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoading = true;
        }
      },
    }
  )
);

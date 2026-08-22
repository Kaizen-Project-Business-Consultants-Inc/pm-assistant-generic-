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
  trialEndsAt?: string | null;
  isFounder?: boolean;
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
    }
  )
);

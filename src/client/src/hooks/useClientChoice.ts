import { useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { canManageClients } from './useCanManageClients';
import { resolveClientChoice, type ClientOption } from '../components/project/ClientNameField';
import { clientWordFor, type ClientWord } from './useClientWord';

/** What a client box needs to show itself (the resolve step stays with the screen that saves). */
export interface ClientFieldState {
  /** May add clients (owner/PMO, project managers) — gets the type-or-create box; others pick from a list */
  canManage: boolean;
  /** "Department" on the Team and Enterprise plans, else "Client" (U50) */
  word: ClientWord;
  clients: ClientOption[];
  listFailed: boolean;
  /** The list is still loading — a typed name can't yet be told apart from an existing client */
  loading: boolean;
  label: string;
}

/**
 * The client box on the first-project step, New project and Edit project (UAT U35, 2026-10-18): one
 * place that loads the company's clients and turns the typed text into a client id — an existing
 * client, a new one added first, or none (null). A client added on an earlier, failed try is reused,
 * so a retry doesn't hit "already exists".
 */
export function useClientChoice(enabled: boolean): ClientFieldState & { resolveClientId: (text: string) => Promise<string | null> } {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const q = useQuery<{ groups: ClientOption[] }>({ queryKey: ['project-groups'], queryFn: () => apiService.getProjectGroups(), enabled, staleTime: 120_000 });
  const added = useRef<{ name: string; id: string } | null>(null);
  const clients = q.data?.groups;

  const resolveClientId = useCallback(async (text: string): Promise<string | null> => {
    const choice = resolveClientChoice(text, clients ?? []);
    if (choice.kind === 'none') return null;
    if (choice.kind === 'existing') return choice.id;
    if (added.current?.name.toLowerCase() !== choice.name.toLowerCase()) {
      try {
        const created = await apiService.createProjectGroup({ name: choice.name });
        added.current = { name: choice.name, id: created.id as string };
      } finally {
        // a name refused as "already exists" (added elsewhere meanwhile) shows up in the list next time
        void queryClient.invalidateQueries({ queryKey: ['project-groups'] });
      }
    }
    return added.current!.id;
  }, [clients, queryClient]);

  return {
    canManage: canManageClients(user),
    clients: clients ?? [],
    listFailed: q.isError,
    loading: enabled && q.isLoading,
    word: clientWordFor(user?.subscriptionTier),
    label: clientWordFor(user?.subscriptionTier).one,
    resolveClientId,
  };
}

import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';

/**
 * Who can be picked for work on the project being viewed (U8): its client's people and My resources
 * (people in no client's pool, generic roles included) — never another client's. The server refuses
 * the same (services/poolFit.ts). Off a project page everyone is offered.
 */
export function useInProjectPool(): (r: { clientId?: string | null }) => boolean {
  const { id } = useParams<{ id: string }>();
  // the project page loads it; this only listens (re-renders when it arrives), never fetches
  const { data } = useQuery<{ project?: { clientId?: string | null; groupId?: string | null } }>({
    queryKey: ['project', id], queryFn: () => apiService.getProject(id!), enabled: false,
  });
  const project = id ? data?.project : undefined;
  const anyone = !project;
  const clientId = project?.clientId || project?.groupId || null;
  return useCallback((r: { clientId?: string | null }) => anyone || !r.clientId || r.clientId === clientId, [anyone, clientId]);
}

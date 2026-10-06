import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../../../services/api';

/**
 * Resource / person id → name, from the shared `['resources']` cache (one request for every
 * row, bar and view on the page). Keyed by the resource id and, for a resource that is a
 * user, by the user id too — Assigned To can hold either. Used to show names and to sort by
 * them (Assigned, Resource) in the Gantt and the Table.
 */
export function useResourceNameMap(): Map<string, string> {
  const { data: resourceData } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
    staleTime: 60_000,
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const r of (resourceData?.resources || []) as { id: string; name: string; userId?: string | null }[]) {
      if (r.userId) map.set(r.userId, r.name);
      map.set(r.id, r.name);
    }
    return map;
  }, [resourceData]);
}

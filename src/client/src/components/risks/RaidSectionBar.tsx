import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { toLocalDate } from '../../utils/dateUtils';
import { attentionReason, RAID_SECTIONS, type RaidSection } from '../../utils/raidAttention';

/**
 * Which section is shown and what it lists. Not chosen yet: opens on "Needs attention" when
 * something needs it, else "All". A type section sets the list's type filter (the server filters);
 * "Needs attention" lists every type and keeps the items that need it. The count comes from the
 * unfiltered list — the same query, and cache, as the list with no filters.
 */
export function useRaidSections(projectId: string, listed: any[], setType: (type: string) => void) {
  const [section, setSection] = useState<RaidSection | null>(null);
  const { data: allItemsData } = useQuery({
    queryKey: ['project-risks', projectId, {}],
    queryFn: () => apiService.getRiskItems(projectId, {}),
    enabled: !!projectId,
  });
  const today = toLocalDate();
  const reasonOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (allItemsData?.data || []) as any[]) { const why = attentionReason(r, today); if (why) m.set(r.id, why); }
    return m;
  }, [allItemsData, today]);
  const shownSection: RaidSection = section ?? (reasonOf.size > 0 ? 'attention' : 'all');
  const chooseSection = (next: RaidSection) => {
    setSection(next);
    setType(next === 'attention' || next === 'all' ? '' : next);
  };
  const risks = shownSection === 'attention' ? listed.filter(r => reasonOf.has(r.id)) : listed;
  return { shownSection, chooseSection, reasonOf, risks, attentionCount: reasonOf.size };
}

/** Each section's count: the log's totals per type, and how many need attention */
export function sectionCounts(stats: Record<string, unknown>, attention: number): Record<RaidSection, number> {
  const n = (k: string) => Number(stats[k] ?? 0);
  const byType = { risk: n('totalRisks'), issue: n('totalIssues'), action: n('totalActions'), decision: n('totalDecisions'), assumption: n('totalAssumptions'), dependency: n('totalDependencies') };
  return { attention, ...byType, all: Object.values(byType).reduce((a, b) => a + b, 0) };
}

/** The Risks & Issues sections (U20), each with its count; "Needs attention" stands out in amber */
export function RaidSectionBar({ shown, counts, onChoose }: { shown: RaidSection; counts: Record<RaidSection, number>; onChoose: (s: RaidSection) => void }) {
  // Many projects never log dependencies: their section appears once there is one
  const sections = RAID_SECTIONS.filter(sec => sec.id !== 'dependency' || counts.dependency > 0 || shown === 'dependency');
  const style = (id: RaidSection) => {
    const on = shown === id;
    if (id === 'attention') {
      if (on) return 'bg-amber-600 border-amber-600 text-white';
      if (counts.attention > 0) return 'border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40';
    }
    return on ? 'bg-primary-600 border-primary-600 text-white'
      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700';
  };
  return (
    <div role="group" aria-label="RAID sections" className="flex flex-wrap gap-1.5">
      {sections.map(sec => (
        <button key={sec.id} type="button" aria-pressed={shown === sec.id} onClick={() => onChoose(sec.id)} aria-label={`${sec.label}, ${counts[sec.id]}`}
          className={`inline-flex items-center gap-1.5 min-h-[32px] px-3 rounded-full border text-xs font-semibold transition-colors ${style(sec.id)}`}>
          {sec.label}
          <span aria-hidden="true" className={`tabular-nums rounded-full px-1.5 ${shown === sec.id ? 'bg-white/25' : 'bg-gray-100 dark:bg-gray-700'}`}>{counts[sec.id]}</span>
        </button>
      ))}
    </div>
  );
}

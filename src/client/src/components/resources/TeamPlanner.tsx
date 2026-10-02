import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiService } from '../../services/api';
import { formatCalendarDate, toLocalDate } from '../../utils/dateUtils';
import { packLanes, shiftYmd, mondayOfYmd, grabbedWeek } from '../../utils/plannerLayout';
import { PlannerMoveDialog } from './PlannerMoveDialog';
import type { PlannerBlock, PlannerPerson } from '../../types/teamPlanner';

const WEEKS = 8;
const day = (d: string) => formatCalendarDate(d, { day: 'numeric', month: 'short' });

/** One colour per project you manage (light + dark); other projects are grey */
const PALETTE = [
  'bg-teal-100 border-teal-700 text-teal-950 dark:bg-teal-900/50 dark:border-teal-400 dark:text-teal-50',
  'bg-blue-100 border-blue-700 text-blue-950 dark:bg-blue-900/50 dark:border-blue-400 dark:text-blue-50',
  'bg-orange-100 border-orange-700 text-orange-950 dark:bg-orange-900/50 dark:border-orange-400 dark:text-orange-50',
  'bg-purple-100 border-purple-700 text-purple-950 dark:bg-purple-900/50 dark:border-purple-400 dark:text-purple-50',
  'bg-pink-100 border-pink-700 text-pink-950 dark:bg-pink-900/50 dark:border-pink-400 dark:text-pink-50',
  'bg-lime-100 border-lime-700 text-lime-950 dark:bg-lime-900/50 dark:border-lime-400 dark:text-lime-50',
];
const OTHER = 'bg-gray-200 border-gray-400 text-gray-800 dark:bg-gray-700 dark:border-gray-500 dark:text-gray-100';

interface Drag { block: PlannerBlock; grabIdx: number }
interface Pending { block: PlannerBlock; toId: string | null; weeks: number }

/**
 * Team Planner (Resources → Team Planner): the company's people down the side (those on your projects first), weeks across,
 * every person's row adding up ALL their work. Drag a block onto another person (it becomes theirs)
 * or another week (it moves, and the tasks linked after it follow); a check shows what that does
 * before anything is saved, and the change goes in Schedule History with Undo. Keyboard: Enter on a
 * block opens the same check, where the person and week are picked.
 */
export function TeamPlanner() {
  const queryClient = useQueryClient();
  const thisWeek = mondayOfYmd(toLocalDate());
  const [from, setFrom] = useState(thisWeek);
  const [projectFilter, setProjectFilter] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [hover, setHover] = useState<{ rowId: string; idx: number } | null>(null);
  const [done, setDone] = useState<{ changeId: string | null; summary: string; scheduleId: string } | null>(null);
  const [undoMsg, setUndoMsg] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);

  const { data: board, isLoading, error } = useQuery({
    queryKey: ['team-planner', from, WEEKS],
    queryFn: () => apiService.getTeamPlanner(from, WEEKS),
  });

  const colourOf = useMemo(() => {
    const m = new Map((board?.projects ?? []).map((p, i) => [p.id, PALETTE[i % PALETTE.length]]));
    return (b: PlannerBlock) => (b.editable && b.projectId ? m.get(b.projectId) ?? OTHER : OTHER);
  }, [board?.projects]);

  const people = useMemo(() => {
    const list = board?.people ?? [];
    if (!projectFilter) return list;
    return list.filter(p => p.blocks.some(b => b.projectId === projectFilter));
  }, [board?.people, projectFilter]);
  const unassigned = (board?.unassigned ?? []).filter(b => !projectFilter || b.projectId === projectFilter);
  const weeks = board?.weeks ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['team-planner'] });
    queryClient.invalidateQueries({ queryKey: ['workload'] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['schedule-changes'] });
  };

  const weekIdxAt = (e: React.DragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(weeks.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * weeks.length)));
  };
  const canDropOn = (row: PlannerPerson, d: Drag | null) =>
    !!d && (row.id === d.block.resourceId || (!row.isGeneric));

  const undo = async () => {
    if (!done?.changeId) return;
    try {
      await apiService.undoScheduleChange(done.scheduleId, done.changeId);
      setUndoMsg('Undone.');
      setDone(null);
      refresh();
    } catch (e: any) {
      setUndoMsg(e?.response?.data?.message ?? "It couldn't be undone. Something in that plan has changed since.");
    }
  };

  const blockButton = (b: PlannerBlock, first: number, last: number, gridRow: number, generic: boolean) => {
    const label = b.taskName ?? 'Another project';
    const hours = b.hoursPerWeek != null ? ` · ${b.hoursPerWeek}h/wk` : '';
    const style = { gridColumn: `${first + 1} / ${last + 2}`, gridRow: `${gridRow}` };
    const look = generic ? 'bg-white dark:bg-gray-900 border-2 border-dashed border-gray-500 dark:border-gray-400 text-gray-800 dark:text-gray-100' : `border ${colourOf(b)}`;
    const text = `${label}${hours}`;
    const where = `${b.projectName ? `${b.projectName}, ` : ''}${day(b.startDate)} to ${day(b.endDate)}`;
    if (!b.editable) {
      return (
        <div key={b.key} style={style} className={`relative z-10 mx-1 px-2 py-1 rounded-md text-xs font-medium truncate ${look}`} title={`${text} — ${where}. Not on your projects, so it can't be moved here.`}>
          {text}
        </div>
      );
    }
    return (
      <button
        key={b.key}
        type="button"
        draggable
        style={style}
        onDragStart={e => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          drag.current = { block: b, grabIdx: grabbedWeek(first, last, e.clientX - r.left, r.width) };
          e.dataTransfer.setData('text/plain', b.key);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => { drag.current = null; setHover(null); }}
        onClick={() => setPending({ block: b, toId: b.resourceId, weeks: 0 })}
        aria-label={`${text}, ${where}${b.started ? ', started' : ''}. Press Enter to give it to someone else or move it.`}
        title={`${text} — ${where}. Drag to another person or week, or click to choose.`}
        className={`relative z-10 mx-1 px-2 py-1 rounded-md text-left text-xs font-semibold truncate cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 hover:shadow ${look}`}
      >
        {text}{generic && ' · drag onto a person'}
      </button>
    );
  };

  const weekArea = (rowId: string, rows: number, children: React.ReactNode, row?: PlannerPerson) => (
    <div
      className="relative flex-1 grid"
      style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(6rem, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, rows)}, minmax(1.9rem, auto))`, rowGap: '0.25rem' }}
      onDragOver={row ? e => {
        if (!canDropOn(row, drag.current)) return;
        e.preventDefault();
        const idx = weekIdxAt(e);
        if (hover?.rowId !== rowId || hover.idx !== idx) setHover({ rowId, idx });
      } : undefined}
      onDragLeave={row ? () => setHover(h => (h?.rowId === rowId ? null : h)) : undefined}
      onDrop={row ? e => {
        e.preventDefault();
        const d = drag.current;
        drag.current = null; setHover(null);
        if (!d || !canDropOn(row, d)) return;
        const shift = weekIdxAt(e) - d.grabIdx;
        const toId = row.id;
        if (toId === d.block.resourceId && shift === 0) return;
        setPending({ block: d.block, toId, weeks: d.block.started ? 0 : shift });
      } : undefined}
    >
      {weeks.map((w, i) => (
        <div key={w} aria-hidden="true" style={{ gridColumn: `${i + 1}`, gridRow: '1 / -1' }}
          className={`border-l border-gray-100 dark:border-gray-700 ${w === thisWeek ? 'bg-primary-50/60 dark:bg-primary-900/10' : ''} ${hover?.rowId === rowId && hover.idx === i ? '!bg-primary-100 dark:!bg-primary-900/40 outline outline-2 outline-dashed outline-primary-500' : ''}`} />
      ))}
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Team Planner</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Your team week by week, counting all their work on every project — people on your projects first. Drag a block to another person or another week; you'll see what it does before anything changes.</p>
        </div>
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
          <span className="block mb-1">Projects</span>
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="h-10 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100">
            <option value="">All my projects ({board?.projects.length ?? 0})</option>
            {(board?.projects ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Earlier weeks" onClick={() => setFrom(f => shiftYmd(f, -28))} className="h-10 w-10 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" onClick={() => setFrom(thisWeek)} className="h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">This week</button>
          <button type="button" aria-label="Later weeks" onClick={() => setFrom(f => shiftYmd(f, 28))} className="h-10 w-10 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-700 dark:text-gray-300">
        {(board?.projects ?? []).map((p, i) => (
          <span key={p.id} className="inline-flex items-center gap-1.5"><span className={`w-3.5 h-3.5 rounded border ${PALETTE[i % PALETTE.length]}`} aria-hidden="true" />{p.name}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className={`w-3.5 h-3.5 rounded border ${OTHER}`} aria-hidden="true" />Other projects (can't be moved here)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded border-2 border-dashed border-gray-500" aria-hidden="true" />On a generic role — needs a person</span>
        <span className="inline-flex items-center gap-1.5"><span className="px-1.5 rounded bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 font-semibold">48h</span>Over their hours that week</span>
      </div>

      {done && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm" role="status">
          <span className="flex-1">{done.summary.replace(/ — Team Planner$/, '')}. Saved in the schedule's History.</span>
          {done.changeId && <button type="button" onClick={undo} className="h-9 px-3 rounded-md border border-gray-400 font-semibold hover:bg-gray-800">Undo</button>}
          <button type="button" onClick={() => setDone(null)} className="h-9 px-2 text-gray-300 hover:text-white" aria-label="Dismiss">✕</button>
        </div>
      )}
      {undoMsg && !done && <p className="text-sm text-gray-700 dark:text-gray-300" role="status">{undoMsg}</p>}

      {isLoading && <p className="text-sm text-gray-600 dark:text-gray-400">Loading the planner…</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">The planner couldn't be loaded. Try again.</p>}
      {board && board.projects.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">You don't manage any projects yet, so there's nobody to plan. The planner shows the people on projects where you're the Project Manager.</p>
      )}

      {board && board.projects.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-x-auto">
          <div className="min-w-[60rem] text-sm">
            <div className="flex bg-gray-50 dark:bg-gray-900/40 text-xs font-semibold text-gray-700 dark:text-gray-300">
              <div className="w-52 shrink-0 px-3 py-2.5">Person</div>
              <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(6rem, 1fr))` }}>
                {weeks.map(w => <div key={w} className={`px-2 py-2.5 border-l border-gray-200 dark:border-gray-700 ${w === thisWeek ? 'text-primary-700 dark:text-primary-300' : ''}`}>{day(w)}{w === thisWeek ? ' · this week' : ''}</div>)}
              </div>
            </div>

            {unassigned.length > 0 && (() => {
              const { placed, lanes } = packLanes(unassigned, weeks);
              return (
                <div className="flex border-t border-gray-200 dark:border-gray-700 bg-amber-50/70 dark:bg-amber-900/10 py-1.5">
                  <div className="w-52 shrink-0 px-3 py-1">
                    <div className="font-semibold text-gray-900 dark:text-white">No one assigned</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">{unassigned.length} task{unassigned.length === 1 ? '' : 's'} · drag onto a person</div>
                  </div>
                  {weekArea('none', lanes, placed.map(p => blockButton(p.block, p.first, p.last, p.lane + 1, false)))}
                </div>
              );
            })()}

            {people.map(person => {
              const { placed, lanes } = packLanes(person.blocks, weeks);
              return (
                <div key={person.id} className={`flex border-t border-gray-200 dark:border-gray-700 py-1.5 ${person.isGeneric ? 'bg-gray-50 dark:bg-gray-900/30' : ''}`}>
                  <div className="w-52 shrink-0 px-3 py-1">
                    <div className="font-semibold text-gray-900 dark:text-white">{person.name}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">{person.isGeneric ? 'Generic role · needs a person' : `${person.role ?? 'Team'} · ${person.capacity[0] ?? 0}h a week`}</div>
                  </div>
                  {weekArea(person.id, lanes + (person.isGeneric ? 0 : 1), (
                    <>
                      {!person.isGeneric && person.load.map((h, i) => {
                        const cap = person.capacity[i] ?? 0;
                        const over = h > cap;
                        return (
                          <div key={`l${i}`} style={{ gridColumn: `${i + 1}`, gridRow: '1' }} className="relative z-10 px-2 py-0.5 text-xs font-semibold">
                            {over
                              ? <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200">{h}h · over by {Math.round((h - cap) * 10) / 10}h</span>
                              : <span className={h === 0 ? 'text-gray-500 dark:text-gray-400 font-normal' : 'text-gray-700 dark:text-gray-300'}>{h === 0 ? 'free' : `${h}h`}</span>}
                          </div>
                        );
                      })}
                      {placed.map(p => blockButton(p.block, p.first, p.last, p.lane + (person.isGeneric ? 1 : 2), person.isGeneric))}
                    </>
                  ), person)}
                </div>
              );
            })}
            {people.length === 0 && unassigned.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">No one has work on your projects in these weeks.</p>
            )}
          </div>
        </div>
      )}

      {board && board.projects.length > 0 && (
        <p className="text-xs text-gray-600 dark:text-gray-400">Each row adds up all of that person's work, on every project, at their real weekly hours (working days only). Work on projects that aren't yours is grey and can't be moved; you only see its name if you can open that project. Started tasks can change hands but keep their dates.</p>
      )}

      {pending && board && (
        <PlannerMoveDialog
          block={pending.block}
          people={board.people}
          initialTo={pending.toId}
          initialWeeks={pending.weeks}
          onClose={() => setPending(null)}
          onDone={r => { setPending(null); setUndoMsg(null); setDone(r); refresh(); }}
        />
      )}
    </div>
  );
}

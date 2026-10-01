import React, { useMemo, useRef } from 'react';
import { layoutTimelineStrip, monthTicks, StripTask } from './timelineStrip';

/**
 * Timeline strip (2026-10-01, replaces the minimap): the whole project on one line above the
 * Gantt. Click a phase or milestone to jump the Gantt there; drag the shaded box to scroll.
 * Exported as an image from Export → "Timeline as image" (element id below).
 */
export const TIMELINE_STRIP_ID = 'gantt-timeline-strip';

interface Props {
  tasks: StripTask[];
  projectName?: string;
  /** what the Gantt below is showing */
  view: { start: Date; end: Date } | null;
  /** move the Gantt so this date is in view (centre) */
  onJump: (date: Date) => void;
}

const W = 1000;          // drawing units; the SVG scales to the page width
const PAD = 12;
const LANE_H = 20;
const fmt = (d: Date, withYear = false) =>
  d.toLocaleDateString(undefined, withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
const PHASE_COLORS = ['#64748b', '#0d9488', '#7c3aed', '#d97706', '#2563eb', '#db2777'];

export const GanttTimelineStrip = React.memo(function GanttTimelineStrip({ tasks, projectName, view, onJump }: Props) {
  const layout = useMemo(() => layoutTimelineStrip(tasks, projectName), [tasks, projectName]);
  const svgRef = useRef<SVGSVGElement>(null);
  if (!layout) return null;

  const span = Math.max(1, layout.end.getTime() - layout.start.getTime());
  const x = (d: Date) => PAD + ((d.getTime() - layout.start.getTime()) / span) * (W - 2 * PAD);
  const dateAt = (px: number) => new Date(layout.start.getTime() + ((px - PAD) / (W - 2 * PAD)) * span);
  const phasesTop = 22;
  const msTop = phasesTop + layout.lanes * (LANE_H + 4) + 4;
  const H = msTop + 34;
  const today = new Date();
  const todayIn = today >= layout.start && today <= layout.end;

  // Drag the box (or click anywhere on the strip background) to move the Gantt
  const toSvgX = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * W;
  };
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-jump]')) return;
    onJump(dateAt(toSvgX(e.clientX)));
    const move = (ev: PointerEvent) => onJump(dateAt(toSvgX(ev.clientX)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const keyJump = (d: Date) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(d); }
  };

  const vx1 = view ? Math.max(PAD, x(view.start)) : 0;
  const vx2 = view ? Math.min(W - PAD, x(view.end)) : 0;

  return (
    <div id={TIMELINE_STRIP_ID} className="px-3 pt-2 pb-1 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-gray-900 dark:text-white">
          {projectName ? `${projectName} · ` : ''}{fmt(layout.start, true)} → {fmt(layout.end, true)}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 print:hidden">Click a phase or milestone to jump there · drag to scroll</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Project timeline from ${fmt(layout.start, true)} to ${fmt(layout.end, true)}`}
        className="block select-none cursor-grab touch-none"
        onPointerDown={startDrag}
      >
        {monthTicks(layout.start, layout.end).map(m => (
          <g key={m.toISOString()}>
            <line x1={x(m)} x2={x(m)} y1={14} y2={H} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={1} />
            <text x={x(m) + 3} y={11} fontSize={10} className="fill-gray-500 dark:fill-gray-400">
              {m.toLocaleDateString(undefined, m.getMonth() === 0 ? { month: 'short', year: 'numeric' } : { month: 'short' })}
            </text>
          </g>
        ))}

        {view && vx2 > vx1 && (
          <rect x={vx1} y={14} width={vx2 - vx1} height={H - 14} rx={3}
            className="fill-primary-500/10 stroke-primary-500" strokeWidth={1.5} />
        )}

        {layout.phases.map((p, i) => {
          const px1 = x(p.start);
          const pw = Math.max(4, x(p.end) - px1);
          const y = phasesTop + p.lane * (LANE_H + 4);
          return (
            <g key={p.id} data-jump role="button" tabIndex={0} className="cursor-pointer focus:outline-none [&:focus>rect]:stroke-gray-900 dark:[&:focus>rect]:stroke-white"
              onClick={() => onJump(p.start)} onKeyDown={keyJump(p.start)}
              aria-label={`${p.name}: ${fmt(p.start)} to ${fmt(p.end)}. Jump there`}>
              <title>{`${p.name}: ${fmt(p.start, true)} – ${fmt(p.end, true)}`}</title>
              <rect x={px1} y={y} width={pw} height={LANE_H} rx={4} fill={PHASE_COLORS[i % PHASE_COLORS.length]} strokeWidth={2} />
              <clipPath id={`tl-clip-${p.id}`}><rect x={px1} y={y} width={pw} height={LANE_H} /></clipPath>
              <text x={px1 + 6} y={y + 14} fontSize={11} fontWeight={600} fill="#ffffff" clipPath={`url(#tl-clip-${p.id})`}>{p.name}</text>
            </g>
          );
        })}

        {layout.milestones.map(m => {
          const mx = x(m.date);
          const labelY = msTop + 14 + m.labelRow * 13;
          const anchorEnd = mx > W - 160;
          return (
            <g key={m.id} data-jump role="button" tabIndex={0} className="cursor-pointer focus:outline-none"
              onClick={() => onJump(m.date)} onKeyDown={keyJump(m.date)} aria-label={`Milestone ${m.name}, ${fmt(m.date)}. Jump there`}>
              <title>{`${m.name} · ${fmt(m.date, true)}`}</title>
              <path d={`M${mx} ${msTop} l6 6 -6 6 -6 -6z`} className="fill-blue-600 dark:fill-blue-400" />
              <text x={anchorEnd ? mx - 9 : mx + 9} y={labelY} fontSize={10} textAnchor={anchorEnd ? 'end' : 'start'}
                className="fill-gray-800 dark:fill-gray-200">
                {(m.name.length > 28 ? `${m.name.slice(0, 27)}…` : m.name)} · {fmt(m.date)}
              </text>
            </g>
          );
        })}

        {todayIn && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={14} y2={H} stroke="#dc2626" strokeWidth={2} />
            <text x={x(today) + 4} y={22} fontSize={9} fontWeight={700} fill="#dc2626">Today</text>
          </g>
        )}
      </svg>
    </div>
  );
});

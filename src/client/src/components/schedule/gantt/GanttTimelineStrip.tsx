import React, { useMemo, useRef } from 'react';
import { layoutTimelineStrip, monthTicks, placeLabels, textWidth, StripTask } from './timelineStrip';

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
  const H = msTop + 32;
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
    <div id={TIMELINE_STRIP_ID} className="px-3 pt-1.5 pb-1 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      title="Click a phase or milestone to jump there; drag across the strip to scroll">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Project timeline from ${fmt(layout.start, true)} to ${fmt(layout.end, true)}`}
        className="block select-none cursor-grab touch-none"
        onPointerDown={startDrag}
      >
        <text x={PAD} y={11} fontSize={10} className="fill-gray-500 dark:fill-gray-400">{fmt(layout.start)}</text>
        <text x={W - PAD} y={11} fontSize={10} textAnchor="end" className="fill-gray-500 dark:fill-gray-400">{fmt(layout.end, true)}</text>
        {monthTicks(layout.start, layout.end).filter(m => x(m) > PAD + 50 && x(m) < W - PAD - 90).map(m => (
          <g key={m.toISOString()}>
            <line x1={x(m)} x2={x(m)} y1={14} y2={H} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={1} />
            <text x={x(m) + 3} y={11} fontSize={10} className="fill-gray-500 dark:fill-gray-400">
              {m.toLocaleDateString(undefined, m.getMonth() === 0 ? { month: 'short', year: 'numeric' } : { month: 'short' })}
            </text>
          </g>
        ))}

        {view && vx2 > vx1 && (
          <path d={`M${vx1} 14 v4 H${vx2} v-4`} fill="none" className="stroke-primary-500" strokeWidth={2} />
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
              {(() => {
                const full = `${p.name} · ${fmt(p.start)} – ${fmt(p.end)}`;
                const label = textWidth(full, 11) < pw - 12 ? full : textWidth(p.name, 11) < pw - 8 ? p.name : '';
                return label ? <text x={px1 + 6} y={y + 14} fontSize={11} fontWeight={600} fill="#ffffff" clipPath={`url(#tl-clip-${p.id})`}>{label}</text> : null;
              })()}
            </g>
          );
        })}

        {(() => {
          const labels = layout.milestones.map(m => {
            const text = m.names.length > 1 ? `${m.names.length} milestones · ${fmt(m.date)}` : `${m.names[0].length > 28 ? `${m.names[0].slice(0, 27)}…` : m.names[0]} · ${fmt(m.date)}`;
            const mx = x(m.date);
            return { m, mx, text, anchorEnd: mx > W - 160, width: textWidth(text, 10.5) };
          });
          const rows = placeLabels(
            labels.map(l => ({ x: l.anchorEnd ? l.mx - 9 : l.mx + 9, width: l.width, anchorEnd: l.anchorEnd })),
            2, 8,
            labels.map(l => ({ left: l.mx - 8, right: l.mx + 8 })), // each diamond, with a little room
          );
          return labels.map(({ m, mx, text, anchorEnd }, i) => (
            <g key={m.id} data-jump role="button" tabIndex={0} className="cursor-pointer focus:outline-none"
              onClick={() => onJump(m.date)} onKeyDown={keyJump(m.date)}
              aria-label={`Milestone${m.names.length > 1 ? 's' : ''} ${m.names.join(', ')}, ${fmt(m.date)}. Jump there`}>
              <title>{`${fmt(m.date, true)}\n${m.names.join('\n')}`}</title>
              <path d={`M${mx} ${msTop} l6 6 -6 6 -6 -6z`} className="fill-blue-600 dark:fill-blue-400" />
              {rows[i] !== null && (
                <text x={anchorEnd ? mx - 9 : mx + 9} y={msTop + 10 + (rows[i] as number) * 15} fontSize={10.5} textAnchor={anchorEnd ? 'end' : 'start'}
                  className="fill-gray-800 dark:fill-gray-200">{text}</text>
              )}
            </g>
          ));
        })()}

        {todayIn && (
          <g>
            <title>Today</title>
            <line x1={x(today)} x2={x(today)} y1={14} y2={H} stroke="#dc2626" strokeWidth={2} />
          </g>
        )}
      </svg>
    </div>
  );
});

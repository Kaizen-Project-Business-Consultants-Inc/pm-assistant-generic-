import React from 'react';
import { ROW_H, HEADER_H } from './types';

interface MinimapBar {
  key: string;
  x: number;
  w: number;
  y: number;
  h: number;
  fill: string;
}

interface GanttMinimapProps {
  minimapBars: MinimapBar[];
  timelineWidth: number;
  rowCount: number;
  scrollPos: { left: number; top: number };
  timelineRef: React.RefObject<HTMLDivElement | null>;
}

const MINIMAP_W = 200;
const MINIMAP_H = 80;

export const GanttMinimap = React.memo(function GanttMinimap({
  minimapBars,
  timelineWidth,
  rowCount,
  scrollPos,
  timelineRef,
}: GanttMinimapProps) {
  const contentH = HEADER_H + rowCount * ROW_H;
  const scaleX = MINIMAP_W / timelineWidth;
  const scaleY = MINIMAP_H / contentH;
  const el = timelineRef.current;
  const vpW = el ? el.clientWidth * scaleX : MINIMAP_W;
  const vpH = el ? el.clientHeight * scaleY : MINIMAP_H;
  const vpX = scrollPos.left * scaleX;
  const vpY = scrollPos.top * scaleY;

  const handleMinimapMouse = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const setScroll = (clientX: number, clientY: number) => {
      const tl = timelineRef.current;
      if (!tl) return;
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      tl.scrollLeft = (mx / MINIMAP_W) * timelineWidth - tl.clientWidth / 2;
      tl.scrollTop = (my / MINIMAP_H) * contentH - tl.clientHeight / 2;
    };
    setScroll(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => setScroll(ev.clientX, ev.clientY);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="sticky bottom-2 float-right mr-2 z-30 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg cursor-pointer print:hidden"
      style={{ width: MINIMAP_W, height: MINIMAP_H, marginTop: -MINIMAP_H - 12 }}
      onMouseDown={handleMinimapMouse}
    >
      <svg width={MINIMAP_W} height={MINIMAP_H}>
        {minimapBars.map(b => (
          <rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} opacity={0.7} rx={0.5} />
        ))}
        <rect
          x={Math.max(0, vpX)}
          y={Math.max(0, vpY)}
          width={Math.min(vpW, MINIMAP_W - Math.max(0, vpX))}
          height={Math.min(vpH, MINIMAP_H - Math.max(0, vpY))}
          fill="rgba(59,130,246,0.15)"
          stroke="#3b82f6"
          strokeWidth={1.5}
          rx={1}
        />
      </svg>
    </div>
  );
});

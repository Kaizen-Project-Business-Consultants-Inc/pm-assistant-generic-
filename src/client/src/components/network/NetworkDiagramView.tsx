import React, { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { apiService } from '../../services/api';

interface NetworkDiagramViewProps {
  scheduleId: string;
}

export function NetworkDiagramView({ scheduleId }: NetworkDiagramViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: any } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['network-diagram', scheduleId],
    queryFn: () => apiService.getNetworkDiagram(scheduleId),
    enabled: !!scheduleId,
  });

  const nodes: any[] = data?.nodes || [];
  const edges: any[] = data?.edges || [];
  const diagramWidth = data?.width || 800;
  const diagramHeight = data?.height || 400;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.max(0.2, Math.min(3, prev + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const padded = 40;
    const scaleX = (width - padded) / (diagramWidth + 100);
    const scaleY = (height - padded) / (diagramHeight + 100);
    setZoom(Math.min(scaleX, scaleY, 1.5));
    setPan({ x: 20, y: 20 });
  }, [diagramWidth, diagramHeight]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || nodes.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
        {error ? 'Failed to load network diagram' : 'No tasks with dependencies to display'}
      </div>
    );
  }

  const svgPadding = 50;
  const svgW = diagramWidth + svgPadding * 2;
  const svgH = diagramHeight + svgPadding * 2;

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700" title="Zoom In">
          <ZoomIn className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>
        <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700" title="Zoom Out">
          <ZoomOut className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>
        <button onClick={fitToScreen} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700" title="Fit to Screen">
          <Maximize2 className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{Math.round(zoom * 100)}%</span>

        {/* Legend */}
        <div className="flex items-center gap-4 ml-auto text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-3 rounded border-2 border-red-500 bg-red-50" />
            <span className="text-gray-600 dark:text-gray-400">Critical Path</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-3 rounded border-2 border-gray-300 dark:border-gray-500 bg-gray-50 dark:bg-gray-700" />
            <span className="text-gray-600 dark:text-gray-400">Non-Critical</span>
          </div>
        </div>
      </div>

      {/* Diagram */}
      <div
        ref={containerRef}
        className="overflow-hidden border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 cursor-grab active:cursor-grabbing"
        style={{ height: 500 }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          width={svgW * zoom}
          height={svgH * zoom}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <defs>
            <marker id="arrow-critical" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="#ef4444" />
            </marker>
            <marker id="arrow-normal" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="#9ca3af" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((edge: any, i: number) => {
            const fx = edge.fromX + svgPadding;
            const fy = edge.fromY + svgPadding;
            const tx = edge.toX + svgPadding;
            const ty = edge.toY + svgPadding;
            const midX = (fx + tx) / 2;
            const d = `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={edge.isCritical ? '#ef4444' : '#9ca3af'}
                strokeWidth={edge.isCritical ? 2.5 : 1.5}
                markerEnd={edge.isCritical ? 'url(#arrow-critical)' : 'url(#arrow-normal)'}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node: any) => {
            const nx = node.x + svgPadding;
            const ny = node.y + svgPadding;
            return (
              <g
                key={node.taskId}
                onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, node })}
                onMouseLeave={() => setTooltip(null)}
                className="cursor-pointer"
              >
                <rect
                  x={nx} y={ny}
                  width={node.width} height={node.height}
                  rx="8"
                  fill={node.isCritical ? '#fef2f2' : '#f9fafb'}
                  stroke={node.isCritical ? '#ef4444' : '#d1d5db'}
                  strokeWidth={node.isCritical ? 2 : 1}
                />
                <text x={nx + node.width / 2} y={ny + 20} textAnchor="middle" fontSize="11" fontWeight="600"
                  fill={node.isCritical ? '#991b1b' : '#374151'}>
                  {node.name.length > 22 ? node.name.slice(0, 22) + '...' : node.name}
                </text>
                <text x={nx + node.width / 2} y={ny + 38} textAnchor="middle" fontSize="9" fill="#6b7280">
                  Duration: {node.duration}d · Float: {node.totalFloat}d
                </text>
                <text x={nx + node.width / 2} y={ny + 52} textAnchor="middle" fontSize="9" fill="#9ca3af">
                  ES:{node.ES} EF:{node.EF} LS:{node.LS} LF:{node.LF}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg max-w-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}
        >
          <p className="font-semibold mb-1">{tooltip.node.name}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>Duration:</span><span>{tooltip.node.duration} days</span>
            <span>ES:</span><span>Day {tooltip.node.ES}</span>
            <span>EF:</span><span>Day {tooltip.node.EF}</span>
            <span>LS:</span><span>Day {tooltip.node.LS}</span>
            <span>LF:</span><span>Day {tooltip.node.LF}</span>
            <span>Float:</span><span>{tooltip.node.totalFloat} days</span>
          </div>
          {tooltip.node.isCritical && (
            <p className="mt-1 text-red-300 font-medium">On Critical Path</p>
          )}
        </div>
      )}
    </div>
  );
}

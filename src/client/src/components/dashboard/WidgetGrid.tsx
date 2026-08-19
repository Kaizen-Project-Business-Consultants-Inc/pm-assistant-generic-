import { useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import type { WidgetDef } from './WidgetRegistry';

interface WidgetGridProps {
  widgets: WidgetDef[];
  enabledIds: Set<string>;
  widgetOrder: string[];
  onReorder: (newOrder: string[]) => void;
  renderWidget: (id: string) => ReactNode;
}

export function WidgetGrid({ widgets, enabledIds, widgetOrder, onReorder, renderWidget }: WidgetGridProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const widgetMap = new Map(widgets.map(w => [w.id, w]));

  // Order widgets: use widgetOrder first, then append any enabled widgets not in order
  const orderedIds = widgetOrder.filter(id => enabledIds.has(id));
  for (const w of widgets) {
    if (enabledIds.has(w.id) && !orderedIds.includes(w.id)) {
      orderedIds.push(w.id);
    }
  }

  if (orderedIds.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">No widgets enabled. Click Customize to add widgets.</p>
      </div>
    );
  }

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setOverIdx(null); return; }
    const newOrder = [...orderedIds];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(dropIdx, 0, moved);
    onReorder(newOrder);
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  // Group consecutive 'third' widgets into rows
  const groups: { type: 'full' | 'third'; items: { id: string; flatIdx: number }[] }[] = [];
  orderedIds.forEach((id, flatIdx) => {
    const size = widgetMap.get(id)?.size || 'full';
    const last = groups[groups.length - 1];
    if (size === 'third' && last?.type === 'third' && last.items.length < 3) {
      last.items.push({ id, flatIdx });
    } else {
      groups.push({ type: size, items: [{ id, flatIdx }] });
    }
  });

  const renderDraggable = (id: string, flatIdx: number) => (
    <div
      key={id}
      draggable
      onDragStart={(e) => handleDragStart(e, flatIdx)}
      onDragOver={(e) => handleDragOver(e, flatIdx)}
      onDrop={(e) => handleDrop(e, flatIdx)}
      onDragEnd={handleDragEnd}
      className={`group relative transition-all ${dragIdx === flatIdx ? 'opacity-40' : ''} ${overIdx === flatIdx && dragIdx !== flatIdx ? 'ring-2 ring-primary-400 ring-offset-2 rounded-xl' : ''}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
        <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600" />
      </div>
      <div className="pl-6">
        {renderWidget(id)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => {
        if (group.type === 'third') {
          return (
            <div key={`row-${gi}`} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {group.items.map(({ id, flatIdx }) => renderDraggable(id, flatIdx))}
            </div>
          );
        }
        const { id, flatIdx } = group.items[0];
        return renderDraggable(id, flatIdx);
      })}
    </div>
  );
}

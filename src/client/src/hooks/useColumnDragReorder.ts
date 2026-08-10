import { useState, useCallback, useRef } from 'react';
import type { DragEvent } from 'react';

interface UseColumnDragReorderOptions<K extends string> {
  orderedKeys: K[];
  onReorder: (newOrder: K[]) => void;
  isFixed?: (key: K) => boolean;
}

interface UseColumnDragReorderReturn<K extends string> {
  dragColKey: K | null;
  overColKey: K | null;
  isDraggable: (key: K) => boolean;
  handleDragStart: (e: DragEvent, key: K) => void;
  handleDragOver: (e: DragEvent, key: K) => void;
  handleDrop: (e: DragEvent, key: K) => void;
  handleDragEnd: () => void;
}

export function useColumnDragReorder<K extends string>({
  orderedKeys,
  onReorder,
  isFixed,
}: UseColumnDragReorderOptions<K>): UseColumnDragReorderReturn<K> {
  const [dragColKey, setDragColKey] = useState<K | null>(null);
  const [overColKey, setOverColKey] = useState<K | null>(null);
  const dragKeyRef = useRef<K | null>(null);

  const isDraggable = useCallback(
    (key: K) => !(isFixed?.(key) ?? false),
    [isFixed],
  );

  const handleDragStart = useCallback(
    (e: DragEvent, key: K) => {
      if (!isDraggable(key)) {
        e.preventDefault();
        return;
      }
      dragKeyRef.current = key;
      setDragColKey(key);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    },
    [isDraggable],
  );

  const handleDragOver = useCallback(
    (e: DragEvent, key: K) => {
      if (!dragKeyRef.current || !isDraggable(key)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOverColKey(key);
    },
    [isDraggable],
  );

  const handleDrop = useCallback(
    (e: DragEvent, _key: K) => {
      e.preventDefault();
      const from = dragKeyRef.current;
      const to = overColKey;
      if (!from || !to || from === to) {
        setDragColKey(null);
        setOverColKey(null);
        dragKeyRef.current = null;
        return;
      }
      const newOrder = [...orderedKeys];
      const fromIdx = newOrder.indexOf(from);
      const toIdx = newOrder.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) {
        setDragColKey(null);
        setOverColKey(null);
        dragKeyRef.current = null;
        return;
      }
      newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, from);
      onReorder(newOrder);
      setDragColKey(null);
      setOverColKey(null);
      dragKeyRef.current = null;
    },
    [orderedKeys, overColKey, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDragColKey(null);
    setOverColKey(null);
    dragKeyRef.current = null;
  }, []);

  return {
    dragColKey,
    overColKey,
    isDraggable,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  };
}

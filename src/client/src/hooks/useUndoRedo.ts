import { useState, useEffect, useCallback, useRef } from 'react';

export interface UndoAction {
  description: string;
  undo: () => void;
  redo: () => void;
}

const MAX_STACK = 50;

export function useUndoRedo() {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  // Use ref to avoid stale closures in the keyboard handler
  const undoRef = useRef(undoStack);
  const redoRef = useRef(redoStack);
  undoRef.current = undoStack;
  redoRef.current = redoStack;

  const pushAction = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-(MAX_STACK - 1)), action]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    const stack = undoRef.current;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    action.undo();
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);
  }, []);

  const redo = useCallback(() => {
    const stack = redoRef.current;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    action.redo();
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, action]);
  }, []);

  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Allow Ctrl+Z/Y through when a checkbox is focused (e.g. after multi-select indent)
      const isCheckbox = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox';
      if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') && !isCheckbox) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoDescription: undoStack.length > 0 ? undoStack[undoStack.length - 1].description : '',
    redoDescription: redoStack.length > 0 ? redoStack[redoStack.length - 1].description : '',
    pushAction,
    undo,
    redo,
  };
}

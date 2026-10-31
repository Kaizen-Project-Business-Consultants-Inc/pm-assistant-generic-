import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/**
 * Keyboard for the schedule's right-click menus: the focus goes onto the first item when the menu
 * opens, Arrow Up / Down / Home / End move between the items (role="menuitem"), Tab closes it
 * (and is not passed on, so the focus does not jump somewhere else). (Escape closes it in the owner.)
 * When the menu closes after the keyboard was used in it, the focus goes back to where it was before
 * (else the task grid), which also puts the grid back in keyboard mode. Returns the menu's onKeyDown.
 */
export function useMenuKeyboard(menuRef: RefObject<HTMLElement>, onClose: () => void) {
  const before = useRef<Element | null>(null);
  const usedKeyboard = useRef(false);
  useEffect(() => {
    before.current = document.activeElement;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      if (!usedKeyboard.current) return;
      const prev = before.current;
      const target = prev instanceof HTMLElement && prev.isConnected && prev !== document.body
        ? prev
        : document.querySelector<HTMLElement>('[role="treegrid"]');
      target?.focus({ preventScroll: true });
    };
  }, [menuRef]);
  return (e: KeyboardEvent<HTMLElement>) => {
    usedKeyboard.current = true;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
  };
}

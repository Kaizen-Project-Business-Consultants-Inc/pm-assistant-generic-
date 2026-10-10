import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], summary, [contenteditable], iframe, audio[controls], video[controls]';

/** Query focusable elements and filter out hidden/disabled ones. */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hidden || el.closest('[hidden]')) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    // offsetParent is null for display:none or visibility:hidden ancestors
    if (el.offsetParent === null && el.style.position !== 'fixed') return false;
    return true;
  });
}

/**
 * Inert is reference-counted per element, so a dialog opened from another dialog
 * (e.g. a confirm over a form) does not wake the page when the inner one closes.
 */
interface InertHold { count: number; inert: string | null; ariaHidden: string | null }
const inertHolds = new Map<HTMLElement, InertHold>();

function holdInert(el: HTMLElement): void {
  const hold = inertHolds.get(el);
  if (hold) { hold.count += 1; return; }
  // Remember what the element had before (e.g. the closed phone menu drawer is already inert)
  inertHolds.set(el, { count: 1, inert: el.getAttribute('inert'), ariaHidden: el.getAttribute('aria-hidden') });
  el.setAttribute('inert', '');
  el.setAttribute('aria-hidden', 'true');
}

function restoreAttr(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

function releaseInert(el: HTMLElement): void {
  const hold = inertHolds.get(el);
  if (!hold) return;
  hold.count -= 1;
  if (hold.count > 0) return;
  inertHolds.delete(el);
  // Put back exactly what was there, so a dialog never wakes something that was inert already
  restoreAttr(el, 'inert', hold.inert);
  restoreAttr(el, 'aria-hidden', hold.ariaHidden);
}

/**
 * Manages modal accessibility: focus trap, Escape-to-close, focus restoration.
 * Attach the returned ref to the dialog container element.
 */
export function useModal(isOpen: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Capture the element that was focused before the modal opened
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
      // Move focus into the dialog on next tick (after render)
      const timer = setTimeout(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const first = getFocusableElements(dialog)[0];
        if (first) first.focus();
        else dialog.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
        // Restore focus if component unmounts while modal is open
        const trigger = triggerRef.current as HTMLElement | null;
        if (trigger && typeof trigger.focus === 'function') {
          trigger.focus();
        }
      };
    } else {
      // Restore focus to the trigger element
      const trigger = triggerRef.current as HTMLElement | null;
      if (trigger && typeof trigger.focus === 'function') {
        trigger.focus();
      }
      triggerRef.current = null;
    }
  }, [isOpen]);

  // Gap A: Mark the page behind the dialog inert so screen readers cannot browse it and
  // Tab cannot reach it: #main-content plus the app chrome tagged data-modal-background
  // (sidebar, top bar, banners, AI panel). The live region #sr-announcements is left alone
  // so announcements still reach screen readers while a dialog is open.
  // Only safe when the dialog lives outside #main-content (e.g. AccessibleModal, which
  // portals to document.body). Modals rendered inline inside the page tree would be
  // frozen along with the page — inert blocks clicks and focus for the dialog itself.
  useEffect(() => {
    if (!isOpen) return;
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
    const dialog = dialogRef.current;
    if (!dialog || mainContent.contains(dialog)) return;

    const targets = [mainContent, ...Array.from(document.querySelectorAll<HTMLElement>('[data-modal-background]'))]
      .filter((el) => !el.contains(dialog));
    targets.forEach(holdInert);
    return () => targets.forEach(releaseInert);
  }, [isOpen]);

  // Gap B: Document-level Escape listener (defense in depth — works even if focus escapes the dialog)
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Escape key and focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  return { dialogRef, handleKeyDown };
}

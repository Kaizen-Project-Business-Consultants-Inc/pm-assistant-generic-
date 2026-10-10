import React, { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../../hooks/useModal';

interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible name. Prefer `labelledBy` (the id of the dialog's visible heading) when there is one. */
  ariaLabel?: string;
  /** id of the element that names the dialog (usually its heading). */
  labelledBy?: string;
  /** id of the element that describes the dialog (optional). */
  describedBy?: string;
  /** While true (saving), Escape and a backdrop click do not close the dialog, and it is aria-busy. */
  busy?: boolean;
  /** While true, Escape and a backdrop click do not close the dialog (e.g. unsaved edits) — not announced as busy. */
  preventClose?: boolean;
  /** Close when the dimmed backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
  /** Classes for the dialog panel itself. */
  className?: string;
  /** Classes for the full-screen layer: z-index and how the panel is positioned. */
  overlayClassName?: string;
  /** Classes for the dimmed backdrop (add `fixed` when the overlay scrolls). */
  backdropClassName?: string;
  /** For dialogs that accept a pasted image (Feedback). */
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}

/**
 * The one accessible dialog for the app: role="dialog" + aria-modal, named by its
 * heading (aria-labelledby) or aria-label, focus moved in on open and trapped while
 * open, Escape closes (unless busy), focus returns to the opener on close, and the
 * page behind is inert/aria-hidden (see useModal). Portals to document.body.
 *
 * Renders the backdrop + dialog container. Children go inside the dialog.
 */
export const AccessibleModal: React.FC<AccessibleModalProps> = ({
  isOpen,
  onClose,
  ariaLabel,
  labelledBy,
  describedBy,
  busy = false,
  preventClose = false,
  closeOnBackdrop = true,
  className = '',
  overlayClassName = 'z-50 flex items-center justify-center',
  backdropClassName = 'bg-black/50',
  onPaste,
  children,
}) => {
  const requestClose = useCallback(() => {
    if (!busy && !preventClose) onClose();
  }, [busy, preventClose, onClose]);
  const { dialogRef, handleKeyDown } = useModal(isOpen, requestClose);

  if (!isOpen) return null;

  return createPortal(
    <div className={`fixed inset-0 ${overlayClassName}`}>
      <div
        className={`${/\bfixed\b/.test(backdropClassName) ? '' : 'absolute '}inset-0 ${backdropClassName}`}
        onClick={closeOnBackdrop ? requestClose : undefined}
        aria-hidden="true"
      />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        tabIndex={-1}
        className={`relative ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

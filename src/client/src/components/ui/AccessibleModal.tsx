import React from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../../hooks/useModal';

interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Accessible modal wrapper — provides role="dialog", aria-modal, aria-label,
 * focus trap, Escape-to-close, and focus restoration.
 *
 * Renders the backdrop + dialog container. Children go inside the dialog.
 */
export const AccessibleModal: React.FC<AccessibleModalProps> = ({
  isOpen,
  onClose,
  ariaLabel,
  children,
  className = '',
}) => {
  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        className={`relative ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

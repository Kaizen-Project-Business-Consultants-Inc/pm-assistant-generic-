import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useModal } from '../../hooks/useModal';

/** Dialog rendered inline — ends up inside whatever tree it is mounted in. */
function InlineDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);
  if (!isOpen) return null;
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" onKeyDown={handleKeyDown} tabIndex={-1}>
      <button type="button">Inline action</button>
    </div>
  );
}

/** Dialog portaled to document.body — the AccessibleModal pattern. */
function PortalDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);
  if (!isOpen) return null;
  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" onKeyDown={handleKeyDown} tabIndex={-1}>
      <button type="button">Portal action</button>
    </div>,
    document.body,
  );
}

describe('useModal', () => {
  let main: HTMLElement;

  beforeEach(() => {
    main = document.createElement('main');
    main.id = 'main-content';
    document.body.appendChild(main);
  });

  afterEach(() => {
    cleanup();
    main.remove();
  });

  it('marks #main-content inert while a portaled dialog is open, and clears it on close', () => {
    const { rerender } = render(<PortalDialog isOpen onClose={() => {}} />, { container: main });
    expect(main.hasAttribute('inert')).toBe(true);
    expect(main.getAttribute('aria-hidden')).toBe('true');

    rerender(<PortalDialog isOpen={false} onClose={() => {}} />);
    expect(main.hasAttribute('inert')).toBe(false);
    expect(main.hasAttribute('aria-hidden')).toBe(false);
  });

  it('does not mark #main-content inert when the dialog renders inline inside it', () => {
    render(<InlineDialog isOpen onClose={() => {}} />, { container: main });
    expect(main.hasAttribute('inert')).toBe(false);
    expect(main.hasAttribute('aria-hidden')).toBe(false);
  });

  it('keeps an inline dialog clickable while open', () => {
    const onClick = vi.fn();
    function ClickableInline() {
      const { dialogRef, handleKeyDown } = useModal(true, () => {});
      return (
        <div ref={dialogRef} role="dialog" onKeyDown={handleKeyDown} tabIndex={-1}>
          <button type="button" onClick={onClick}>Create project</button>
        </div>
      );
    }
    const { getByText } = render(<ClickableInline />, { container: main });
    fireEvent.click(getByText('Create project'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(main.hasAttribute('inert')).toBe(false);
  });

  it('does nothing when #main-content is absent', () => {
    main.remove();
    expect(() => render(<PortalDialog isOpen onClose={() => {}} />)).not.toThrow();
  });

  it('closes on Escape from the document level', () => {
    const onClose = vi.fn();
    render(<InlineDialog isOpen onClose={onClose} />, { container: main });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

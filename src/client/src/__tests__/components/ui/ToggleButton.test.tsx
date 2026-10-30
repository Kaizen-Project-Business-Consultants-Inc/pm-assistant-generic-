import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToggleButton, TOGGLE_ON_CLASS } from '../../../components/ui/ToggleButton';

// Colours come from the real Tailwind config, so a palette change that breaks contrast fails here.
const config = readFileSync(join(__dirname, '../../../../tailwind.config.js'), 'utf8');
function shade(ramp: string, step: string): string {
  const block = config.slice(config.indexOf(`${ramp}: {`));
  const m = block.match(new RegExp(`\\b${step}:\\s*'(#[0-9a-fA-F]{6})'`));
  if (!m) throw new Error(`${ramp}-${step} not found in tailwind.config.js`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('ToggleButton', () => {
  it('is filled and ticked when on, plain when off', () => {
    const { rerender, container } = render(<ToggleButton on onClick={() => {}}>Review</ToggleButton>);
    const btn = screen.getByRole('button', { name: 'Review' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn.className).toContain('bg-primary-600');
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<ToggleButton on={false} onClick={() => {}}>Review</ToggleButton>);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.className).not.toContain('bg-primary-600');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('calls onClick, and not when disabled', () => {
    const fn = vi.fn();
    const { rerender } = render(<ToggleButton on={false} onClick={fn}>Go</ToggleButton>);
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledOnce();
    rerender(<ToggleButton on={false} onClick={fn} disabled>Go</ToggleButton>);
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledOnce();
    expect(screen.getByRole('button').className).toContain('disabled:opacity-50');
  });

  it('size sm is compact', () => {
    render(<ToggleButton on={false} size="sm" onClick={() => {}}>S</ToggleButton>);
    expect(screen.getByRole('button').className).toContain('px-2 py-1');
  });

  it('keeps 4.5:1 text contrast in both themes', () => {
    expect(TOGGLE_ON_CLASS).toContain('bg-primary-600');
    expect(TOGGLE_ON_CLASS).toContain('text-white');
    expect(ratio('#ffffff', shade('primary', '600'))).toBeGreaterThanOrEqual(4.5);
    expect(TOGGLE_ON_CLASS).toContain('dark:bg-primary-400');
    expect(TOGGLE_ON_CLASS).toContain('dark:text-gray-950');
    expect(ratio(shade('gray', '950'), shade('primary', '400'))).toBeGreaterThanOrEqual(4.5);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportTasksCSV } from '../../utils/exportUtils';

describe('exportTasksCSV', () => {
  let text = '';
  beforeEach(() => {
    text = '';
    vi.stubGlobal('Blob', class { constructor(parts: string[]) { text = parts.join(''); } });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('writes the person\'s name, not the stored id', () => {
    const names = new Map([['u-1', 'Ana Silva']]);
    exportTasksCSV([{ name: 'T', assignedTo: 'u-1' }], 'plan', names);
    expect(text.split('\r\n')[1].split(',')[3]).toBe('Ana Silva');
  });

  it('keeps the stored value when the person is unknown, and blank when unassigned', () => {
    exportTasksCSV([{ name: 'A', assignedTo: 'gone' }, { name: 'B' }], 'plan', new Map());
    const rows = text.split('\r\n');
    expect(rows[1].split(',')[3]).toBe('gone');
    expect(rows[2].split(',')[3]).toBe('');
  });
});

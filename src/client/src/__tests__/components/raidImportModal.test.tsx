import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

/** RAID import (UAT 2026-10-17: "no file is uploaded"): a real Choose file button, problems shown before a preview exists, the same file pickable twice. */
vi.mock('../../services/api', () => ({ apiService: { importRaidItems: vi.fn() } }));

import { RAIDImportModal } from '../../components/raids/RAIDImportModal';

const input = () => screen.getByLabelText('Choose a file to import') as HTMLInputElement;
const pick = (file: File) => fireEvent.change(input(), { target: { files: [file] } });
const PREVIEW = /Preview \(first \d+ of \d+ rows\)/;

describe('RAIDImportModal file pick', () => {
  afterEach(cleanup);

  it('has a real Choose file button that opens the picker', () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    const click = vi.spyOn(input(), 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('says plainly when a file type cannot be imported (before any preview)', () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    pick(new File(['x'], 'Risks register.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('alert').textContent).toBe('"Risks register.pdf" can\'t be imported. Choose an Excel (.xlsx, .xls, .xlsb) or CSV (.csv, .txt) file.');
  });

  it('shows a too-large file at once and clears the picker so the same file can be chosen again', () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    const big = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    let cleared = false;
    Object.defineProperty(input(), 'value', {
      configurable: true,
      get: () => (cleared ? '' : 'C:\\fakepath\\big.csv'),
      set: (v: string) => { if (v === '') cleared = true; },
    });
    pick(big);
    expect(screen.getByRole('alert').textContent).toMatch(/File too large/);
    expect(cleared).toBe(true);
  });

  it('says so when the browser cannot read the file', async () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    const orig = FileReader.prototype.readAsText;
    FileReader.prototype.readAsText = function (this: FileReader) {
      setTimeout(() => this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>), 0);
    };
    try {
      pick(new File(['x'], 'raid.csv', { type: 'text/csv' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Couldn't read "raid.csv"/));
    } finally {
      FileReader.prototype.readAsText = orig;
    }
  });

  it('reads a CSV with no file type (common on Windows) into the preview', async () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    pick(new File(['Type,Title\nRisk,Vendor late\n'], 'raid.csv', { type: '' }));
    await waitFor(() => expect(document.body.textContent).toMatch(PREVIEW));
  });

  it('reads a CSV into the preview', async () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    pick(new File(['Type,Title\nRisk,Vendor late\n'], 'raid.csv', { type: 'text/csv' }));
    await waitFor(() => expect(document.body.textContent).toMatch(PREVIEW));
  });
});

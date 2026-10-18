import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

/** RAID import (UAT 2026-10-17: "no file is uploaded"): a real Choose file button, problems shown before a preview exists, the same file pickable twice. */
const importRaidItems = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ apiService: { importRaidItems } }));

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
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    let cleared = false;
    Object.defineProperty(input(), 'value', {
      configurable: true,
      get: () => (cleared ? '' : 'C:\\fakepath\\big.csv'),
      set: (v: string) => { if (v === '') cleared = true; },
    });
    pick(big);
    expect(screen.getByRole('alert').textContent).toBe('"big.csv" is 11.0 MB. Excel files can be up to 25 MB and CSV files up to 10 MB — split the register or save just the RAID sheet.');
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

/** UAT U39: a 5.4 MB .xlsx was refused although its RAID rows were small — judge what is sent. */
describe('RAIDImportModal size limits', () => {
  afterEach(() => { cleanup(); importRaidItems.mockReset(); });
  const sized = (name: string, type: string, mb: number) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: mb * 1024 * 1024 });
    return f;
  };
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const pasteAndParse = (text: string) => {
    fireEvent.change(screen.getByLabelText('or paste CSV below'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /Parse CSV/ }));
  };

  it('accepts a 6 MB Excel file (it is read, not refused for its size)', () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => {});
    try {
      pick(sized('Register.xlsx', XLSX_TYPE, 6));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);
    } finally { read.mockRestore(); }
  });

  it('refuses an Excel file over 25 MB with a plain message', () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    pick(sized('Huge.xlsx', XLSX_TYPE, 26));
    expect(screen.getByRole('alert').textContent).toMatch(/^"Huge.xlsx" is 26.0 MB. Excel files can be up to 25 MB/);
  });

  it('refuses a sheet whose text is over the server limit before sending it', async () => {
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    pasteAndParse(`Type,Title\nRisk,${'x'.repeat(2_000_001)}`);
    const go = await screen.findByRole('button', { name: /Import 1 rows/ });
    // said as soon as it loads, before any column matching
    expect(screen.getByRole('alert').textContent).toBe('This register is too big to import at once — split it or import one sheet at a time.');
    await waitFor(() => expect(go).not.toBeDisabled());
    fireEvent.click(go);
    expect(screen.getByRole('alert').textContent).toBe('This register is too big to import at once — split it or import one sheet at a time.');
    expect(importRaidItems).not.toHaveBeenCalled();
  });

  it('Import All Sheets: a sheet over the limit is not sent and says why; the others import', async () => {
    importRaidItems.mockResolvedValue({ data: { succeeded: 1, failed: [] } });
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Title', 'Owner', 'Notes'], ...Array.from({ length: 70 }, (_, i) => [`Risk ${i}`, 'Pat', 'x'.repeat(30_000)])]), 'Risks');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Title', 'Owner', 'Severity'], ['Server down', 'Pat', 'High'], ['Vendor late', 'Sam', 'Low']]), 'Issues');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    pick(new File([bytes], 'Register.xlsx', { type: XLSX_TYPE }));
    fireEvent.click(await screen.findByRole('button', { name: /Import All Sheets \(2\)/ }, { timeout: 10_000 }));
    await screen.findByText('Multi-tab import complete', undefined, { timeout: 10_000 });
    expect(importRaidItems).toHaveBeenCalledTimes(1);
    expect(importRaidItems.mock.calls[0][3]).toBe('issue');
    expect(document.body.textContent).toContain('This register is too big to import at once — split it or import one sheet at a time.');
  }, 30_000);

  it('a 413 from the server shows the same plain message', async () => {
    importRaidItems.mockRejectedValue({ response: { status: 413, data: '<html>413</html>' } });
    render(<RAIDImportModal isOpen onClose={() => {}} projectId="p1" />);
    pasteAndParse('Type,Title\nRisk,Vendor late');
    const go = await screen.findByRole('button', { name: /Import 1 rows/ });
    await waitFor(() => expect(go).not.toBeDisabled());
    fireEvent.click(go);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This register is too big to import at once — split it or import one sheet at a time.'));
  });
});

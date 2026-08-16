import React, { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiService } from '../../services/api';
import { cleanCsvForImport, sheetToCsv } from '../../utils/csvCleaner';
import { parseMspdi } from '../../utils/mspdiParser';
import { useModal } from '../../hooks/useModal';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  scheduleId: string;
  onImported?: () => void;
}

interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

interface ImportResult {
  succeeded: number;
  failed: { row: number; error: string }[];
  resourcesCreated?: number;
}

const TARGET_COLUMNS = [
  { value: '', label: '-- skip --' },
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'startDate', label: 'Start Date' },
  { value: 'endDate', label: 'End Date' },
  { value: 'assignedTo', label: 'Assigned To' },
  { value: 'progressPercentage', label: 'Progress %' },
  { value: 'estimatedDurationHours', label: 'Est. Duration (hrs)' },
  { value: 'description', label: 'Description' },
] as const;

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function parseCSV(text: string): ParsedCSV {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };

  const split = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function autoMap(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {};
  const aliases: Record<string, string> = {
    name: 'name', title: 'name', task: 'name',
    status: 'status', state: 'status',
    priority: 'priority',
    start: 'startDate', startdate: 'startDate', start_date: 'startDate',
    end: 'endDate', enddate: 'endDate', end_date: 'endDate', due: 'endDate', duedate: 'endDate', due_date: 'endDate',
    assigned: 'assignedTo', assignedto: 'assignedTo', assigned_to: 'assignedTo', owner: 'assignedTo', assignee: 'assignedTo',
    progress: 'progressPercentage', progresspercentage: 'progressPercentage', percent: 'progressPercentage',
    duration: 'estimatedDurationHours', estimateddurationhours: 'estimatedDurationHours', hours: 'estimatedDurationHours',
    description: 'description', desc: 'description', notes: 'description',
  };
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = aliases[key];
    if (target && !used.has(target)) {
      map[i] = target;
      used.add(target);
    }
  });
  return map;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportModal({ isOpen, onClose, scheduleId, onImported }: ImportModalProps) {
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<ParsedCSV | null>(null);
  const [columnMap, setColumnMap] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCsvText('');
    setParsed(null);
    setColumnMap({});
    setResult(null);
    setError('');
    setSheetNames([]);
    setSelectedSheet('');
    workbookRef.current = null;
  };

  const handleClose = () => { reset(); onClose(); };

  const loadText = useCallback((text: string) => {
    setCsvText(text);
    setResult(null);
    setError('');
    const p = parseCSV(text);
    if (p.headers.length === 0) { setError('CSV appears empty.'); setParsed(null); return; }
    setParsed(p);
    setColumnMap(autoMap(p.headers));
  }, []);

  const isExcelFile = (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();
    return ext === 'xlsx' || ext === 'xls' || ext === 'xlsb' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
  };

  const handleFile = (file: File) => {
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`);
      return;
    }

    const ext = file.name.toLowerCase().split('.').pop();

    // Handle MS Project XML (.xml)
    if (ext === 'xml') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const xmlText = (e.target?.result as string) ?? '';
          const mspdiTasks = parseMspdi(xmlText);
          if (mspdiTasks.length === 0) { setError('No tasks found in XML file.'); return; }
          setImporting(true);
          const res = await apiService.importStructured(scheduleId, mspdiTasks);
          setResult({ succeeded: res.succeeded ?? 0, failed: res.failed ?? [] });
          if ((res.succeeded ?? 0) > 0) onImported?.();
        } catch (err: unknown) {
          setError(getApiErrorMessage(err, 'Failed to parse XML file'));
        } finally {
          setImporting(false);
        }
      };
      reader.readAsText(file);
      return;
    }

    if (isExcelFile(file)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          if (workbook.SheetNames.length === 0) { setError('Excel file has no sheets.'); return; }

          if (workbook.SheetNames.length > 1) {
            // Store workbook and show sheet selector
            workbookRef.current = workbook;
            setSheetNames(workbook.SheetNames);
            setSelectedSheet(workbook.SheetNames[0]);
          } else {
            const csv = sheetToCsv(XLSX, workbook.Sheets[workbook.SheetNames[0]]);
            loadText(cleanCsvForImport(csv));
          }
        } catch (err: unknown) {
          setError(getApiErrorMessage(err, 'Failed to parse Excel file'));
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => loadText(cleanCsvForImport((e.target?.result as string) ?? ''));
      reader.readAsText(file);
    }
  };

  const handleSheetSelect = (name: string) => {
    setSelectedSheet(name);
    if (workbookRef.current) {
      const csv = sheetToCsv(XLSX, workbookRef.current.Sheets[name]);
      loadText(cleanCsvForImport(csv));
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!parsed) return;
    setImporting(true);
    setError('');
    try {
      // Convert index-based columnMap to header-name-based for the server
      const headerMap: Record<string, string> = {};
      for (const [idx, field] of Object.entries(columnMap)) {
        if (field && parsed.headers[Number(idx)]) {
          headerMap[parsed.headers[Number(idx)]] = field;
        }
      }
      const res = await apiService.importTasks(scheduleId, csvText, headerMap);
      const data = res?.data ?? res;
      setResult({ succeeded: data.succeeded ?? 0, failed: data.failed ?? [], resourcesCreated: data.resourcesCreated ?? 0 });
      if ((data.succeeded ?? 0) > 0) onImported?.();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);

  if (!isOpen) return null;

  const previewRows = parsed?.rows.slice(0, 10) ?? [];
  const mappedCount = Object.values(columnMap).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Import Tasks" onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import Tasks from CSV / Excel / XML</h2>
          <button onClick={handleClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Result summary */}
          {result && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm font-medium">
                {result.succeeded} task{result.succeeded !== 1 ? 's' : ''} imported successfully.
                {result.resourcesCreated ? ` ${result.resourcesCreated} resource${result.resourcesCreated !== 1 ? 's' : ''} added.` : ''}
              </div>
              {result.failed.length > 0 && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-sm space-y-1">
                  <p className="font-medium">{result.failed.length} row{result.failed.length !== 1 ? 's' : ''} failed:</p>
                  <ul className="list-disc list-inside">
                    {result.failed.map((f, i) => (
                      <li key={i}>Row {f.row}: {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button onClick={reset} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Import more</button>
            </div>
          )}

          {/* Input area (hidden after results) */}
          {!result && (
            <>
              {/* File drop zone */}
              {!parsed && (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                      dragOver
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                    }`}
                  >
                    <Upload size={32} className="text-gray-400 dark:text-gray-500" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">Drag & drop a CSV, Excel, or MS Project XML file here, or click to browse</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">.csv, .xlsx, .xls, .xml supported (max 5MB)</p>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xml,text/csv,text/xml,application/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex-1 border-t dark:border-gray-700" />or paste CSV below<span className="flex-1 border-t dark:border-gray-700" />
                  </div>

                  <textarea
                    rows={5}
                    placeholder="name,status,priority,startDate,endDate&#10;Task A,not_started,high,2026-07-01,2026-07-15"
                    className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 p-3 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y"
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                  />
                  <button
                    disabled={!csvText.trim()}
                    onClick={() => loadText(csvText)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <FileText size={16} /> Parse CSV
                  </button>
                </>
              )}

              {/* Sheet selector for multi-sheet Excel files */}
              {sheetNames.length > 1 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Sheet</h3>
                  <select
                    value={selectedSheet}
                    onChange={(e) => handleSheetSelect(e.target.value)}
                    className="text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 w-full"
                  >
                    {sheetNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Column mapping & preview */}
              {parsed && (
                <>
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Column Mapping ({mappedCount} mapped)</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {parsed.headers.map((h, i) => (
                        <div key={i} className="flex flex-col gap-1">
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate" title={h}>{h}</span>
                          <select
                            value={columnMap[i] ?? ''}
                            onChange={(e) => setColumnMap((m) => ({ ...m, [i]: e.target.value }))}
                            className="text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1"
                          >
                            {TARGET_COLUMNS.map((c) => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Preview table */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Preview (first {Math.min(previewRows.length, 10)} of {parsed.rows.length} rows)
                    </h3>
                    <div className="overflow-x-auto border dark:border-gray-700 rounded-lg">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700">
                            {parsed.headers.map((h, i) => (
                              <th key={i} className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                {h}
                                {columnMap[i] && <span className="ml-1 text-blue-500">({TARGET_COLUMNS.find((c) => c.value === columnMap[i])?.label})</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, ri) => (
                            <tr key={ri} className="border-t dark:border-gray-700 even:bg-gray-50 dark:even:bg-gray-700">
                              {parsed.headers.map((_, ci) => (
                                <td key={ci} className="px-3 py-1.5 text-gray-800 dark:text-gray-200 whitespace-nowrap max-w-[200px] truncate">
                                  {row[ci] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

                  {/* Actions */}
                  <div className="flex items-center justify-between">
                    <button onClick={reset} className="text-sm text-gray-500 dark:text-gray-400 hover:underline">Back</button>
                    <button
                      disabled={importing || mappedCount === 0}
                      onClick={handleImport}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {importing ? 'Importing…' : `Import ${parsed.rows.length} rows`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

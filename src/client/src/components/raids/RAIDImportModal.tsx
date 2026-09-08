import React, { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiService } from '../../services/api';
import { cleanCsvForImport, sheetToCsv, escapeCsvCell } from '../../utils/csvCleaner';
import { ColumnMapper } from '../schedule/ColumnMapper';
import { useModal } from '../../hooks/useModal';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

// ---------------------------------------------------------------------------
// RAID-specific column mapping config
// ---------------------------------------------------------------------------

const RAID_TARGET_COLUMNS = [
  { value: '', label: '-- skip --' },
  { value: 'type', label: 'Type (R/I/A/D/AS/DP)' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'category', label: 'Category' },
  { value: 'severity', label: 'Severity' },
  { value: 'probability', label: 'Probability' },
  { value: 'impact', label: 'Impact' },
  { value: 'status', label: 'Status' },
  { value: 'owner', label: 'Owner' },
  { value: 'mitigationPlan', label: 'Mitigation Plan' },
  { value: 'responsePlan', label: 'Response Plan' },
  { value: 'triggerCondition', label: 'Trigger Condition' },
  { value: 'dueDate', label: 'Due Date' },
  { value: 'actionType', label: 'Action Type' },
  { value: 'rationale', label: 'Rationale' },
  { value: 'rootCause', label: 'Root Cause' },
  { value: 'workaround', label: 'Workaround' },
  { value: 'validationPlan', label: 'Validation Plan' },
  { value: 'dependentEntity', label: 'Dependent Entity' },
  { value: 'forum', label: 'Forum' },
  { value: 'sourceMeeting', label: 'Source Meeting' },
] as const;

const RAID_ALIASES: Record<string, string> = {
  type: 'type', raidtype: 'type', itemtype: 'type', recordtype: 'type',
  title: 'title', name: 'title', item: 'title', risktitle: 'title',
  riskissuetitle: 'title', issuetitle: 'title', actiontitle: 'title',
  decisiontitle: 'title', assumptiontitle: 'title', dependencytitle: 'title',
  riskissue: 'title', riskissuedescription: 'title',
  description: 'description', details: 'description', notes: 'description', comments: 'description',
  riskdescription: 'title', issuedescription: 'title',
  actiondescription: 'title', decisiondescription: 'title',
  assumptiondescription: 'title', dependencydescription: 'title',
  category: 'category', area: 'category', domain: 'category',
  severity: 'severity', priority: 'severity', rating: 'severity', level: 'severity',
  risklevel: 'severity', riskrating: 'severity',
  probability: 'probability', likelihood: 'probability', prob: 'probability',
  l: 'probability', p: 'probability',
  impact: 'impact', consequence: 'impact', effect: 'impact',
  c: 'impact', i: 'impact',
  status: 'status', state: 'status', currentstatus: 'status',
  owner: 'owner', assignedto: 'owner', responsible: 'owner', riskowner: 'owner', assignee: 'owner',
  issueowner: 'owner', actionowner: 'owner', actionee: 'owner', responsibleperson: 'owner',
  mitigation: 'mitigationPlan', mitigationplan: 'mitigationPlan', response: 'mitigationPlan', treatment: 'mitigationPlan',
  mitigationstrategy: 'mitigationPlan', mitigationaction: 'mitigationPlan',
  responseplan: 'responsePlan', contingency: 'responsePlan', contingencyplan: 'responsePlan',
  trigger: 'triggerCondition', triggercondition: 'triggerCondition', triggerevent: 'triggerCondition',
  duedate: 'dueDate', deadline: 'dueDate', targetdate: 'dueDate', due: 'dueDate',
  targetcompletiondate: 'dueDate', requiredbydate: 'dueDate', requiredby: 'dueDate',
  datedue: 'dueDate', completiondate: 'dueDate',
  actiontype: 'actionType',
  rationale: 'rationale', reason: 'rationale', justification: 'rationale',
  decisionrationale: 'rationale',
  rootcause: 'rootCause', cause: 'rootCause',
  workaround: 'workaround', alternative: 'workaround',
  validationplan: 'validationPlan', validation: 'validationPlan',
  howtovalidate: 'validationPlan', validationmethod: 'validationPlan',
  dependententity: 'dependentEntity', dependency: 'dependentEntity', dependson: 'dependentEntity',
  dependenton: 'dependentEntity', externalparty: 'dependentEntity', supplier: 'dependentEntity',
  forum: 'forum', decisionforum: 'forum',
  sourcemeeting: 'sourceMeeting', meeting: 'sourceMeeting',
};

const RAID_TARGET_LABELS: Record<string, string[]> = {
  type: ['type', 'raid type', 'item type', 'record type'],
  title: ['title', 'name', 'risk title', 'item', 'risk description', 'issue description', 'action description', 'decision description'],
  description: ['description', 'details', 'notes', 'comments'],
  category: ['category', 'area', 'domain'],
  severity: ['severity', 'priority', 'rating', 'level'],
  probability: ['probability', 'likelihood'],
  impact: ['impact', 'consequence', 'effect'],
  status: ['status', 'state'],
  owner: ['owner', 'assigned to', 'responsible', 'risk owner', 'assignee'],
  mitigationPlan: ['mitigation', 'mitigation plan', 'treatment', 'response'],
  responsePlan: ['response plan', 'contingency'],
  triggerCondition: ['trigger', 'trigger condition'],
  dueDate: ['due date', 'deadline', 'target date'],
  actionType: ['action type'],
  rationale: ['rationale', 'reason', 'justification'],
  rootCause: ['root cause', 'cause'],
  workaround: ['workaround', 'alternative'],
  validationPlan: ['validation plan', 'validation'],
  dependentEntity: ['dependent entity', 'dependency', 'depends on', 'dependent on'],
  forum: ['forum', 'decision forum'],
  sourceMeeting: ['source meeting', 'meeting'],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RAIDImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onImported?: () => void;
}

interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

interface ImportResult {
  succeeded: number;
  failed: { row: number; error: string }[];
}

// Sheet name → RAID type mapping for multi-tab import
const SHEET_TYPE_MAP: Record<string, string> = {
  risks: 'risk', risk: 'risk',
  issues: 'issue', issue: 'issue',
  actions: 'action', action: 'action',
  decisions: 'decision', decision: 'decision',
  assumptions: 'assumption', assumption: 'assumption',
  dependencies: 'dependency', dependency: 'dependency',
};
const SKIP_SHEETS = new Set(['dashboard', 'summary', 'overview', 'instructions', 'template', 'readme', 'cover']);

// ---------------------------------------------------------------------------
// CSV parser (same as ImportModal)
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RAIDImportModal({ isOpen, onClose, projectId, onImported }: RAIDImportModalProps) {
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<ParsedCSV | null>(null);
  const [columnMap, setColumnMap] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [multiTabResults, setMultiTabResults] = useState<{ sheet: string; type: string; succeeded: number; failed: number }[] | null>(null);
  const [importingAll, setImportingAll] = useState(false);
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
    setMultiTabResults(null);
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
    setColumnMap({});
  }, []);

  const isExcelFile = (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();
    return ext === 'xlsx' || ext === 'xls' || ext === 'xlsb' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
  };

  const handleFile = (file: File) => {
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`);
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
            workbookRef.current = workbook;
            setSheetNames(workbook.SheetNames);
            setSelectedSheet(workbook.SheetNames[0]);
            const csv = sheetToCsv(XLSX, workbook.Sheets[workbook.SheetNames[0]]);
            loadText(cleanCsvForImport(csv));
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
      const headerMap: Record<string, string> = {};
      for (let i = 0; i < parsed.headers.length; i++) {
        const header = parsed.headers[i];
        if (header) {
          headerMap[header] = columnMap[i] || '_skip';
        }
      }
      const res = await apiService.importRaidItems(projectId, csvText, headerMap);
      const data = res?.data ?? res;
      setResult({ succeeded: data.succeeded ?? 0, failed: data.failed ?? [] });
      if ((data.succeeded ?? 0) > 0) onImported?.();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  // Multi-tab import: import all RAID-named sheets at once
  const handleImportAllSheets = async () => {
    if (!workbookRef.current) return;
    setImportingAll(true);
    setError('');
    const results: { sheet: string; type: string; succeeded: number; failed: number }[] = [];
    let anySuccess = false;

    for (const name of workbookRef.current.SheetNames) {
      const normalized = name.toLowerCase().trim();
      if (SKIP_SHEETS.has(normalized)) continue;
      const raidType = SHEET_TYPE_MAP[normalized];
      if (!raidType) continue;

      try {
        const csv = sheetToCsv(XLSX, workbookRef.current.Sheets[name]);
        const cleaned = cleanCsvForImport(csv);
        const p = parseCSV(cleaned);
        if (p.headers.length === 0 || p.rows.length === 0) {
          results.push({ sheet: name, type: raidType, succeeded: 0, failed: 0 });
          continue;
        }

        // Auto-map columns using aliases
        const headerMap: Record<string, string> = {};
        for (const header of p.headers) {
          const key = header.toLowerCase().replace(/[^a-z0-9]/g, '');
          headerMap[header] = RAID_ALIASES[key] || '_skip';
        }

        // Reconstruct CSV with proper escaping + inject type column
        const hasTypeCol = Object.values(headerMap).includes('type');
        const typeIdx = hasTypeCol ? p.headers.findIndex(h => headerMap[h] === 'type') : -1;

        // Build new CSV lines with proper quoting
        const outHeaders = hasTypeCol ? p.headers : ['_raid_type_', ...p.headers];
        const outLines = [outHeaders.map(escapeCsvCell).join(',')];
        for (const row of p.rows) {
          if (hasTypeCol) {
            // Override the type column value with the sheet's RAID type
            const newRow = row.map((v, i) => escapeCsvCell(i === typeIdx ? raidType : v));
            outLines.push(newRow.join(','));
          } else {
            // Prepend the type value
            outLines.push([escapeCsvCell(raidType), ...row.map(escapeCsvCell)].join(','));
          }
        }
        const outCsv = outLines.join('\n');

        // Adjust headerMap for injected type column
        if (!hasTypeCol) {
          headerMap['_raid_type_'] = 'type';
        }

        const res = await apiService.importRaidItems(projectId, outCsv, headerMap);
        const data = res?.data ?? res;
        results.push({ sheet: name, type: raidType, succeeded: data.succeeded ?? 0, failed: (data.failed ?? []).length });
        if ((data.succeeded ?? 0) > 0) anySuccess = true;
      } catch {
        results.push({ sheet: name, type: raidType, succeeded: 0, failed: -1 });
      }
    }

    setMultiTabResults(results);
    if (anySuccess) onImported?.();
    setImportingAll(false);
  };

  // Check if workbook has any RAID-named sheets
  const raidSheetCount = sheetNames.filter(n => SHEET_TYPE_MAP[n.toLowerCase().trim()] && !SKIP_SHEETS.has(n.toLowerCase().trim())).length;

  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);

  if (!isOpen) return null;

  const previewRows = parsed?.rows.slice(0, 10) ?? [];
  const mappedCount = Object.values(columnMap).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Import RAID Items" onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import RAID Items</h2>
          <button onClick={handleClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Multi-tab import results */}
          {multiTabResults && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm font-medium">
                Multi-tab import complete
              </div>
              <div className="space-y-1">
                {multiTabResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-300 w-28 truncate capitalize">{r.sheet}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 capitalize">{r.type}</span>
                    <span className="text-green-600 dark:text-green-400">{r.succeeded} imported</span>
                    {r.failed > 0 && <span className="text-red-600 dark:text-red-400">{r.failed} failed</span>}
                    {r.failed === -1 && <span className="text-red-600 dark:text-red-400">error</span>}
                  </div>
                ))}
              </div>
              <button onClick={reset} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Import more</button>
            </div>
          )}

          {/* Result summary */}
          {result && !multiTabResults && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm font-medium">
                {result.succeeded} RAID item{result.succeeded !== 1 ? 's' : ''} imported successfully.
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

          {/* Input area */}
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">Drag & drop a file here, or click to browse</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">.csv, .xlsx, .xls supported (max 5MB)</p>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex-1 border-t dark:border-gray-700" />or paste CSV below<span className="flex-1 border-t dark:border-gray-700" />
                  </div>

                  <textarea
                    rows={5}
                    placeholder="Type,Title,Severity,Status,Owner&#10;Risk,Server outage risk,high,open,John Smith"
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

              {/* Sheet selector */}
              {sheetNames.length > 1 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Sheet</h3>
                  <div className="flex gap-2">
                    <select
                      value={selectedSheet}
                      onChange={(e) => handleSheetSelect(e.target.value)}
                      className="text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 flex-1"
                    >
                      {sheetNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    {raidSheetCount >= 2 && (
                      <button
                        onClick={handleImportAllSheets}
                        disabled={importingAll}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Upload size={14} />
                        {importingAll ? 'Importing...' : `Import All Sheets (${raidSheetCount})`}
                      </button>
                    )}
                  </div>
                  {raidSheetCount >= 2 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Detected RAID tabs: {sheetNames.filter(n => SHEET_TYPE_MAP[n.toLowerCase().trim()]).join(', ')}
                    </p>
                  )}
                </div>
              )}

              {/* Column mapping & preview */}
              {parsed && (
                <>
                  <ColumnMapper
                    headers={parsed.headers}
                    mappings={columnMap}
                    onMappingsChange={setColumnMap}
                    targetColumns={RAID_TARGET_COLUMNS}
                    aliases={RAID_ALIASES}
                    targetLabels={RAID_TARGET_LABELS}
                  />

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
                                {columnMap[i] && <span className="ml-1 text-blue-500">({RAID_TARGET_COLUMNS.find((c) => c.value === columnMap[i])?.label})</span>}
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
                      {importing ? 'Importing...' : `Import ${parsed.rows.length} rows`}
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

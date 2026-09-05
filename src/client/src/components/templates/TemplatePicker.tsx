import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Monitor,
  Building2,
  Landmark,
  Route,
  Layout,
  AlertCircle,
  Upload,
  CheckCircle2,
  Megaphone,
  Briefcase,
  Store,
  Download,
  Plus,
  FolderOpen,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiService } from '../../services/api';
import { TemplateCard } from './TemplateCard';
import { TemplatePreview } from './TemplatePreview';
import { TemplateCustomizeForm } from './TemplateCustomizeForm';
import { ColumnMapper } from '../schedule/ColumnMapper';
import { cleanCsvForImport, sheetToCsv } from '../../utils/csvCleaner';
import { useModal } from '../../hooks/useModal';

interface TemplatePickerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step =
  | 'start'       // NEW: 3-option start screen
  | 'category'    // template category selection
  | 'template'    // template grid
  | 'preview'     // template preview
  | 'customize'   // template customize form
  | 'scratch'     // blank project form
  | 'file-upload' // NEW: file upload for "From File"
  | 'file-map'    // NEW: column mapping for "From File"
  | 'file-details'; // NEW: project details for "From File"

const categories = [
  { key: 'it', label: 'IT & Software', icon: Monitor, color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  { key: 'construction', label: 'Construction', icon: Building2, color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800' },
  { key: 'infrastructure', label: 'Infrastructure', icon: Landmark, color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  { key: 'roads', label: 'Roads & Bridges', icon: Route, color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800' },
  { key: 'marketing', label: 'Marketing', icon: Megaphone, color: 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400 border-pink-200 dark:border-pink-800' },
  { key: 'operations', label: 'Operations', icon: Briefcase, color: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 border-teal-200 dark:border-teal-800' },
  { key: 'other', label: 'General', icon: Layout, color: 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600' },
  { key: 'marketplace', label: 'Marketplace', icon: Store, color: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800' },
];

// ---------------------------------------------------------------------------
// CSV helpers (for parsing file in "From File" flow)
// ---------------------------------------------------------------------------

interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

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
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
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

export const TemplatePicker: React.FC<TemplatePickerProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('start');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scratchSubmitting, setScratchSubmitting] = useState(false);

  // "From File" flow state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [parsedCsvText, setParsedCsvText] = useState<string | null>(null);
  const [fileParsed, setFileParsed] = useState<ParsedCSV | null>(null);
  const [columnMap, setColumnMap] = useState<Record<number, string>>({});
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isExcelFile = (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();
    return ext === 'xlsx' || ext === 'xls' || ext === 'xlsb' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
  };

  const loadCsvText = useCallback((csv: string, fileName: string) => {
    const cleaned = cleanCsvForImport(csv);
    setParsedCsvText(cleaned);
    setUploadedFileName(fileName);
    const p = parseCSV(cleaned);
    if (p.headers.length === 0) {
      setErrorMessage('File appears empty or has no recognizable columns.');
      return;
    }
    setFileParsed(p);
    setStep('file-map');
  }, []);

  const handleFileUpload = useCallback((file: File) => {
    setErrorMessage(null);
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`);
      return;
    }

    if (isExcelFile(file)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          if (workbook.SheetNames.length === 0) {
            setErrorMessage('Excel file has no sheets.');
            return;
          }

          if (workbook.SheetNames.length > 1) {
            workbookRef.current = workbook;
            setSheetNames(workbook.SheetNames);
            setSelectedSheet(workbook.SheetNames[0]);
          }

          // Load first sheet
          const csv = sheetToCsv(XLSX, workbook.Sheets[workbook.SheetNames[0]]);
          loadCsvText(csv, file.name);
        } catch {
          setErrorMessage('Failed to parse Excel file.');
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (file.name.toLowerCase().endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        loadCsvText(text, file.name);
      };
      reader.readAsText(file);
    } else {
      setErrorMessage('Please upload a .csv, .xlsx, or .xls file.');
    }
  }, [loadCsvText]);

  const handleSheetSelect = (name: string) => {
    setSelectedSheet(name);
    if (workbookRef.current) {
      const csv = sheetToCsv(XLSX, workbookRef.current.Sheets[name]);
      loadCsvText(csv, uploadedFileName || 'file');
    }
  };

  const isMarketplace = selectedCategory === 'marketplace';

  const { data: templatesData, isError: isTemplatesError } = useQuery({
    queryKey: ['templates', selectedCategory],
    queryFn: () => {
      if (selectedCategory === 'marketing' || selectedCategory === 'operations') {
        return apiService.getTemplates('other', selectedCategory);
      }
      return apiService.getTemplates(selectedCategory || undefined);
    },
    enabled: !!selectedCategory && !isMarketplace,
  });

  const { data: marketplaceData, isError: isMarketplaceError } = useQuery({
    queryKey: ['templates-marketplace'],
    queryFn: () => apiService.getMarketplaceTemplates(),
    enabled: isMarketplace,
  });

  const { data: templateDetail, isError: isTemplateDetailError } = useQuery({
    queryKey: ['template', selectedTemplateId],
    queryFn: () => apiService.getTemplate(selectedTemplateId!),
    enabled: !!selectedTemplateId,
  });

  const applyMutation = useMutation({
    mutationFn: (data: {
      templateId: string;
      projectName: string;
      startDate: string;
      budget?: number;
      priority?: string;
      location?: string;
      selectedTaskRefIds?: string[];
    }) => apiService.applyTemplate(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      resetState();
      navigate(`/project/${result.project.id}`, { state: { showReadiness: true } });
    },
    onError: () => {
      setErrorMessage('Failed to create project from template. Please try again.');
    },
  });

  const templates = templatesData?.data || templatesData?.templates || [];
  const template = templateDetail?.template;
  const marketplaceTemplates = marketplaceData?.data || [];

  const importMutation = useMutation({
    mutationFn: (marketplaceId: string) => apiService.importMarketplaceTemplate(marketplaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setStep('category');
      setSelectedCategory(null);
    },
    onError: () => {
      setErrorMessage('Failed to import template. Please try again.');
    },
  });

  const resetState = () => {
    setStep('start');
    setSelectedCategory(null);
    setSelectedTemplateId(null);
    setErrorMessage(null);
    setUploadedFileName(null);
    setParsedCsvText(null);
    setFileParsed(null);
    setColumnMap({});
    setSheetNames([]);
    setSelectedSheet('');
    workbookRef.current = null;
    setScratchSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    onClose();
    resetState();
  };

  const { dialogRef, handleKeyDown } = useModal(isOpen, handleClose);

  const handleCategorySelect = (key: string) => {
    setErrorMessage(null);
    setSelectedCategory(key);
    setStep('template');
  };

  const handleTemplateSelect = (id: string) => {
    setErrorMessage(null);
    setSelectedTemplateId(id);
    setStep('customize');
  };

  const handlePreview = (id: string) => {
    setSelectedTemplateId(id);
    setStep('preview');
  };

  const handleCustomize = (data: {
    projectName: string;
    startDate: string;
    budget?: number;
    priority: string;
    methodology?: string;
    location?: string;
    selectedTaskRefIds?: string[];
  }) => {
    setErrorMessage(null);
    if (!selectedTemplateId) return;
    applyMutation.mutate({ templateId: selectedTemplateId, ...data });
  };

  // "From File" project creation: create project + schedule + import with column map
  const handleFileProjectSubmit = async (data: {
    projectName: string;
    startDate: string;
    budget?: number;
    priority: string;
    methodology?: string;
    location?: string;
  }) => {
    setErrorMessage(null);
    setScratchSubmitting(true);
    try {
      const result = await apiService.createProject({
        name: data.projectName,
        status: 'planning',
        priority: data.priority,
        methodology: data.methodology,
        budgetAllocated: data.budget,
        startDate: data.startDate,
        location: data.location,
      });
      const projectId = result.project?.id || result.id;

      if (parsedCsvText && projectId && fileParsed) {
        try {
          const endDate = new Date(data.startDate);
          endDate.setFullYear(endDate.getFullYear() + 1);
          const schedule = await apiService.createSchedule({
            projectId,
            name: `${data.projectName} Schedule`,
            startDate: data.startDate,
            endDate: endDate.toISOString().split('T')[0],
          });
          const scheduleId = schedule.schedule?.id || schedule.id;
          if (scheduleId) {
            // Build header-name-based column map from index-based
            const headerMap: Record<string, string> = {};
            for (const [idx, field] of Object.entries(columnMap)) {
              if (field && fileParsed.headers[Number(idx)]) {
                headerMap[fileParsed.headers[Number(idx)]] = field;
              }
            }
            await apiService.importTasks(scheduleId, parsedCsvText, headerMap);
          }
        } catch {
          console.warn('Schedule creation or task import failed, but project was created.');
        }
      }

      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      resetState();
      if (projectId) navigate(`/project/${projectId}`, { state: { showReadiness: true } });
    } catch {
      setErrorMessage('Failed to create project. Please try again.');
    } finally {
      setScratchSubmitting(false);
    }
  };

  // Blank project creation (no file)
  const handleBlankProjectSubmit = async (data: {
    projectName: string;
    startDate: string;
    budget?: number;
    priority: string;
    methodology?: string;
    location?: string;
  }) => {
    setErrorMessage(null);
    setScratchSubmitting(true);
    try {
      const result = await apiService.createProject({
        name: data.projectName,
        status: 'planning',
        priority: data.priority,
        methodology: data.methodology,
        budgetAllocated: data.budget,
        startDate: data.startDate,
        location: data.location,
      });
      const projectId = result.project?.id || result.id;
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      resetState();
      if (projectId) navigate(`/project/${projectId}`, { state: { showReadiness: true } });
    } catch {
      setErrorMessage('Failed to create project. Please try again.');
    } finally {
      setScratchSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const stepTitles: Record<Step, string> = {
    start: 'New Project',
    category: 'Choose a Category',
    template: 'Choose a Template',
    preview: 'Template Preview',
    customize: 'Customize Your Project',
    scratch: 'New Blank Project',
    'file-upload': 'Import from File',
    'file-map': 'Map Columns',
    'file-details': 'Project Details',
  };

  // Compute step indicators based on which flow we're in
  let stepIndicators: { label: string; active: boolean; completed: boolean }[];
  if (step.startsWith('file')) {
    const fileStepNum = step === 'file-upload' ? 0 : step === 'file-map' ? 1 : 2;
    stepIndicators = [
      { label: 'Upload', active: step === 'file-upload', completed: fileStepNum > 0 },
      { label: 'Map', active: step === 'file-map', completed: fileStepNum > 1 },
      { label: 'Create', active: step === 'file-details', completed: false },
    ];
  } else if (step === 'scratch') {
    stepIndicators = [
      { label: 'Type', active: false, completed: true },
      { label: 'Create', active: true, completed: false },
    ];
  } else {
    const templateStepNum = step === 'start' ? 0 : (step === 'category' || step === 'template' || step === 'preview') ? 1 : 2;
    stepIndicators = [
      { label: 'Type', active: step === 'start', completed: templateStepNum > 0 },
      { label: 'Template', active: step === 'category' || step === 'template' || step === 'preview', completed: templateStepNum > 1 },
      { label: 'Create', active: step === 'customize', completed: false },
    ];
  }

  const previewRows = fileParsed?.rows.slice(0, 5) ?? [];
  const mappedCount = Object.values(columnMap).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={stepTitles[step]}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-full sm:max-w-2xl mx-2 sm:mx-4 max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{stepTitles[step]}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              {stepIndicators.map((s, i) => (
                <React.Fragment key={s.label}>
                  {i > 0 && <div className={`w-6 h-px ${s.completed || s.active ? 'bg-primary-300' : 'bg-gray-200 dark:bg-gray-700'}`} />}
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      s.active
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                        : s.completed
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {s.label}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Error banner */}
          {errorMessage && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-xs text-red-700 dark:text-red-400">{errorMessage}</span>
            </div>
          )}

          {/* ============================================================ */}
          {/* START: 3-option start screen                                 */}
          {/* ============================================================ */}
          {step === 'start' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Blank Project */}
              <button
                onClick={() => setStep('scratch')}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center group-hover:bg-primary-50 dark:group-hover:bg-primary-900/30 transition-colors">
                  <Plus className="w-6 h-6 text-gray-500 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400" />
                </div>
                <div className="text-center">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Blank Project</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Start with an empty project</p>
                </div>
              </button>

              {/* From File */}
              <button
                onClick={() => setStep('file-upload')}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                  <Upload className="w-6 h-6 text-blue-500 dark:text-blue-400" />
                </div>
                <div className="text-center">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">From File</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Import from Excel or CSV</p>
                </div>
              </button>

              {/* From Template */}
              <button
                onClick={() => setStep('category')}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-600 hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center group-hover:bg-green-100 dark:group-hover:bg-green-900/30 transition-colors">
                  <FolderOpen className="w-6 h-6 text-green-500 dark:text-green-400" />
                </div>
                <div className="text-center">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">From Template</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Use a pre-built template</p>
                </div>
              </button>
            </div>
          )}

          {/* ============================================================ */}
          {/* FILE-UPLOAD: drag-and-drop file upload                       */}
          {/* ============================================================ */}
          {step === 'file-upload' && (
            <div>
              <button
                onClick={() => { setStep('start'); setUploadedFileName(null); setParsedCsvText(null); setFileParsed(null); setSheetNames([]); }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-4 flex items-center gap-1"
              >
                &larr; Back
              </button>
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileUpload(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 p-12 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors"
              >
                <Upload className="w-10 h-10 text-gray-400 dark:text-gray-500" />
                <div className="text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Drag & drop your file here, or <span className="text-blue-600 font-medium">browse</span></p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls, or .csv (max 5MB)</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
            </div>
          )}

          {/* ============================================================ */}
          {/* FILE-MAP: Column mapping with preview                        */}
          {/* ============================================================ */}
          {step === 'file-map' && fileParsed && (
            <div className="space-y-4">
              <button
                onClick={() => { setStep('file-upload'); setFileParsed(null); setParsedCsvText(null); setUploadedFileName(null); setColumnMap({}); setSheetNames([]); workbookRef.current = null; }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
              >
                &larr; Change file
              </button>

              {/* File name badge */}
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <span className="text-sm text-blue-700 dark:text-blue-400 flex-1 truncate">{uploadedFileName}</span>
                <span className="text-xs text-blue-500">{fileParsed.rows.length} rows</span>
              </div>

              {/* Sheet selector for multi-sheet Excel files */}
              {sheetNames.length > 1 && (
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">Select Sheet</label>
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

              {/* Column Mapper */}
              <ColumnMapper
                headers={fileParsed.headers}
                mappings={columnMap}
                onMappingsChange={setColumnMap}
              />

              {/* Preview table */}
              {previewRows.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Preview (first {previewRows.length} of {fileParsed.rows.length} rows)
                  </h3>
                  <div className="overflow-x-auto border dark:border-gray-700 rounded-lg max-h-[25vh] overflow-y-auto">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0">
                        <tr className="bg-gray-50 dark:bg-gray-700">
                          {fileParsed.headers.map((h, i) => (
                            <th key={i} className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                              {h}
                              {columnMap[i] && <span className="ml-1 text-blue-500 text-[10px]">({columnMap[i]})</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr key={ri} className="border-t dark:border-gray-700 even:bg-gray-50 dark:even:bg-gray-700/30">
                            {fileParsed.headers.map((_, ci) => (
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
              )}

              {/* Next button */}
              <div className="flex items-center justify-end pt-2">
                <button
                  disabled={mappedCount === 0}
                  onClick={() => setStep('file-details')}
                  className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next: Project Details
                </button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* FILE-DETAILS: Project details form (reuse TemplateCustomize) */}
          {/* ============================================================ */}
          {step === 'file-details' && (
            <TemplateCustomizeForm
              templateName=""
              estimatedDurationDays={0}
              phaseCount={0}
              taskCount={fileParsed?.rows.length ?? 0}
              tasks={[]}
              onBack={() => setStep('file-map')}
              onSubmit={handleFileProjectSubmit}
              isSubmitting={scratchSubmitting}
              extraContent={
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span className="text-xs text-blue-700 dark:text-blue-400 truncate">{uploadedFileName} — {fileParsed?.rows.length ?? 0} tasks, {mappedCount} columns mapped</span>
                </div>
              }
            />
          )}

          {/* ============================================================ */}
          {/* CATEGORY: Template category selection                        */}
          {/* ============================================================ */}
          {step === 'category' && (
            <div>
              <button
                onClick={() => setStep('start')}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-3 flex items-center gap-1"
              >
                &larr; Back
              </button>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {categories.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.key}
                      onClick={() => handleCategorySelect(cat.key)}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all hover:shadow-md ${cat.color}`}
                    >
                      <Icon className="w-8 h-8" />
                      <span className="text-sm font-medium">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TEMPLATE: Template Grid                                      */}
          {/* ============================================================ */}
          {step === 'template' && !isMarketplace && (
            <div>
              <button
                onClick={() => { setStep('category'); setSelectedCategory(null); }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-3 flex items-center gap-1"
              >
                &larr; Back to categories
              </button>
              {isTemplatesError ? (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
                  Failed to load templates. Please try again.
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-500 dark:text-gray-400">No templates found for this category.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {templates.map((t: any) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      onSelect={handleTemplateSelect}
                      onPreview={handlePreview}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Marketplace Grid */}
          {step === 'template' && isMarketplace && (
            <div>
              <button
                onClick={() => { setStep('category'); setSelectedCategory(null); }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-3 flex items-center gap-1"
              >
                &larr; Back to categories
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Templates shared by other organizations. Import one to use it in your projects.
              </p>
              {isMarketplaceError ? (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
                  Failed to load marketplace templates.
                </div>
              ) : marketplaceTemplates.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-500 dark:text-gray-400">No marketplace templates yet. Publish your custom templates to share them!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {marketplaceTemplates.map((t: any) => (
                    <div key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.name}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{t.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                        <span>{t.taskCount} tasks</span>
                        <span>{t.estimatedDays} days</span>
                        <span className="flex items-center gap-0.5"><Download className="w-3 h-3" />{t.downloadCount}</span>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-[10px] text-gray-400 truncate max-w-[140px]">by {t.publishedByOrgName}</span>
                        <button
                          onClick={() => importMutation.mutate(t.id)}
                          disabled={importMutation.isPending}
                          className="text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                        >
                          {importMutation.isPending ? 'Importing...' : 'Import'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Template detail error */}
          {(step === 'preview' || step === 'customize') && isTemplateDetailError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
              Failed to load template details. Please try again.
            </div>
          )}

          {/* Preview */}
          {step === 'preview' && template && (
            <TemplatePreview
              template={template}
              onBack={() => setStep('template')}
              onSelect={() => setStep('customize')}
            />
          )}

          {/* Customize (from template) */}
          {step === 'customize' && template && (
            <TemplateCustomizeForm
              templateName={template.name}
              estimatedDurationDays={template.estimatedDurationDays}
              phaseCount={template.tasks.filter((t: any) => t.isSummary).length}
              taskCount={template.tasks.filter((t: any) => !t.isSummary).length}
              tasks={template.tasks}
              defaultMethodology={template.defaultMethodology}
              onBack={() => setStep('template')}
              onSubmit={handleCustomize}
              isSubmitting={applyMutation.isPending}
            />
          )}

          {/* Blank Project */}
          {step === 'scratch' && (
            <TemplateCustomizeForm
              templateName=""
              estimatedDurationDays={0}
              phaseCount={0}
              taskCount={0}
              tasks={[]}
              onBack={() => setStep('start')}
              onSubmit={handleBlankProjectSubmit}
              isSubmitting={scratchSubmitting}
            />
          )}
        </div>
      </div>
    </div>
  );
};

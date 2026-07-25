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
  FileText,
  AlertCircle,
  Upload,
  CheckCircle2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiService } from '../../services/api';
import { TemplateCard } from './TemplateCard';
import { TemplatePreview } from './TemplatePreview';
import { TemplateCustomizeForm } from './TemplateCustomizeForm';
import { cleanCsvForImport } from '../../utils/csvCleaner';
import { useModal } from '../../hooks/useModal';

interface TemplatePickerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'category' | 'template' | 'preview' | 'customize' | 'scratch';

const categories = [
  { key: 'it', label: 'IT & Software', icon: Monitor, color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  { key: 'construction', label: 'Construction', icon: Building2, color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800' },
  { key: 'infrastructure', label: 'Infrastructure', icon: Landmark, color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  { key: 'roads', label: 'Roads & Bridges', icon: Route, color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800' },
  { key: 'other', label: 'General', icon: Layout, color: 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600' },
];

export const TemplatePicker: React.FC<TemplatePickerProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('category');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [parsedCsvText, setParsedCsvText] = useState<string | null>(null);
  const [scratchSubmitting, setScratchSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isExcelFile = (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();
    return ext === 'xlsx' || ext === 'xls' || ext === 'xlsb' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
  };

  const handleFileUpload = useCallback((file: File) => {
    setErrorMessage(null);
    if (isExcelFile(file)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
          setParsedCsvText(cleanCsvForImport(csv));
          setUploadedFileName(file.name);
        } catch {
          setErrorMessage('Failed to parse Excel file.');
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (file.name.toLowerCase().endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setParsedCsvText(cleanCsvForImport(text));
        setUploadedFileName(file.name);
      };
      reader.readAsText(file);
    } else {
      setErrorMessage('Please upload a .csv, .xlsx, or .xls file.');
    }
  }, []);

  const clearFile = useCallback(() => {
    setUploadedFileName(null);
    setParsedCsvText(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const { data: templatesData, isError: isTemplatesError } = useQuery({
    queryKey: ['templates', selectedCategory],
    queryFn: () => apiService.getTemplates(selectedCategory || undefined),
    enabled: !!selectedCategory,
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

  const resetState = () => {
    setStep('category');
    setSelectedCategory(null);
    setSelectedTemplateId(null);
    setErrorMessage(null);
    setUploadedFileName(null);
    setParsedCsvText(null);
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
    if (key === 'scratch') {
      setStep('scratch');
      return;
    }
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
    applyMutation.mutate({
      templateId: selectedTemplateId,
      ...data,
    });
  };

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
      // 1. Create the project
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

      // 2. If file was uploaded, create schedule + import tasks
      if (parsedCsvText && projectId) {
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
            await apiService.importTasks(scheduleId, parsedCsvText);
          }
        } catch {
          // Project was created successfully, but import failed — still navigate
          console.warn('Schedule creation or task import failed, but project was created.');
        }
      }

      // 3. Navigate to the new project
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
    category: 'New Project',
    template: 'Choose a Template',
    preview: 'Template Preview',
    customize: 'Customize Your Project',
    scratch: 'New Blank Project',
  };

  const stepNumber = step === 'category' ? 0 : (step === 'template' || step === 'preview') ? 1 : 2;
  const stepIndicators = [
    { label: 'Category', active: step === 'category', completed: stepNumber > 0 },
    { label: 'Template', active: step === 'template' || step === 'preview', completed: stepNumber > 1 },
    { label: 'Create', active: step === 'customize' || step === 'scratch', completed: false },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={stepTitles[step]} onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-full sm:max-w-2xl mx-2 sm:mx-4 max-h-[85vh] flex flex-col">
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

          {/* Step 1: Category Selection */}
          {step === 'category' && (
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
              <button
                onClick={() => handleCategorySelect('scratch')}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-500 transition-all"
              >
                <FileText className="w-8 h-8" />
                <span className="text-sm font-medium">Start from Scratch</span>
              </button>
            </div>
          )}

          {/* Step 2: Template Grid */}
          {step === 'template' && (
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

          {/* Template detail error */}
          {(step === 'preview' || step === 'customize') && isTemplateDetailError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
              Failed to load template details. Please try again.
            </div>
          )}

          {/* Step 2b: Preview */}
          {step === 'preview' && template && (
            <TemplatePreview
              template={template}
              onBack={() => setStep('template')}
              onSelect={() => setStep('customize')}
            />
          )}

          {/* Step 3: Customize */}
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

          {/* Step 3b: Blank Project */}
          {step === 'scratch' && (
            <TemplateCustomizeForm
              templateName=""
              estimatedDurationDays={0}
              phaseCount={0}
              taskCount={0}
              tasks={[]}
              onBack={() => setStep('category')}
              onSubmit={handleBlankProjectSubmit}
              isSubmitting={scratchSubmitting}
              extraContent={
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Upload className="w-3 h-3 inline mr-1" />
                    Import Schedule (optional)
                  </label>
                  {uploadedFileName ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <span className="text-sm text-green-700 flex-1 truncate">{uploadedFileName}</span>
                      <button
                        type="button"
                        onClick={clearFile}
                        className="text-xs text-gray-500 hover:text-red-600 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50/30 dark:hover:bg-primary-900/10 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files[0];
                        if (file) handleFileUpload(file);
                      }}
                    >
                      <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">
                        Drop .xlsx or .csv here, or <span className="text-primary-600 font-medium">browse</span>
                      </p>
                    </div>
                  )}
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
              }
            />
          )}
        </div>
      </div>
    </div>
  );
};

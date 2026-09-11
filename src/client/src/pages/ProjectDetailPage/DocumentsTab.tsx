import React, { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  FileText,
  Search,
  Trash2,
  RefreshCw,
  X,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Tag,
  Star,
  FolderOpen,
  Pencil,
  Check,
  Download,
} from 'lucide-react';
import { apiService } from '../../services/api';

interface DocumentsTabProps {
  projectId: string;
}

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'design', label: 'Design' },
  { value: 'meeting_minutes', label: 'Meeting Minutes' },
  { value: 'risk_log', label: 'Risk Log' },
  { value: 'issue_log', label: 'Issue Log' },
  { value: 'financial', label: 'Financial' },
  { value: 'governance', label: 'Governance' },
  { value: 'decision_log', label: 'Decision Log' },
  { value: 'contract', label: 'Contract' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'misc', label: 'Misc' },
];

const PHASE_OPTIONS = [
  { value: '', label: 'All Phases' },
  { value: 'initiation', label: 'Initiation' },
  { value: 'planning', label: 'Planning' },
  { value: 'execution', label: 'Execution' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'closure', label: 'Closure' },
];

const TYPE_COLORS: Record<string, string> = {
  requirements: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  design: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  meeting_minutes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  risk_log: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  issue_log: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  financial: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  governance: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  decision_log: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  contract: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  proposal: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  misc: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const PHASE_COLORS: Record<string, string> = {
  initiation: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  planning: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  execution: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300',
  monitoring: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  closure: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  unknown: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === 'processing') return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
  if (status === 'failed') return <AlertTriangle className="w-4 h-4 text-red-500" />;
  return <Clock className="w-4 h-4 text-gray-400" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function DocumentsTab({ projectId }: DocumentsTabProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [semanticQuery, setSemanticQuery] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadDescription, setUploadDescription] = useState('');

  // Fetch document list
  const { data: docsData, isLoading } = useQuery({
    queryKey: ['project-documents', projectId, typeFilter, phaseFilter, folderFilter, searchText],
    queryFn: () => apiService.getProjectDocuments(projectId, {
      documentType: typeFilter || undefined,
      projectPhase: phaseFilter || undefined,
      folder: folderFilter || undefined,
      search: searchText || undefined,
    }),
    staleTime: 30_000,
  });
  const documents: any[] = docsData?.documents || [];

  // Fetch folders
  const { data: foldersData } = useQuery({
    queryKey: ['project-document-folders', projectId],
    queryFn: () => apiService.getProjectDocumentFolders(projectId),
    staleTime: 30_000,
  });
  const folders: string[] = foldersData?.folders || [];

  // Semantic search
  const { data: searchData, isFetching: isSearching } = useQuery({
    queryKey: ['project-documents-search', projectId, semanticQuery],
    queryFn: () => apiService.searchProjectDocuments(projectId, semanticQuery),
    enabled: semanticQuery.length >= 2,
    staleTime: 60_000,
  });
  const searchResults: any[] = searchData?.results || [];

  // Fetch selected document details
  const { data: detailData } = useQuery({
    queryKey: ['project-document', projectId, selectedDocId],
    queryFn: () => apiService.getProjectDocument(projectId, selectedDocId!),
    enabled: !!selectedDocId,
    staleTime: 30_000,
  });
  const selectedDoc = detailData?.document;
  const entityLinks: any[] = detailData?.entityLinks || [];

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => apiService.uploadProjectDocument(projectId, file, uploadDescription || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-document-folders', projectId] });
      setUploadDescription('');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => apiService.deleteProjectDocument(projectId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-document-folders', projectId] });
      if (selectedDocId) setSelectedDocId(null);
    },
  });

  // Reprocess mutation
  const reprocessMutation = useMutation({
    mutationFn: (documentId: string) => apiService.reprocessProjectDocument(projectId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-document', projectId] });
    },
  });

  // Update mutation (description, folder, pin)
  const updateMutation = useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: { description?: string | null; folder?: string | null; isPinned?: boolean } }) =>
      apiService.updateProjectDocument(projectId, documentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-document', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-document-folders', projectId] });
    },
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      uploadMutation.mutate(files[i]);
    }
  }, [uploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const togglePin = (docId: string, currentlyPinned: boolean) => {
    updateMutation.mutate({ documentId: docId, data: { isPinned: !currentlyPinned } });
  };

  const displayList = semanticQuery.length >= 2 ? searchResults.map((r: any) => r.document) : documents;

  return (
    <div className="mt-6 space-y-4">
      {/* Search bar — prominent at top */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          className="w-full text-sm border rounded-lg pl-10 pr-3 py-2.5 bg-white dark:bg-gray-800 dark:border-gray-600 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          placeholder="Search documents by name, description, or summary..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      {/* Upload area */}
      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
          dragOver
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-primary-400'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Drop files or{' '}
              <button
                className="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                onClick={() => fileInputRef.current?.click()}
              >
                browse
              </button>
            </span>
          </div>
          <input
            className="text-sm border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 w-64"
            placeholder="Description (optional)"
            value={uploadDescription}
            onChange={(e) => setUploadDescription(e.target.value)}
            maxLength={500}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">PDF, DOCX, DOC, TXT, CSV, MD (max 10MB)</p>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.doc,.txt,.csv,.md"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploadMutation.isPending && (
          <div className="flex items-center justify-center gap-2 mt-2 text-sm text-primary-600">
            <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
          </div>
        )}
        {uploadMutation.isError && (
          <p className="text-sm text-red-500 mt-2">Upload failed. Please try again.</p>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="text-sm border rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 dark:border-gray-600"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          className="text-sm border rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 dark:border-gray-600"
          value={phaseFilter}
          onChange={(e) => setPhaseFilter(e.target.value)}
        >
          {PHASE_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {folders.length > 0 && (
          <select
            className="text-sm border rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 dark:border-gray-600"
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
          >
            <option value="">All Folders</option>
            {folders.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {/* Semantic search toggle */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-400" />
          <input
            className="w-full text-sm border border-primary-200 dark:border-primary-700 rounded-md pl-8 pr-3 py-1.5 bg-white dark:bg-gray-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            placeholder="AI semantic search..."
            value={semanticQuery}
            onChange={(e) => setSemanticQuery(e.target.value)}
          />
          {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-500 animate-spin" />}
        </div>
      </div>

      {/* Document list + detail panel */}
      <div className="flex gap-4">
        {/* Document list */}
        <div className={`flex-1 space-y-2 ${selectedDocId ? 'max-w-[55%]' : ''}`}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : displayList.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No documents yet. Upload one to get started.</p>
            </div>
          ) : (
            displayList.map((doc: any) => (
              <button
                key={doc.id}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedDocId === doc.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
                onClick={() => setSelectedDocId(doc.id === selectedDocId ? null : doc.id)}
              >
                <div className="flex items-start gap-3">
                  {/* Pin star */}
                  <button
                    className="mt-0.5 flex-shrink-0"
                    title={doc.isPinned ? 'Unpin' : 'Pin to top'}
                    onClick={(e) => { e.stopPropagation(); togglePin(doc.id, doc.isPinned); }}
                  >
                    <Star className={`w-4 h-4 ${doc.isPinned ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 hover:text-yellow-400'}`} />
                  </button>
                  <FileText className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{doc.originalFilename}</span>
                      <StatusBadge status={doc.processingStatus} />
                    </div>
                    {doc.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{doc.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {doc.documentType && doc.documentType !== 'misc' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_COLORS[doc.documentType] || TYPE_COLORS.misc}`}>
                          {formatLabel(doc.documentType)}
                        </span>
                      )}
                      {doc.projectPhase && doc.projectPhase !== 'unknown' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${PHASE_COLORS[doc.projectPhase] || PHASE_COLORS.unknown}`}>
                          {formatLabel(doc.projectPhase)}
                        </span>
                      )}
                      {doc.folder && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center gap-0.5">
                          <FolderOpen className="w-3 h-3" />{doc.folder}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{formatFileSize(doc.fileSize)}</span>
                    </div>
                    {doc.aiSummary && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{doc.aiSummary}</p>
                    )}
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {doc.tags.slice(0, 5).map((tag: string) => (
                          <span key={tag} className="inline-flex items-center gap-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                            <Tag className="w-3 h-3" />{tag}
                          </span>
                        ))}
                        {doc.tags.length > 5 && <span className="text-xs text-gray-400">+{doc.tags.length - 5}</span>}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail side panel */}
        {selectedDocId && selectedDoc && (
          <DetailPanel
            doc={selectedDoc}
            entityLinks={entityLinks}
            onClose={() => setSelectedDocId(null)}
            onReprocess={() => reprocessMutation.mutate(selectedDoc.id)}
            onDelete={() => { if (confirm('Delete this document?')) deleteMutation.mutate(selectedDoc.id); }}
            onUpdate={(data) => updateMutation.mutate({ documentId: selectedDoc.id, data })}
            isReprocessing={reprocessMutation.isPending}
            folders={folders}
          />
        )}
      </div>
    </div>
  );
}

function DetailPanel({
  doc, entityLinks, onClose, onReprocess, onDelete, onUpdate, isReprocessing, folders,
}: {
  doc: any;
  entityLinks: any[];
  onClose: () => void;
  onReprocess: () => void;
  onDelete: () => void;
  onUpdate: (data: { description?: string | null; folder?: string | null; isPinned?: boolean }) => void;
  isReprocessing: boolean;
  folders: string[];
}) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(doc.description || '');
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState(doc.folder || '');

  const saveDescription = () => {
    onUpdate({ description: descDraft.trim() || null });
    setEditingDesc(false);
  };

  const saveFolder = () => {
    onUpdate({ folder: folderDraft.trim() || null });
    setEditingFolder(false);
  };

  return (
    <div className="w-[45%] border rounded-lg p-4 bg-white dark:bg-gray-800 dark:border-gray-700 overflow-y-auto max-h-[70vh] space-y-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm truncate">{doc.originalFilename}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatFileSize(doc.fileSize)} &middot; {new Date(doc.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title={doc.isPinned ? 'Unpin' : 'Pin to top'}
            onClick={() => onUpdate({ isPinned: !doc.isPinned })}
          >
            <Star className={`w-4 h-4 ${doc.isPinned ? 'fill-yellow-400 text-yellow-400' : 'text-gray-400'}`} />
          </button>
          <a
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            title="Download"
            href={apiService.getDocumentDownloadUrl(doc.projectId, doc.id)}
            download
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            title="Reprocess"
            onClick={onReprocess}
          >
            <RefreshCw className={`w-4 h-4 ${isReprocessing ? 'animate-spin' : ''}`} />
          </button>
          <button
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
            title="Delete"
            onClick={onDelete}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Description — editable */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1 flex items-center gap-1">
          Description
          {!editingDesc && (
            <button className="text-gray-400 hover:text-gray-600" onClick={() => { setDescDraft(doc.description || ''); setEditingDesc(true); }}>
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </h4>
        {editingDesc ? (
          <div className="flex gap-1">
            <input
              className="flex-1 text-sm border rounded px-2 py-1 bg-white dark:bg-gray-700 dark:border-gray-600"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              placeholder="Short description..."
              maxLength={500}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveDescription(); if (e.key === 'Escape') setEditingDesc(false); }}
            />
            <button className="p-1 text-green-600 hover:bg-green-50 rounded" onClick={saveDescription}><Check className="w-4 h-4" /></button>
            <button className="p-1 text-gray-400 hover:bg-gray-100 rounded" onClick={() => setEditingDesc(false)}><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {doc.description || <span className="italic text-gray-400">No description</span>}
          </p>
        )}
      </div>

      {/* Folder — editable */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1 flex items-center gap-1">
          <FolderOpen className="w-3 h-3" /> Folder
          {!editingFolder && (
            <button className="text-gray-400 hover:text-gray-600" onClick={() => { setFolderDraft(doc.folder || ''); setEditingFolder(true); }}>
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </h4>
        {editingFolder ? (
          <div className="flex gap-1">
            <input
              className="flex-1 text-sm border rounded px-2 py-1 bg-white dark:bg-gray-700 dark:border-gray-600"
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
              placeholder="Folder name..."
              maxLength={100}
              list="folder-suggestions"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveFolder(); if (e.key === 'Escape') setEditingFolder(false); }}
            />
            <datalist id="folder-suggestions">
              {folders.map(f => <option key={f} value={f} />)}
            </datalist>
            <button className="p-1 text-green-600 hover:bg-green-50 rounded" onClick={saveFolder}><Check className="w-4 h-4" /></button>
            <button className="p-1 text-gray-400 hover:bg-gray-100 rounded" onClick={() => setEditingFolder(false)}><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {doc.folder || <span className="italic text-gray-400">No folder</span>}
          </p>
        )}
      </div>

      {/* Classification */}
      <div className="flex flex-wrap gap-1.5">
        {doc.documentType && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[doc.documentType] || TYPE_COLORS.misc}`}>
            {formatLabel(doc.documentType)}
          </span>
        )}
        {doc.projectPhase && doc.projectPhase !== 'unknown' && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${PHASE_COLORS[doc.projectPhase] || PHASE_COLORS.unknown}`}>
            {formatLabel(doc.projectPhase)}
          </span>
        )}
        {doc.confidence > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            {Math.round(doc.confidence * 100)}% confidence
          </span>
        )}
      </div>

      {/* Summary */}
      {doc.aiSummary && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Summary</h4>
          <p className="text-sm text-gray-700 dark:text-gray-300">{doc.aiSummary}</p>
        </div>
      )}

      {/* Tags */}
      {doc.tags?.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {doc.tags.map((tag: string) => (
              <span key={tag} className="inline-flex items-center gap-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                <Tag className="w-3 h-3" />{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Insights */}
      {doc.aiInsights && (
        <>
          {doc.aiInsights.key_points?.length > 0 && (
            <InsightSection title="Key Points" items={doc.aiInsights.key_points} />
          )}
          {doc.aiInsights.decisions?.length > 0 && (
            <InsightSection title="Decisions" items={doc.aiInsights.decisions.map((d: any) => d.text)} />
          )}
          {doc.aiInsights.risks?.length > 0 && (
            <InsightSection title="Risks" items={doc.aiInsights.risks.map((r: any) => `${r.text}${r.severity ? ` (${r.severity})` : ''}`)} />
          )}
          {doc.aiInsights.issues?.length > 0 && (
            <InsightSection title="Issues" items={doc.aiInsights.issues.map((i: any) => i.text)} />
          )}
          {doc.aiInsights.actions?.length > 0 && (
            <InsightSection title="Action Items" items={doc.aiInsights.actions.map((a: any) => `${a.text}${a.assignee ? ` → ${a.assignee}` : ''}${a.due_date ? ` (due ${a.due_date})` : ''}`)} />
          )}
          {doc.aiInsights.dates_mentioned?.length > 0 && (
            <InsightSection title="Dates Mentioned" items={doc.aiInsights.dates_mentioned} />
          )}
        </>
      )}

      {/* Entity Links */}
      {entityLinks.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Linked Entities</h4>
          <div className="space-y-1">
            {entityLinks.map((link: any) => (
              <div key={link.id} className="text-xs flex items-center gap-2 p-1.5 rounded bg-gray-50 dark:bg-gray-700/50">
                <span className="font-medium capitalize">{link.entityType}</span>
                <span className="text-gray-400 truncate">{link.entityId}</span>
                {link.linkReason && <span className="text-gray-500 italic truncate">{link.linkReason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {doc.processingStatus === 'failed' && doc.errorMessage && (
        <div className="p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-xs text-red-600 dark:text-red-400">{doc.errorMessage}</p>
        </div>
      )}
    </div>
  );
}

function InsightSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">{title}</h4>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
            <span className="text-gray-400 mt-0.5">&#8226;</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { File, Image, FileText, Trash2, Download, Clock, UploadCloud } from 'lucide-react';
import { apiService } from '../../services/api';
import { AttachmentVersionHistory } from './AttachmentVersionHistory';
import { ConfirmModal } from '../ui/ConfirmModal';

interface AttachmentPanelProps {
  entityType: 'task' | 'project';
  entityId: string;
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image className="w-5 h-5 text-purple-500" />;
  if (mime === 'application/pdf') return <FileText className="w-5 h-5 text-red-500" />;
  return <File className="w-5 h-5 text-gray-500" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPanel({ entityType, entityId }: AttachmentPanelProps) {
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [versionHistoryId, setVersionHistoryId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', entityType, entityId],
    queryFn: () => apiService.getAttachments(entityType, entityId),
    enabled: !!entityId,
  });

  const attachments: any[] = data?.attachments || [];

  const uploadMutation = useMutation({
    mutationFn: (file: File) => apiService.uploadAttachment(entityType, entityId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', entityType, entityId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteAttachment(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', entityType, entityId] }),
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => uploadMutation.mutate(file));
  }, [uploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDownload = async (att: any) => {
    try {
      const blob = await apiService.downloadAttachment(att.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setFileError('Download failed');
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setFileError(''), 3000);
    }
  };

  const handlePreview = async (att: any) => {
    if (!att.mimeType.startsWith('image/') && att.mimeType !== 'application/pdf') return;
    try {
      const blob = await apiService.downloadAttachment(att.id);
      const url = window.URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch {
      setFileError('Preview failed');
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setFileError(''), 3000);
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Attachments</h4>

      {fileError && <p className="text-xs text-red-600 dark:text-red-400">{fileError}</p>}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer
          ${dragOver ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
        onClick={() => document.getElementById(`file-input-${entityId}`)?.click()}
      >
        <UploadCloud className={`w-6 h-6 mx-auto mb-1 ${dragOver ? 'text-primary-500' : 'text-gray-400'}`} />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {uploadMutation.isPending ? 'Uploading…' : 'Drop files here or click to upload'}
        </p>
        <input
          id={`file-input-${entityId}`}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="flex justify-center py-3">
          <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : attachments.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">No attachments yet</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((att: any) => (
            <div key={att.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 group">
              <button
                onClick={() => handlePreview(att)}
                className="flex-shrink-0"
                title={att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf' ? 'Preview' : ''}
              >
                {fileIcon(att.mimeType)}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{att.originalName}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {formatSize(att.fileSize)} &middot; v{att.version} &middot; {new Date(att.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setVersionHistoryId(att.id)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Version history" aria-label="Version history">
                  <Clock className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDownload(att)} className="p-1 text-gray-400 hover:text-primary-600" title="Download" aria-label="Download file">
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setDeleteConfirmId(att.id)}
                  className="p-1 text-gray-400 hover:text-red-600" title="Delete" aria-label="Delete file"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Version history modal */}
      {versionHistoryId && (
        <AttachmentVersionHistory
          attachmentId={versionHistoryId}
          onClose={() => setVersionHistoryId(null)}
        />
      )}

      {/* Preview modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setPreviewUrl(null); }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 max-w-3xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <img src={previewUrl} alt="Preview" className="max-w-full" onError={() => setPreviewUrl(null)} />
          </div>
        </div>
      )}

      {deleteConfirmId && (
        <ConfirmModal
          title="Delete File"
          message="Delete this file? This cannot be undone."
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => { deleteMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
}

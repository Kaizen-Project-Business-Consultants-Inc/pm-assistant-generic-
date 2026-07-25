import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, Download } from 'lucide-react';
import { apiService } from '../../services/api';

interface AttachmentVersionHistoryProps {
  attachmentId: string;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentVersionHistory({ attachmentId, onClose }: AttachmentVersionHistoryProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['attachment-versions', attachmentId],
    queryFn: () => apiService.getAttachmentVersions(attachmentId),
  });

  const versions: any[] = data?.versions || [];

  const uploadVersionMutation = useMutation({
    mutationFn: (file: File) => apiService.uploadAttachmentVersion(attachmentId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachment-versions', attachmentId] });
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
    },
  });

  const handleDownload = async (v: any) => {
    try {
      const blob = await apiService.downloadAttachment(v.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = v.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-h-[80vh] flex flex-col" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Version History</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No versions found</p>
          ) : (
            versions.map((v: any) => (
              <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">v{v.version}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{v.originalName} &middot; {formatSize(v.fileSize)}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(v.createdAt).toLocaleString()}</p>
                </div>
                <button onClick={() => handleDownload(v)} className="p-1.5 text-gray-400 hover:text-primary-600">
                  <Download className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
          <button
            onClick={() => document.getElementById('version-upload')?.click()}
            disabled={uploadVersionMutation.isPending}
            className="btn btn-primary w-full flex items-center justify-center gap-2 text-sm"
          >
            <Upload className="w-4 h-4" />
            {uploadVersionMutation.isPending ? 'Uploading…' : 'Upload New Version'}
          </button>
          <input
            id="version-upload"
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadVersionMutation.mutate(file);
            }}
          />
        </div>
      </div>
    </div>
  );
}

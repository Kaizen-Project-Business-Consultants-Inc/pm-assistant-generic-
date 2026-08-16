import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, FileText, AlertTriangle, CheckCircle } from 'lucide-react';
import { apiService } from '../../services/api';

interface ResourceImportModalProps {
  onClose: () => void;
}

export function ResourceImportModal({ onClose }: ResourceImportModalProps) {
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<string[][]>([]);

  const importMutation = useMutation({
    mutationFn: (csv: string) => apiService.importResources(csv),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
    },
  });

  const handleFile = useCallback((file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      alert('File exceeds 5MB limit');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvText(text);
      // Parse preview (first 6 rows)
      const lines = text.split('\n').filter(l => l.trim());
      const rows = lines.slice(0, 6).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      setPreview(rows);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleImport = () => {
    if (!csvText.trim()) return;
    importMutation.mutate(csvText);
  };

  const result = importMutation.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Import Resources from CSV</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* CSV Format Info */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">Expected CSV columns:</p>
            <code className="text-[11px] text-blue-600 dark:text-blue-400">name, role, email, capacityHoursPerWeek, skills (semicolon-separated), costRateHourly, resourceGroup</code>
          </div>

          {/* File Drop Zone */}
          {!result && (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-primary-400 transition-colors"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.csv';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFile(file);
                };
                input.click();
              }}
            >
              {fileName ? (
                <div className="flex items-center justify-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <FileText className="w-5 h-5 text-primary-500" />
                  {fileName}
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 mx-auto text-gray-400" />
                  <p className="text-sm text-gray-500">Drop a CSV file here or click to browse</p>
                  <p className="text-xs text-gray-400">Max 5MB, up to 200 resources</p>
                </div>
              )}
            </div>
          )}

          {/* Preview Table */}
          {preview.length > 1 && !result && (
            <div className="overflow-x-auto">
              <p className="text-xs font-medium text-gray-500 mb-1">Preview (first {Math.min(preview.length - 1, 5)} rows)</p>
              <table className="w-full text-xs border border-gray-200 dark:border-gray-700">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700">
                    {preview[0].map((h, i) => (
                      <th key={i} className="px-2 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-300">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(1).map((row, ri) => (
                    <tr key={ri} className="border-t border-gray-100 dark:border-gray-700">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 text-gray-700 dark:text-gray-400">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-gray-700 dark:text-gray-300">
                  <strong>{result.created}</strong> of {result.total} resources imported successfully
                </span>
              </div>
              {result.errors?.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-semibold text-red-700 dark:text-red-400">{result.errors.length} error{result.errors.length > 1 ? 's' : ''}</span>
                  </div>
                  <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
                    {result.errors.slice(0, 10).map((e: { row: number; error: string }, i: number) => (
                      <li key={i}>Row {e.row}: {e.error}</li>
                    ))}
                    {result.errors.length > 10 && <li>...and {result.errors.length - 10} more</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          {result ? (
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700">
              Done
            </button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
              <button
                onClick={handleImport}
                disabled={!csvText.trim() || importMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {importMutation.isPending ? 'Importing...' : 'Import'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

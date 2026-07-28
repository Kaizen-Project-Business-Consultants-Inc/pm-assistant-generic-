import React, { useState } from 'react';
import { Download, Trash2, AlertTriangle } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

export const DangerZoneTab: React.FC = () => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteInput, setDeleteInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    try {
      const projectList = await apiService.getProjects();
      const projectExports = await Promise.all(
        projectList.map(async (project: { id: number }) => {
          try {
            return await apiService.request('get', `/exports/projects/${project.id}/export?format=json`);
          } catch {
            return { projectId: project.id, error: 'Failed to export' };
          }
        })
      );
      const data = {
        exportedAt: new Date().toISOString(),
        projects: projectExports,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pm-assistant-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (deleteInput !== 'DELETE') return;
    try {
      await apiService.deleteAccount();
      window.location.href = '/';
    } catch (err: unknown) {
      setDeleteError(getApiErrorMessage(err, 'Failed to delete account. Please try again.'));
      setShowDeleteConfirm(false);
      setDeleteInput('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Export Data</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Download a copy of all your data including projects, tasks, and settings.</p>
        <button onClick={handleExport} disabled={exporting} className="flex items-center gap-2 bg-gray-800 dark:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-900 dark:hover:bg-gray-500 transition-colors disabled:opacity-50">
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting…' : 'Export All Data'}
        </button>
        {exportError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{exportError}</p>}
      </div>
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 p-6">
        <h2 className="text-lg font-semibold text-red-900 dark:text-red-300 mb-2">Delete Account</h2>
        <p className="text-sm text-red-700 dark:text-red-400 mb-4">Permanently delete your account and all associated data. This action cannot be undone.</p>
        {deleteError && <p className="mb-3 text-sm text-red-600 dark:text-red-400 font-medium">{deleteError}</p>}
        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition-colors">
            <Trash2 className="w-4 h-4" /> Delete Account
          </button>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-300">Are you absolutely sure?</p>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-1">This will permanently delete your account, all projects, tasks, and data. This action is irreversible.</p>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-2">Type <span className="font-mono font-bold">DELETE</span> to confirm:</p>
                  <input type="text" value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} placeholder="Type DELETE to confirm" className="mt-2 w-full max-w-xs rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleDelete} disabled={deleteInput !== 'DELETE'} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <Trash2 className="w-4 h-4" /> Permanently Delete
              </button>
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

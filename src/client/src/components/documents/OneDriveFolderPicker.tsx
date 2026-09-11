import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, ChevronRight, ChevronDown, Loader2, Check } from 'lucide-react';
import { apiService } from '../../services/api';

interface OneDriveFolderPickerProps {
  projectId: string;
  connectorId: string;
  onSave: (folderIds: string[]) => void;
  onCancel: () => void;
}

export function OneDriveFolderPicker({ projectId, connectorId, onSave, onCancel }: OneDriveFolderPickerProps) {
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((folderId: string) => {
    setSelectedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Select the folders to sync. Only supported file types (PDF, DOCX, TXT, CSV, MD) under 10MB will be imported.
      </p>
      <div className="border rounded-lg p-2 max-h-60 overflow-y-auto bg-white dark:bg-gray-800 dark:border-gray-600">
        <FolderLevel
          projectId={projectId}
          connectorId={connectorId}
          parentId={undefined}
          selectedFolders={selectedFolders}
          expandedFolders={expandedFolders}
          onToggleSelect={toggleSelection}
          onToggleExpand={toggleExpand}
          depth={0}
        />
      </div>
      {selectedFolders.size === 0 && (
        <p className="text-xs text-gray-400">No folders selected — all files in the drive will be synced.</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
          onClick={() => onSave(Array.from(selectedFolders))}
        >
          Save ({selectedFolders.size} folder{selectedFolders.size !== 1 ? 's' : ''})
        </button>
      </div>
    </div>
  );
}

function FolderLevel({
  projectId, connectorId, parentId, selectedFolders, expandedFolders,
  onToggleSelect, onToggleExpand, depth,
}: {
  projectId: string;
  connectorId: string;
  parentId: string | undefined;
  selectedFolders: Set<string>;
  expandedFolders: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  depth: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['connector-browse', connectorId, parentId || 'root'],
    queryFn: () => apiService.browseConnectorFolder(projectId, connectorId, parentId),
    staleTime: 60_000,
  });

  const items: any[] = data?.items || [];
  const folders = items.filter((item: any) => item.isFolder);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 pl-4">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        <span className="text-xs text-gray-400">Loading...</span>
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-1" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
        No subfolders
      </p>
    );
  }

  return (
    <div>
      {folders.map((folder: any) => {
        const isExpanded = expandedFolders.has(folder.id);
        const isSelected = selectedFolders.has(folder.id);

        return (
          <div key={folder.id}>
            <div
              className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              style={{ paddingLeft: `${depth * 20 + 4}px` }}
            >
              <button
                className="p-0.5 text-gray-400 hover:text-gray-600"
                onClick={() => onToggleExpand(folder.id)}
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              <button
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  isSelected
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : 'border-gray-300 dark:border-gray-500'
                }`}
                onClick={() => onToggleSelect(folder.id)}
              >
                {isSelected && <Check className="w-3 h-3" />}
              </button>
              <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
              <span className="text-sm truncate" onClick={() => onToggleExpand(folder.id)}>
                {folder.name}
              </span>
              {folder.childCount > 0 && (
                <span className="text-xs text-gray-400 ml-1">({folder.childCount})</span>
              )}
            </div>
            {isExpanded && (
              <FolderLevel
                projectId={projectId}
                connectorId={connectorId}
                parentId={folder.id}
                selectedFolders={selectedFolders}
                expandedFolders={expandedFolders}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

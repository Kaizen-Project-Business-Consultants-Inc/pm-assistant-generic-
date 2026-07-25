import React, { useCallback } from 'react';
import { Search } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueryInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const QueryInput: React.FC<QueryInputProps> = ({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = 'Ask anything about your projects...',
}) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !isLoading && value.trim()) {
        e.preventDefault();
        onSubmit();
      }
    },
    [isLoading, onSubmit, value]
  );

  return (
    <div className="relative flex items-center">
      {/* Search icon */}
      <div className="absolute left-4 pointer-events-none">
        <Search className="w-5 h-5 text-gray-400 dark:text-gray-500" />
      </div>

      {/* Input */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        className="w-full pl-12 pr-28 py-4 text-base border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent shadow-sm disabled:opacity-60 disabled:cursor-not-allowed bg-white dark:bg-gray-800 dark:text-white dark:placeholder-gray-400"
      />

      {/* Submit button */}
      <button
        onClick={onSubmit}
        disabled={isLoading || !value.trim()}
        className="absolute right-2 btn btn-primary flex items-center gap-2 text-sm py-2.5 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Searching…
          </>
        ) : (
          <>
            <Search className="w-4 h-4" />
            Search
          </>
        )}
      </button>
    </div>
  );
};

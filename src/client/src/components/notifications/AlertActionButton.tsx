import { useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

interface AlertActionButtonProps {
  toolName: string;
  params: Record<string, any>;
  label: string;
  onComplete?: (result: any) => void;
}

export function AlertActionButton({ toolName, params, label, onComplete }: AlertActionButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiService.executeAlertAction({ toolName, params });
      onComplete?.(result);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Action failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-start">
      <button
        onClick={handleClick}
        disabled={loading}
        className="
          inline-flex items-center gap-1.5 px-2.5 py-1
          text-xs font-medium text-primary-700 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20
          border border-primary-200 dark:border-primary-800 rounded-md
          hover:bg-primary-100 dark:hover:bg-primary-900/30 hover:border-primary-300 dark:hover:border-primary-700
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors duration-150
        "
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Zap className="w-3 h-3" />
        )}
        {label}
      </button>
      {error && (
        <span className="text-xs text-red-500 dark:text-red-400 mt-1 max-w-[200px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

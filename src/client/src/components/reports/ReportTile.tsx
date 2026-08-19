import type { ReportDefinition } from './reportCatalog';

interface ReportTileProps {
  report: ReportDefinition;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export const ReportTile: React.FC<ReportTileProps> = ({ report, disabled, loading, onClick }) => {
  const Icon = report.icon;
  const isAI = report.badge === 'ai';

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`group relative flex items-start gap-3 p-4 rounded-lg border text-left transition-all
        ${disabled
          ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 opacity-60 cursor-not-allowed'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md cursor-pointer'
        }`}
    >
      {disabled && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="whitespace-nowrap rounded-lg bg-gray-900 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
            Please select a project to generate this report
          </div>
          <div className="mx-auto w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45 -mt-1" />
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-800/70 rounded-lg z-10">
          <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}
      <div className={`mt-0.5 p-2 rounded-lg ${isAI ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
        <Icon className={`w-4 h-4 ${isAI ? 'text-indigo-500 dark:text-indigo-400' : 'text-emerald-500 dark:text-emerald-400'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{report.name}</span>
          <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider
            ${isAI
              ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
              : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {isAI ? 'AI' : 'Instant'}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{report.description}</p>
        {disabled && (
          <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">Select a project first</p>
        )}
      </div>
    </button>
  );
};

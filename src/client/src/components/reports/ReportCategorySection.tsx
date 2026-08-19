import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReportCategory, ReportDefinition } from './reportCatalog';
import { ReportTile } from './ReportTile';

interface ReportCategorySectionProps {
  category: ReportCategory;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  generatingReportType: string | null;
  onReportClick: (report: ReportDefinition) => void;
}

export const ReportCategorySection: React.FC<ReportCategorySectionProps> = ({
  category,
  expanded,
  onToggle,
  disabled,
  generatingReportType,
  onReportClick,
}) => {
  const Icon = category.icon;

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
        <Icon className="w-4 h-4 text-primary-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{category.title}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{category.reports.length}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-4">
          {disabled && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
              Select a project above to generate reports
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {category.reports.map(report => (
              <ReportTile
                key={report.id}
                report={report}
                disabled={disabled}
                loading={generatingReportType === report.id}
                onClick={() => onReportClick(report)}
              />
            ))}
          </div>

          {category.seeAlso && category.seeAlso.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              {category.seeAlso.map(link => (
                <Link
                  key={link.path}
                  to={link.path}
                  className="inline-flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                >
                  {link.label}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

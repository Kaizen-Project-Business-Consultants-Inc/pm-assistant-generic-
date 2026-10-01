import React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Project page (2026-10-01): on every tab except Overview the four summary cards become this one
 * line, so the work area starts higher. "Show details" brings the cards back on those tabs too
 * (remembered — see ProjectDetailPage). Clicking a figure opens Overview.
 */
export interface SummaryItem {
  key: string;
  /** e.g. "9%" */
  value: string;
  /** e.g. "done" */
  text: string;
  /** extra words after, e.g. "1 critical" */
  alert?: string;
}

interface Props {
  items: SummaryItem[];
  onOpenOverview: () => void;
  onShowDetails: () => void;
}

export const ProjectSummaryLine: React.FC<Props> = ({ items, onOpenOverview, onShowDetails }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label="Project summary">
    {items.map((it, i) => (
      <React.Fragment key={it.key}>
        {i > 0 && <span className="text-gray-300 dark:text-gray-600" aria-hidden="true">|</span>}
        <button
          type="button"
          onClick={onOpenOverview}
          title="Open Overview"
          className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{it.value}</span> {it.text}
          {it.alert && <span className="text-red-600 dark:text-red-400 font-medium"> · {it.alert}</span>}
        </button>
      </React.Fragment>
    ))}
    <button
      type="button"
      onClick={onShowDetails}
      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
    >
      Show details <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  </div>
);

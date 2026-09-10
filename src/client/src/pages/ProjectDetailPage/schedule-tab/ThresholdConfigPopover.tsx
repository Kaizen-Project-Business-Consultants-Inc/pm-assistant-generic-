import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings } from 'lucide-react';
import type { RiskThresholds } from '../../../utils/taskRiskAssessment';
import { DEFAULT_RISK_THRESHOLDS } from '../../../utils/taskRiskAssessment';

interface ThresholdConfigPopoverProps {
  thresholds: RiskThresholds;
  onChange: (t: RiskThresholds) => void;
}

export function ThresholdConfigPopover({ thresholds, onChange }: ThresholdConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleClickOutside, handleKeyDown]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-center w-7 h-7 rounded-md border transition-colors ${
          open
            ? 'border-primary-300 bg-primary-50 dark:bg-primary-900/20 text-primary-600'
            : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
        title="Risk threshold settings"
        aria-label="Risk threshold settings"
        aria-expanded={open}
      >
        <Settings className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 z-50 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 space-y-3"
        >
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Risk Thresholds</p>

          <label className="block">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">At Risk gap (%)</span>
            <input
              type="number"
              min={1}
              max={99}
              value={thresholds.atRiskGapPct}
              onChange={(e) => onChange({ ...thresholds, atRiskGapPct: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
              className="mt-0.5 w-full text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-primary-500"
            />
          </label>

          <label className="block">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Critical gap (%)</span>
            <input
              type="number"
              min={1}
              max={99}
              value={thresholds.criticalGapPct}
              onChange={(e) => onChange({ ...thresholds, criticalGapPct: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
              className="mt-0.5 w-full text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-primary-500"
            />
          </label>

          <button
            onClick={() => onChange({ ...DEFAULT_RISK_THRESHOLDS })}
            className="w-full text-[11px] text-primary-600 dark:text-primary-400 hover:underline text-center"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

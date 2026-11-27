import { DONE_OPTIONS } from './shared/progressStyle';

const labelClass = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1';

/** The task form's progress control: a 0-100% slider, or a Done / Not done choice in a done / not done plan */
export function ProgressInput({ id, value, onChange, disabled, doneOnly }: {
  id: string; value: number; onChange: (v: number) => void; disabled?: boolean; doneOnly: boolean;
}) {
  if (doneOnly) {
    return (
      <div>
        <label htmlFor={id} className={labelClass}>Progress</label>
        <select
          id={id}
          value={value >= 100 ? '100' : '0'}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
        >
          {DONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className={labelClass}>Progress: {value}%</label>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        step="5"
        value={value}
        onChange={(e) => onChange(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
        disabled={disabled}
        className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary-600"
      />
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

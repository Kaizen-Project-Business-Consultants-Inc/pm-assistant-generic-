import React, { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { exportTasksCSV } from '../../../utils/exportUtils';

interface GanttExportDropdownProps {
  ganttContainerId: string;
  scheduleName: string;
  tasks: any[];
}

export const GanttExportDropdown = React.memo(function GanttExportDropdown({ ganttContainerId, scheduleName, tasks }: GanttExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handlePrint = () => {
    setOpen(false);
    const el = document.getElementById(ganttContainerId);
    if (el) { el.style.maxHeight = 'none'; el.style.overflow = 'visible'; }
    window.print();
    if (el) { el.style.maxHeight = '70vh'; el.style.overflow = 'hidden'; }
  };

  const handlePdfExport = async () => {
    setExporting('pdf');
    setOpen(false);
    try {
      const el = document.getElementById(ganttContainerId);
      if (!el) return;

      // Temporarily expand for capture
      const origMaxHeight = el.style.maxHeight;
      const origOverflow = el.style.overflow;
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';

      const html2pdf = (await import('html2pdf.js')).default;
      const opts: any = {
        margin: [5, 5, 5, 5],
        filename: `${scheduleName}-gantt.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 1.5, useCORS: true, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all'] },
      };
      await html2pdf().set(opts).from(el).save();

      el.style.maxHeight = origMaxHeight;
      el.style.overflow = origOverflow;
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const handlePngExport = async () => {
    setExporting('png');
    setOpen(false);
    try {
      const el = document.getElementById(ganttContainerId);
      if (!el) return;

      const origMaxHeight = el.style.maxHeight;
      const origOverflow = el.style.overflow;
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';

      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(el, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });

      el.style.maxHeight = origMaxHeight;
      el.style.overflow = origOverflow;

      // Trigger download
      const link = document.createElement('a');
      link.download = `${scheduleName}-gantt.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const handleCsvExport = () => {
    setOpen(false);
    exportTasksCSV(tasks, scheduleName);
  };

  const btnClass = 'w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors';

  return (
    <div className="relative print:hidden" ref={dropdownRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        title="Export Gantt chart"
      >
        <Download className="w-3.5 h-3.5" />
        Export
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        {exporting && <span className="ml-1 w-3 h-3 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1">
          <button onClick={handlePdfExport} className={btnClass} disabled={!!exporting}>
            PDF (A3 Landscape)
          </button>
          <button onClick={handlePngExport} className={btnClass} disabled={!!exporting}>
            PNG Image
          </button>
          <button onClick={handlePrint} className={btnClass}>
            Print
          </button>
          <div className="border-t border-gray-100 dark:border-gray-700 my-0.5" />
          <button onClick={handleCsvExport} className={btnClass}>
            CSV (Task Data)
          </button>
        </div>
      )}
    </div>
  );
});

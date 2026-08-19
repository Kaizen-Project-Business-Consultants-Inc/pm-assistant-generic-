import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldAlert, X, Download, Loader2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../../services/api';

export function StrategicRiskScanModal({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const [scanResult, setScanResult] = useState<any>(null);
  const [isSample, setIsSample] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiService.runStrategicRiskScan(projectId),
    onSuccess: (data) => {
      if (data?.sample || data?.result) {
        setScanResult(data);
        if (data?.sample) setIsSample(true);
        setScanning(false);
      } else if (data?.status === 'scanning') {
        setScanning(true);
        setScanError(null);
      }
    },
    onError: () => {
      setScanning(false);
      setScanError('Failed to start risk scan. Please try again.');
    },
  });

  // Auto-trigger on mount
  useEffect(() => {
    mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for background scan results via WebSocket
  useEffect(() => {
    const handleReady = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.projectId === projectId) {
        setScanResult({ result: detail.result });
        setScanning(false);
      }
    };
    const handleFailed = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.projectId === projectId) {
        setScanning(false);
        setScanError(detail.error || 'Risk scan failed');
      }
    };
    window.addEventListener('ws:strategic_risk_scan_ready', handleReady);
    window.addEventListener('ws:strategic_risk_scan_failed', handleFailed);
    return () => {
      window.removeEventListener('ws:strategic_risk_scan_ready', handleReady);
      window.removeEventListener('ws:strategic_risk_scan_failed', handleFailed);
    };
  }, [projectId]);

  const html = scanResult?.result?.html || '';

  const handleExportPDF = async () => {
    const html2pdf = (await import('html2pdf.js')).default;
    const container = document.createElement('div');
    container.innerHTML = DOMPurify.sanitize(html);
    html2pdf().set({
      margin: [10, 10, 10, 10],
      filename: `risk-scan-${projectName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(container).save();
  };

  const handleExportHTML = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `risk-scan-${projectName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl mx-4 my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Strategic Risk Scan</h2>
            {isSample && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Sample</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {html && (
              <>
                <button
                  onClick={handleExportPDF}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  onClick={handleExportHTML}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  HTML
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {scanning && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-amber-500" />
              <p className="text-sm font-medium">Analyzing project plan for structural risks...</p>
              <p className="text-xs mt-1 text-gray-400">This may take a few moments</p>
            </div>
          )}

          {scanError && (
            <div className="text-center py-16">
              <p className="text-red-600 dark:text-red-400 text-sm font-medium">{scanError}</p>
              <button
                onClick={() => { setScanError(null); mutation.mutate(); }}
                className="mt-3 px-4 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                Retry Scan
              </button>
            </div>
          )}

          {html && !scanning && (
            <div
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
              className="strategic-risk-report"
            />
          )}

          {!scanning && !scanError && !html && (
            <div className="text-center py-16 text-gray-400 text-sm">
              Starting scan...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

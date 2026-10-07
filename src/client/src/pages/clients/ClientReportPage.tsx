import { useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { FileDown, FileText, Mail, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { ROUTES } from '../../routes';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { useCanManageClients } from '../../hooks/useCanManageClients';
import { AccessibleModal } from '../../components/ui/AccessibleModal';

interface ClientReportResponse {
  report: { client: { id: string; name: string }; period?: string; today?: string };
  html: string;
}

const buttonClass = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50';

/**
 * The client report (Oct 2026): one report across all a client's projects — shown here, saved as
 * PDF (in the browser, like the status report) or Word (from the server), or emailed to the client.
 */
export function ClientReportPage() {
  const { id } = useParams<{ id: string }>();
  const uid = useId();
  const canEmail = useCanManageClients();
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipients, setRecipients] = useState('');

  const { data, isLoading, error } = useQuery<ClientReportResponse>({
    queryKey: ['client-report', id],
    queryFn: () => apiService.getClientReport(id!),
    enabled: !!id,
  });

  const name = data?.report?.client?.name || 'Client';
  const html = data?.html || '';
  const fileBaseName = `client-report-${name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

  const handlePdf = async () => {
    if (!reportRef.current) return;
    setExporting('pdf');
    setExportError(null);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `${fileBaseName}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(reportRef.current)
        .save();
    } catch {
      setExportError('The PDF could not be made. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const handleWord = async () => {
    if (!id) return;
    setExporting('docx');
    setExportError(null);
    try {
      const blob = await apiService.downloadClientReportDocx(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBaseName}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('The Word file could not be made. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const emailMutation = useMutation({
    mutationFn: (list: string[]) => apiService.emailClientReport(id!, list),
  });

  const recipientList = recipients.split(',').map(e => e.trim()).filter(Boolean);

  const openEmail = () => {
    emailMutation.reset();
    setEmailOpen(true);
  };

  const closeEmail = () => {
    setEmailOpen(false);
    if (emailMutation.isSuccess) setRecipients('');
  };

  return (
    <div className="p-6 space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-gray-500 dark:text-gray-400">
        <Link to={ROUTES.clients} className="hover:underline text-primary-600 dark:text-primary-400">Clients</Link>
        <span className="mx-1.5" aria-hidden="true">›</span>
        <span className="text-gray-700 dark:text-gray-200">{name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Client report — {name}</h1>
          {data?.report?.period && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{data.report.period}</p>}
        </div>
        {html && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handlePdf} disabled={exporting !== null} className={buttonClass}>
              <FileDown className="w-4 h-4" />
              {exporting === 'pdf' ? 'Making PDF…' : 'PDF'}
            </button>
            <button type="button" onClick={handleWord} disabled={exporting !== null} className={buttonClass}>
              <FileText className="w-4 h-4" />
              {exporting === 'docx' ? 'Making Word file…' : 'Word'}
            </button>
            {canEmail && (
              <button
                type="button"
                onClick={openEmail}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors shadow-sm"
              >
                <Mail className="w-4 h-4" />
                Email to client
              </button>
            )}
          </div>
        )}
      </div>

      {exportError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">{exportError}</p>
      )}

      {isLoading ? (
        <div className="h-96 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
      ) : error ? (
        <div role="alert" className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(error, 'Could not make this client report. Please try again.')}
        </div>
      ) : html ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-4 overflow-x-auto">
          <div ref={reportRef} className="client-report-container" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
        </div>
      ) : null}

      <AccessibleModal
        isOpen={emailOpen}
        onClose={closeEmail}
        ariaLabel="Email the client report"
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Email to client</h2>
          <button type="button" aria-label="Close" onClick={closeEmail} className="p-1 text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form
          className="px-5 py-4 space-y-3"
          onSubmit={e => { e.preventDefault(); if (recipientList.length > 0) emailMutation.mutate(recipientList); }}
        >
          <div>
            <label htmlFor={`${uid}-recipients`} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Send to (emails, separated by commas)
            </label>
            <input
              id={`${uid}-recipients`}
              type="text"
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
              placeholder="name@client.com, other@client.com"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          {emailMutation.isError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {getApiErrorMessage(emailMutation.error, 'The report could not be sent. Please try again.')}
            </p>
          )}
          {emailMutation.isSuccess && (
            <p role="status" className="text-sm text-green-700 dark:text-green-400">Sent. The report is on its way.</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeEmail} className={buttonClass}>
              {emailMutation.isSuccess ? 'Done' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={recipientList.length === 0 || emailMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {emailMutation.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </AccessibleModal>
    </div>
  );
}

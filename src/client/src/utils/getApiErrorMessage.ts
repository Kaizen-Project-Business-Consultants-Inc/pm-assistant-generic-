/**
 * Extract a human-readable error message from an Axios error or generic Error.
 * Falls back to the provided default message.
 */
export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err && typeof err === 'object') {
    // Too big for the web server or the app: nginx answers with an HTML page, so say it plainly
    if ((err as any).response?.status === 413) return 'This is too big to send. Files can be up to 10 MB.';
    const axiosData = (err as any).response?.data;
    if (axiosData?.message && typeof axiosData.message === 'string') return axiosData.message;
    // Some routes answer with only { error: "<sentence>" } (e.g. "File too large. Maximum size is 2MB.")
    if (axiosData?.error && typeof axiosData.error === 'string') return axiosData.error;
    if ((err as any).message && typeof (err as any).message === 'string') return (err as any).message;
  }
  return fallback;
}

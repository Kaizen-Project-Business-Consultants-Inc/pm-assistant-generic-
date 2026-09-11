import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

export function OAuthCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const success = params.get('success');
    const connectorId = params.get('connectorId');
    const provider = params.get('provider');

    if (error) {
      setStatus('error');
      setMessage(error === 'missing_params' ? 'Missing authorization parameters' : error);
    } else if (success === 'true') {
      setStatus('success');
      setMessage(`${provider || 'Storage'} connected successfully`);
    } else {
      setStatus('loading');
      setMessage('Completing authorization...');
    }

    // Post result to parent window (opener)
    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'oauth-callback',
          success: success === 'true',
          error: error || null,
          connectorId: connectorId || null,
          provider: provider || null,
        },
        window.location.origin,
      );
      // Close after a short delay so user sees the status
      setTimeout(() => window.close(), 1500);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center p-8">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 mx-auto text-primary-500 animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-300">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
            <p className="text-gray-700 dark:text-gray-200 font-medium">{message}</p>
            <p className="text-sm text-gray-500 mt-2">This window will close automatically.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 mx-auto text-red-500 mb-4" />
            <p className="text-gray-700 dark:text-gray-200 font-medium">Authorization failed</p>
            <p className="text-sm text-red-500 mt-1">{message}</p>
            <button
              className="mt-4 text-sm text-primary-600 hover:underline"
              onClick={() => window.close()}
            >
              Close this window
            </button>
          </>
        )}
      </div>
    </div>
  );
}

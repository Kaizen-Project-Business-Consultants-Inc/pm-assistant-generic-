import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const CONSENT_KEY = 'kovarti_analytics_consent';
const GA_ID = 'G-46RCPEQRE5';

function loadGA4() {
  if (document.querySelector(`script[src*="googletagmanager"]`)) return;
  const script = document.createElement('script');
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  script.async = true;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  function gtag(...args: any[]) { window.dataLayer!.push(args); }
  gtag('js', new Date());
  gtag('config', GA_ID);
}

declare global {
  interface Window {
    dataLayer?: any[];
  }
}

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === 'accepted') {
      loadGA4();
    } else if (consent !== 'declined') {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    loadGA4();
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(CONSENT_KEY, 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[100] p-4 sm:p-0"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="mx-auto max-w-3xl sm:mb-4 rounded-xl bg-gray-900 text-white shadow-2xl border border-gray-700 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <p className="text-sm flex-1">
          We use cookies for analytics to improve our service.
          See our{' '}
          <Link to="/privacy" className="underline text-primary-400 hover:text-primary-300">
            Privacy Policy
          </Link>{' '}
          for details.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleDecline}
            className="px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="px-3 py-1.5 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

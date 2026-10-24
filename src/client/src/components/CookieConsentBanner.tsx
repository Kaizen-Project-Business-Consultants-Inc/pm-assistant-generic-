import { useState, useEffect, useLayoutEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

const CONSENT_KEY = 'kovarti_analytics_consent';
const GA_ID = 'G-46RCPEQRE5';

/**
 * Analytics runs on the live site only (2026-10-02): staging, test runs and the demo-video
 * recorder were landing in the same Google Analytics reports as real visitors.
 */
const ANALYTICS_HOSTS = ['kovarti.com', 'www.kovarti.com'];
export const analyticsEnabled = (hostname: string = window.location.hostname) => ANALYTICS_HOSTS.includes(hostname);

function loadGA4() {
  if (!analyticsEnabled()) return;
  if (document.querySelector(`script[src*="googletagmanager"]`)) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer!.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
  const script = document.createElement('script');
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Microsoft Clarity (session replay) records the public marketing pages only (2026-10-23): it must
 * never watch customers' project screens, so it is stopped as soon as the visitor leaves them.
 */
const CLARITY_ID = 'z2hrnr3p8p';
const CLARITY_PUBLIC_PATHS = ['/', '/pricing', '/features', '/about', '/roadmap', '/terms', '/privacy'];
export const clarityAllowedOn = (pathname: string) => CLARITY_PUBLIC_PATHS.includes(pathname.replace(/(.)\/$/, '$1'));

function syncClarity(pathname: string) {
  if (!analyticsEnabled()) return;
  if (!clarityAllowedOn(pathname)) {
    window.clarity?.('stop');
    return;
  }
  if (window.clarity) {
    window.clarity('start');
    return;
  }
  window.clarity = function (...args: unknown[]) { (window.clarity!.q = window.clarity!.q || []).push(args); };
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${CLARITY_ID}`;
  document.head.appendChild(script);
  // No advertising storage: this is analytics only (the banner asks for analytics cookies)
  window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
}

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    clarity?: ((...args: any[]) => void) & { q?: any[] };
  }
}

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    // No analytics here, so nothing to ask about
    if (!analyticsEnabled()) return;
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === 'accepted') {
      loadGA4();
      setAccepted(true);
    } else if (consent !== 'declined') {
      setVisible(true);
    }
  }, []);

  // Layout effect: stop recording in the same task as the navigation, before Clarity sees the app's first DOM
  useLayoutEffect(() => {
    if (accepted) syncClarity(pathname);
  }, [accepted, pathname]);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    loadGA4();
    setAccepted(true);
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
            className="px-3 py-1.5 text-sm font-medium bg-primary-700 hover:bg-primary-800 text-white rounded-lg transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

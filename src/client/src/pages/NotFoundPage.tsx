import { useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import { apiService } from '../services/api';
import { SUPPORT_EMAIL } from '../constants/branding';

export function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Log the 404 to telemetry
  useEffect(() => {
    apiService.request('post', '/telemetry/404', {
      path: location.pathname,
      referrer: document.referrer || null,
    }).catch(() => { /* best effort */ });
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <p className="text-6xl font-bold text-gray-200">404</p>
        <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">Page not found</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 btn btn-primary bg-gray-600 hover:bg-gray-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 btn btn-primary"
          >
            <Home className="w-4 h-4" />
            Home
          </Link>
        </div>
        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
          Need help?{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Help - Page Not Found')}&body=${encodeURIComponent(`I couldn't find the page I was looking for.\n\nPage: ${window.location.href}\nTime: ${new Date().toISOString()}`)}`}
            className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
          >
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}

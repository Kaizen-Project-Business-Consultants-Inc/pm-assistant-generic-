import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { isUpdateAvailable, onUpdateAvailable, reloadForUpdate } from '../utils/appUpdate';

/**
 * Shown when a newer version of the app has been deployed (see utils/appUpdate.ts).
 * Reloads by itself on the next page change; "Reload now" does it straight away.
 * Lives inside the Router so it can see navigation.
 */
export function AppUpdateBanner() {
  const [available, setAvailable] = useState(isUpdateAvailable());
  const location = useLocation();
  const firstPath = useRef(location.pathname + location.search);

  useEffect(() => onUpdateAvailable(setAvailable), []);

  // Moving to another page is a natural break: pick up the new version then.
  useEffect(() => {
    const here = location.pathname + location.search;
    if (available && here !== firstPath.current) void reloadForUpdate();
    firstPath.current = here;
  }, [location.pathname, location.search, available]);

  if (!available) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[9999] flex items-center justify-center gap-3 px-4 py-2 bg-ai-primary text-white text-sm shadow-md"
    >
      <RefreshCw className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span>A new version of Kovarti is ready. It will load when you next change page.</span>
      <button
        type="button"
        onClick={() => void reloadForUpdate(true)}
        className="px-3 py-1 rounded-md bg-white text-ai-primary font-semibold hover:bg-ai-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ai-primary"
      >
        Reload now
      </button>
    </div>
  );
}

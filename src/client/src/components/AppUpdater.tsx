import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isUpdateAvailable, onUpdateAvailable, reloadForUpdate } from '../utils/appUpdate';

/**
 * Picks up a newly deployed version without telling anyone (product owner, 2026-10-01: no
 * "new version" banner). Two quiet moments, both safe for anything being typed:
 *  - the next in-app page change (the page is being left anyway);
 *  - a tab that has sat in the background a few minutes with no dialog or edit in progress
 *    (utils/appUpdate.ts → startAppUpdateChecks).
 * Lives inside the Router so it can see navigation. Renders nothing.
 */
export function AppUpdater() {
  const [available, setAvailable] = useState(isUpdateAvailable());
  const location = useLocation();
  const firstPath = useRef(location.pathname + location.search);

  useEffect(() => onUpdateAvailable(setAvailable), []);

  useEffect(() => {
    const here = location.pathname + location.search;
    if (available && here !== firstPath.current) void reloadForUpdate();
    firstPath.current = here;
  }, [location.pathname, location.search, available]);

  return null;
}

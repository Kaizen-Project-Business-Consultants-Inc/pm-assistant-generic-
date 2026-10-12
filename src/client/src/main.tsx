import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { setServiceWorkerRegistration, startAppUpdateChecks } from './utils/appUpdate';
import { queryClient } from './queryClient';
import { watchSignedInUser } from './utils/signedInUser';

// Notice new deploys in open tabs (see utils/appUpdate.ts) — independent of the service worker
startAppUpdateChecks();
import './index.css';

registerSW({
  immediate: true,
  // No prompt and no reload of its own: utils/appUpdate.ts loads new versions quietly at a
  // safe moment (next page change, or a background tab with nothing being edited).
  onOfflineReady() {
    // Silently ready for offline use
  },
  onRegisteredSW(_swUrl, registration) {
    setServiceWorkerRegistration(registration);
    if (registration) {
      // Check for SW updates every 60 seconds
      setInterval(() => { registration.update(); }, 60 * 1000);
    }
  },
});

// Everything cached belongs to the signed-in person: dropped when they sign out or someone else signs in
watchSignedInUser(queryClient);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

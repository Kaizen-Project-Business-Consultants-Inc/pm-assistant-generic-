import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

registerSW({
  immediate: true,
  onNeedRefresh() {
    // New version deployed — reload to pick up new assets.
    // With registerType: 'autoUpdate' + skipWaiting + clientsClaim,
    // the new SW is already active; just reload the page.
    window.location.reload();
  },
  onOfflineReady() {
    // Silently ready for offline use
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Check for SW updates every 30 seconds
      setInterval(() => { registration.update(); }, 30 * 1000);
    }
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 10,
      gcTime: 1000 * 60 * 15,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: true,
      retry: (failureCount, error: unknown) => {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError?.response?.status === 401) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

registerSW({
  immediate: true,
  onNeedRefresh() {
    // Show a toast so the user can reload when ready
    if (document.getElementById('sw-update-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'sw-update-toast';
    toast.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;align-items:center;gap:12px;' +
      'background:#1e293b;color:#f1f5f9;padding:12px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);' +
      'font-family:system-ui,sans-serif;font-size:13px;animation:slideUp .3s ease-out';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML =
      '<span>A new version is available</span>' +
      '<button id="sw-update-btn" style="background:#3b82f6;color:#fff;border:none;padding:6px 14px;border-radius:6px;' +
      'font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">Reload</button>' +
      '<button id="sw-dismiss-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;' +
      'padding:2px 4px;line-height:1" aria-label="Dismiss update notification">&times;</button>';
    document.body.appendChild(toast);
    document.getElementById('sw-update-btn')!.onclick = () => window.location.reload();
    document.getElementById('sw-dismiss-btn')!.onclick = () => toast.remove();
    // Add slide-up animation
    const style = document.createElement('style');
    style.textContent = '@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(style);
  },
  onOfflineReady() {
    // Silently ready for offline use
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Check for SW updates every 60 seconds
      setInterval(() => { registration.update(); }, 60 * 1000);
    }
  },
});

export const queryClient = new QueryClient({
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

import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BottomNav from './BottomNav';
import { OfflineBanner } from './OfflineBanner';
import { TrialBanner } from './TrialBanner';
import { UpgradePrompt } from './UpgradePrompt';
import { WelcomeModal } from '../onboarding/WelcomeModal';
import { Bot, X } from 'lucide-react';
import { AIChatPanel } from '../ai/AIChatPanel';
import { useUIStore } from '../../stores/uiStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useBreakpoint } from '../../hooks/useBreakpoint';

interface AppLayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_STORAGE_KEY = 'pm-generic-sidebar-collapsed';
const AI_PANEL_STORAGE_KEY = 'pm-generic-ai-panel-open';

function readLocalStorageBool(key: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === 'true';
  } catch {
    return defaultValue;
  }
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  useWebSocket();
  const breakpoint = useBreakpoint();
  const { aiPanelContext } = useUIStore();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readLocalStorageBool(SIDEBAR_STORAGE_KEY, false)
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(() =>
    readLocalStorageBool(AI_PANEL_STORAGE_KEY, true)
  );

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(AI_PANEL_STORAGE_KEY, String(aiPanelOpen));
    } catch {
      // ignore
    }
  }, [aiPanelOpen]);

  useEffect(() => {
    if (breakpoint === 'tablet') {
      setSidebarCollapsed(true);
    }
    if (breakpoint !== 'desktop') {
      setAiPanelOpen(false);
    }
  }, [breakpoint]);

  const handleSidebarToggle = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const handleAiPanelToggle = useCallback(() => {
    setAiPanelOpen((prev) => !prev);
  }, []);

  const isMobile = breakpoint === 'mobile';
  const showAiPanel = breakpoint === 'desktop' && aiPanelOpen;
  const effectiveCollapsed = isMobile ? false : sidebarCollapsed;

  const sidebarWidth = isMobile ? 0 : (sidebarCollapsed ? 64 : 240);
  const aiPanelWidth = showAiPanel ? 380 : 0;

  const handleMobileSidebarToggle = useCallback(() => {
    setMobileSidebarOpen((prev) => !prev);
  }, []);

  const handleMobileSidebarClose = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Skip to content link for keyboard navigation */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:bg-primary-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium">
        Skip to main content
      </a>
      <OfflineBanner />
      <TrialBanner />
      {/* Sidebar */}
      <Sidebar
        collapsed={effectiveCollapsed}
        onToggle={handleSidebarToggle}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={handleMobileSidebarClose}
      />

      {/* Main Wrapper */}
      <div
        className="flex flex-col min-h-screen transition-all duration-300 ease-in-out"
        style={{
          marginLeft: sidebarWidth,
          marginRight: aiPanelWidth,
        }}
      >
        {/* Top Bar */}
        <TopBar onMobileMenuToggle={isMobile ? handleMobileSidebarToggle : undefined} />

        {/* Main Content */}
        <main className={`flex-1 p-4 lg:p-6 overflow-y-auto ${isMobile ? 'pb-20' : ''}`} id="main-content" role="main">
          {children}
        </main>

        {/* Screen reader live region for dynamic announcements */}
        <div aria-live="polite" aria-atomic="true" className="sr-only" id="sr-announcements" />
      </div>

      {/* AI Panel (right side) */}
      {breakpoint === 'desktop' && (
        <aside
          className={`
            fixed top-0 right-0 z-20 h-screen
            flex flex-col
            bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700
            transition-all duration-300 ease-in-out
            ${showAiPanel ? 'w-ai-panel translate-x-0' : 'w-0 translate-x-full'}
          `}
          aria-label="AI Assistant panel"
        >
          {showAiPanel && (
            <>
              {/* AI Panel Header */}
              <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-primary-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Assistant</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-none mt-0.5">
                      Powered by Claude
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleAiPanelToggle}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
                  aria-label="Close AI panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* AI Chat Panel */}
              <AIChatPanel context={aiPanelContext} />
            </>
          )}
        </aside>
      )}

      {/* Mobile Bottom Nav */}
      {isMobile && <BottomNav onMoreClick={handleMobileSidebarToggle} />}

      {/* Floating AI Toggle */}
      {breakpoint === 'desktop' && !aiPanelOpen && (
        <button
          onClick={handleAiPanelToggle}
          className="
            fixed bottom-6 right-6 z-20
            w-12 h-12 rounded-full
            bg-primary-600 text-white
            shadow-lg shadow-primary-500/30
            hover:bg-primary-700 hover:shadow-xl hover:shadow-primary-500/40
            transition-all duration-200
            flex items-center justify-center
          "
          aria-label="Open AI Assistant"
          title="Open AI Assistant"
        >
          <Bot className="w-5 h-5" />
        </button>
      )}

      <UpgradePrompt />
      <WelcomeModal />
    </div>
  );
};

export default AppLayout;

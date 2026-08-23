import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BottomNav from './BottomNav';
import KeyboardShortcuts from './KeyboardShortcuts';
import { OfflineBanner } from './OfflineBanner';
import { TrialBanner } from './TrialBanner';
import { UpgradePrompt } from './UpgradePrompt';
import { WelcomeModal } from '../onboarding/WelcomeModal';
import { Bot, X } from 'lucide-react';
import { AIChatPanel } from '../ai/AIChatPanel';
import { useUIStore } from '../../stores/uiStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useViewPreferences, ViewPreferences } from '../../hooks/useViewPreferences';
import { useThemeStore } from '../../stores/themeStore';

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

const GO_SHORTCUTS: Record<string, string> = {
  d: '/dashboard',
  p: '/projects',
  n: '/notifications',
  s: '/settings',
};

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  useWebSocket();
  const breakpoint = useBreakpoint();
  const navigate = useNavigate();
  const { aiPanelContext } = useUIStore();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const pendingGo = useRef(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readLocalStorageBool(SIDEBAR_STORAGE_KEY, false)
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(() =>
    readLocalStorageBool(AI_PANEL_STORAGE_KEY, false)
  );

  // Sync view preferences with server (cross-device persistence)
  const { syncPrefs } = useViewPreferences(useCallback((prefs: ViewPreferences) => {
    if (prefs.sidebarCollapsed !== undefined) setSidebarCollapsed(prefs.sidebarCollapsed);
    if (prefs.aiPanelOpen !== undefined) setAiPanelOpen(prefs.aiPanelOpen);
    if (prefs.theme) useThemeStore.getState().setDark(prefs.theme === 'dark', true);
  }, []));

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // ignore
    }
    syncPrefs({ sidebarCollapsed });
  }, [sidebarCollapsed, syncPrefs]);

  useEffect(() => {
    try {
      localStorage.setItem(AI_PANEL_STORAGE_KEY, String(aiPanelOpen));
    } catch {
      // ignore
    }
    syncPrefs({ aiPanelOpen });
  }, [aiPanelOpen, syncPrefs]);

  useEffect(() => {
    if (breakpoint === 'tablet') {
      setSidebarCollapsed(true);
    }
    if (breakpoint !== 'desktop') {
      setAiPanelOpen(false);
    }
  }, [breakpoint]);

  // Global keyboard shortcuts: ? for cheat sheet, g+<key> for navigation
  useEffect(() => {
    let goTimer: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;

      // ? opens shortcut cheat sheet
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // g + <key> navigation
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        pendingGo.current = true;
        if (goTimer) clearTimeout(goTimer);
        goTimer = setTimeout(() => { pendingGo.current = false; }, 500);
        return;
      }

      if (pendingGo.current) {
        pendingGo.current = false;
        if (goTimer) clearTimeout(goTimer);
        const dest = GO_SHORTCUTS[e.key];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (goTimer) clearTimeout(goTimer);
    };
  }, [navigate]);

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
      {/* Banners — inside a banner landmark for accessibility */}
      <div role="banner">
        <OfflineBanner />
        <TrialBanner />
      </div>
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
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Mjuzi AI Chat</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-none mt-0.5">
                      Conversational project assistant
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
      <KeyboardShortcuts isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
};

export default AppLayout;

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// `mode` is Vite's own — 'production' for `vite build`, 'development' for the
// dev server. Checking process.env.NODE_ENV here would not be reliable: Vite
// loads this file before it settles that variable.
// One id per build: baked into the bundle and shipped as /version.json, so open tabs can
// tell a newer deploy is live (src/client/src/utils/appUpdate.ts).
const BUILD_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD__: JSON.stringify(mode === 'production' ? BUILD_ID : 'dev'),
  },
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        name: 'Kovarti PM',
        short_name: 'Kovarti PM',
        description: 'AI-Powered Project Management Platform',
        theme_color: '#6366f1',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    host: true,
    open: true,
    hmr: {
      port: 5174,
      host: 'localhost',
      overlay: true,
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Source maps carry the original, readable source alongside the compiled
    // bundle. Published, they put the whole front end up for download — 167
    // files, 14MB, on both sites until 2026-09-21. Nothing here consumes them
    // (no error tracker is wired up), so they were pure exposure.
    //
    // Keep them for local development, where they are what makes a stack trace
    // legible; never ship them.
    sourcemap: mode !== 'production',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
}));

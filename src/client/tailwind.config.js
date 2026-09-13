/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    fontSize: {
      'display': ['1.875rem', { lineHeight: '2.25rem', fontWeight: '700' }],   // 30px
      'heading': ['1.375rem', { lineHeight: '1.75rem', fontWeight: '600' }],   // 22px
      'subhead': ['1.0625rem', { lineHeight: '1.5rem', fontWeight: '600' }],   // 17px
      'body':    ['0.875rem',  { lineHeight: '1.375rem' }],                    // 14px
      'caption': ['0.75rem',   { lineHeight: '1rem' }],                        // 12px
      // Keep standard Tailwind sizes for compatibility
      'xs':   ['0.75rem',  { lineHeight: '1rem' }],       // 12px (was 12px — floor)
      'sm':   ['0.875rem', { lineHeight: '1.25rem' }],    // 14px
      'base': ['0.875rem', { lineHeight: '1.375rem' }],   // 14px (body default)
      'lg':   ['1.0625rem', { lineHeight: '1.5rem' }],    // 17px
      'xl':   ['1.25rem', { lineHeight: '1.75rem' }],     // 20px
      '2xl':  ['1.5rem', { lineHeight: '2rem' }],         // 24px
      '3xl':  ['1.875rem', { lineHeight: '2.25rem' }],    // 30px
    },
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Alias gray to warm stone ramp — one temperature across the whole app
        gray: {
          50:  '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        // Brand primary — teal
        primary: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        // Warm neutral ramp — stone (component surfaces: cards, inputs, buttons)
        // gray = text and borders, neutral = component surfaces
        neutral: {
          50:  '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        // Semantic tokens (retuned)
        ai: {
          primary: '#7c3aed',
          'primary-hover': '#6d28d9',
          surface: '#f5f3ff',
          border: '#c4b5fd',
          muted: '#a78bfa',
          text: '#4c1d95',
        },
        confidence: {
          high: '#059669',
          medium: '#d97706',
          low: '#dc2626',
        },
        risk: {
          critical: '#dc2626',
          high: '#ea580c',
          medium: '#d97706',
          low: '#059669',
        },
        status: {
          complete: '#059669',
          active: '#2563eb',
          'not-started': '#78716c',   // stone-500 — warm neutral, matches app ramp
          cancelled: '#a8a29e',       // stone-400 — withdrawn, not alarming
          overdue: '#dc2626',
        },
        // Identity hues for avatars — chosen to be distinguishable from each
        // other and from every semantic hue (AI violet, risk red/orange/green, status blue).
        identity: {
          1: '#0891b2',  // cyan-600
          2: '#0d9488',  // teal-600 (brand-adjacent)
          3: '#059669',  // emerald-600
          4: '#ca8a04',  // yellow-600
          5: '#ea580c',  // orange-600
          6: '#e11d48',  // rose-600
          7: '#9333ea',  // purple-600
          8: '#2563eb',  // blue-600
        },
        sidebar: {
          bg: '#1c1917',
          hover: '#292524',
          active: '#0d9488',
          text: '#d6d3d1',
          'text-active': '#ffffff',
        },
      },
      animation: {
        'ai-pulse': 'ai-pulse 2s ease-in-out infinite',
        'ai-typing': 'ai-typing 1.4s infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'slide-in-left': 'slide-in-left 0.3s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
      },
      keyframes: {
        'ai-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'ai-typing': {
          '0%': { opacity: '0.3' },
          '50%': { opacity: '1' },
          '100%': { opacity: '0.3' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      width: {
        'sidebar': '240px',
        'sidebar-collapsed': '64px',
        'ai-panel': '380px',
      },
      minWidth: {
        'ai-panel': '380px',
      },
      maxWidth: {
        'ai-panel': '480px',
      },
    },
  },
  plugins: [],
}

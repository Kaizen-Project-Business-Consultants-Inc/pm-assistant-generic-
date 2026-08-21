import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/server/services/**/*.ts',
        'src/server/middleware/**/*.ts',
        'src/server/routes/**/*.ts',
        'src/server/schemas/**/*.ts',
        'src/client/src/stores/**/*.ts',
        'src/client/src/pages/**/*.tsx',
        'src/client/src/components/**/*.tsx',
      ],
      exclude: [
        '**/__tests__/**',
        '**/test-utils/**',
        '**/node_modules/**',
        '**/*.test.{ts,tsx}',
      ],
      thresholds: {
        // Start conservative — increase over time
        'src/server/services/**': {
          statements: 50,
          branches: 40,
          functions: 50,
          lines: 50,
        },
      },
    },
    projects: [
      // Backend tests — node environment, no React aliases
      {
        test: {
          name: 'server',
          globals: true,
          environment: 'node',
          include: ['src/server/__tests__/**/*.test.ts'],
          testTimeout: 30000,
        },
      },
      // Frontend tests — jsdom environment, React 18 from client
      {
        test: {
          name: 'client',
          globals: true,
          environment: 'happy-dom',
          include: ['src/client/**/*.test.{ts,tsx}'],
          setupFiles: ['src/client/src/__tests__/setup.ts'],
          testTimeout: 30000,
        },
        resolve: {
          alias: {
            'react': path.resolve(__dirname, 'src/client/node_modules/react'),
            'react-dom': path.resolve(__dirname, 'src/client/node_modules/react-dom'),
            'react/jsx-runtime': path.resolve(__dirname, 'src/client/node_modules/react/jsx-runtime'),
            'react/jsx-dev-runtime': path.resolve(__dirname, 'src/client/node_modules/react/jsx-dev-runtime'),
            '@tanstack/react-query': path.resolve(__dirname, 'src/client/node_modules/@tanstack/react-query'),
            'zustand': path.resolve(__dirname, 'src/client/node_modules/zustand'),
            '@testing-library/react': path.resolve(__dirname, 'src/client/node_modules/@testing-library/react'),
            '@testing-library/jest-dom': path.resolve(__dirname, 'src/client/node_modules/@testing-library/jest-dom'),
          },
        },
      },
    ],
  },
});

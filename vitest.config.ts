import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirror the @renderer/* alias used in the app
      '@renderer': path.resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    // Default: node environment for main-process tests
    environment: 'node',
    // jsdom for anything under src/renderer/
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    include: ['src/**/*.test.{ts,tsx}'],
    // Clean module registry between test files so module-level state resets
    isolate: true,
    // Mock better-sqlite3 (binario nativo incompatibile con plain Node v24)
    setupFiles: ['./src/__tests__/setup/mockSqlite.ts']
  }
})

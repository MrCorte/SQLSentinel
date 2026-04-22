import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Stub the electron-vite `?asset` query so Vitest can import files that use it.
 * At runtime electron-vite transforms `import x from 'foo.png?asset'` into an
 * absolute path string; here we return the raw file path so main-process tests
 * don't break on module load.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assetQueryPlugin(): any {
  return {
    name: 'vitest-asset-query-stub',
    resolveId(id: string) {
      if (id.endsWith('?asset')) {
        return '\0asset-stub:' + id.slice(0, -6)
      }
      return undefined
    },
    load(id: string) {
      if (id.startsWith('\0asset-stub:')) {
        const filePath = id.slice('\0asset-stub:'.length)
        return `export default ${JSON.stringify(filePath)}`
      }
      return undefined
    }
  }
}

export default defineConfig({
  plugins: [react(), assetQueryPlugin()],
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

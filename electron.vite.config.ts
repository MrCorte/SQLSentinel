import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// SOLO in dev serve: il preamble di @vitejs/plugin-react è uno script inline e
// l'HMR usa un WebSocket — la CSP di produzione (script-src 'self',
// connect-src 'self') li blocca entrambi e il renderer resta bianco.
// In build l'HTML passa invariato: la CSP stretta resta quella di produzione.
const relaxCspForDev = (): Plugin => ({
  name: 'relax-csp-for-dev',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      if (!ctx.server) return html
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws:")
    }
  }
})

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), relaxCspForDev()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
            'vendor-datagrid': ['@mui/x-data-grid'],
            'vendor-charts': ['recharts'],
            'vendor-react': ['react', 'react-dom']
          }
        }
      }
    }
  }
})

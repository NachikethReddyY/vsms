import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'

export default defineConfig(({ command }) => {
  // Certificates are local-only. Production builds must never depend on files
  // that are intentionally excluded from source control.
  const localHttps = command === 'serve' && process.env.DEV_HTTPS !== 'false'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['vwsl.tailaf0363.ts.net'],
      https: localHttps ? {
        key: fs.readFileSync("./certs/localhost-key.pem"),
        cert: fs.readFileSync("./certs/localhost.pem"),
      } : undefined,
      port: 5173,
      strictPort: true,
      proxy: {
        '/qa-api': {
          target: 'https://127.0.0.1:5050',
          secure: false,
          changeOrigin: true,
          cookiePathRewrite: { '/auth': '/qa-api/auth' },
          rewrite: (path) => path.replace(/^\/qa-api/, ''),
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest) => proxyRequest.setHeader('Origin', 'https://localhost:5173'))
          },
        },
      },
    },
  }
})

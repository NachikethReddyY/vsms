import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const serving = command === 'serve'
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'https://127.0.0.1:5050'

  if (serving && new URL(proxyTarget).protocol !== 'https:') {
    throw new Error('VITE_API_PROXY_TARGET must use HTTPS')
  }
  if (env.VITE_API_BASE_URL?.startsWith('//') || (env.VITE_API_BASE_URL && !env.VITE_API_BASE_URL.startsWith('/') && new URL(env.VITE_API_BASE_URL).protocol !== 'https:')) {
    throw new Error('VITE_API_BASE_URL must be relative or use HTTPS')
  }

  const tls = serving
    ? {
        key: fs.readFileSync('./certs/localhost-key.pem'),
        cert: fs.readFileSync('./certs/localhost.pem'),
      }
    : undefined
  const proxyAgent = serving
    ? new https.Agent({
        ca: fs.readFileSync(path.join(execFileSync('mkcert', ['-CAROOT'], { encoding: 'utf8' }).trim(), 'rootCA.pem')),
      })
    : undefined

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      https: tls,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/v1': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          agent: proxyAgent,
        },
      },
    },
  }
})

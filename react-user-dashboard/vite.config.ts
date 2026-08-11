import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { homedir } from 'node:os'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function resolveMkcertBin(): string | null {
  const candidates = [
    'mkcert',
    path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WinGet',
      'Packages',
      'FiloSottile.mkcert_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'mkcert.exe',
    ),
  ]

  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-help'], { stdio: 'ignore' })
      return bin
    } catch {
      // try next
    }
  }
  return null
}

function resolveProxyCa(): Buffer {
  const localCa = path.join(process.env.LOCALAPPDATA || '', 'mkcert', 'rootCA.pem')
  if (fs.existsSync(localCa)) {
    return fs.readFileSync(localCa)
  }

  const homeCa = path.join(homedir(), '.local', 'share', 'mkcert', 'rootCA.pem')
  if (fs.existsSync(homeCa)) {
    return fs.readFileSync(homeCa)
  }

  const mkcert = resolveMkcertBin()
  if (!mkcert) {
    throw new Error(
      'mkcert CA not found. Install mkcert or place rootCA.pem under %LOCALAPPDATA%\\mkcert\\',
    )
  }

  const caroot = execFileSync(mkcert, ['-CAROOT'], { encoding: 'utf8' }).trim()
  return fs.readFileSync(path.join(caroot, 'rootCA.pem'))
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const serving = command === 'serve'
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'https://127.0.0.1:5050'

  if (serving && new URL(proxyTarget).protocol !== 'https:') {
    throw new Error('VITE_API_PROXY_TARGET must use HTTPS')
  }
  if (
    env.VITE_API_BASE_URL?.startsWith('//') ||
    (env.VITE_API_BASE_URL &&
      !env.VITE_API_BASE_URL.startsWith('/') &&
      new URL(env.VITE_API_BASE_URL).protocol !== 'https:')
  ) {
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
        ca: resolveProxyCa(),
      })
    : undefined

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'VSMS',
          short_name: 'VSMS',
          theme_color: '#0b0b0d',
          background_color: '#0b0b0d',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//i],
          runtimeCaching: [
            {
              urlPattern: /^\/api\/v1\/.*/i,
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
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

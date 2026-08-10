import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { OfflineSyncProvider } from './features/screening/OfflineSyncProvider.tsx'

let savedTheme: string | null = null
try { savedTheme = localStorage.getItem('vsms-theme') } catch { /* Use the system preference when storage is unavailable. */ }
const preferredTheme = savedTheme === 'light' || savedTheme === 'dark'
  ? savedTheme
  : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.documentElement.dataset.theme = preferredTheme
document.documentElement.style.colorScheme = preferredTheme

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OfflineSyncProvider>
          <App />
        </OfflineSyncProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

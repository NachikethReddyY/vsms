import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider as StaffAuthProvider } from './auth/AuthProvider.tsx'

const savedTheme = localStorage.getItem('vsms-theme')
const preferredTheme = savedTheme === 'light' || savedTheme === 'dark'
  ? savedTheme
  : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.documentElement.dataset.theme = preferredTheme
document.documentElement.style.colorScheme = preferredTheme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StaffAuthProvider>
        <App />
      </StaffAuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

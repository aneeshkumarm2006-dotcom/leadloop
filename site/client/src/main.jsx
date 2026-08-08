import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './i18n'
import App from './App.jsx'
import { registerSW } from './pwa/registerSW'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Make the app installable + offline-capable (production only).
registerSW()

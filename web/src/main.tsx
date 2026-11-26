import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
import { registerServiceWorker } from './registerServiceWorker.ts'
import { startTelemetry } from './telemetry.ts'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// Before the first render, so the page load counts before a linked card's open.
startTelemetry()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()

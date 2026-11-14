import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App'
import { repository } from './persistence/repository'
import { useStore } from './state/store'
import { importPdfFile } from './features/pdf/importPdf'
import { openPdf, renderPdfPage } from './features/pdf/pdfService'

if (import.meta.env.DEV) {
  // Debug handles for development tooling only — not shipped in production builds.
  ;(window as unknown as { __inkflowRepo?: typeof repository }).__inkflowRepo = repository
  ;(window as unknown as { __inkflowStore?: typeof useStore }).__inkflowStore = useStore
  ;(window as unknown as { __inkflowImportPdf?: typeof importPdfFile }).__inkflowImportPdf = importPdfFile
  ;(window as unknown as { __inkflowPdfProbe?: unknown }).__inkflowPdfProbe = { openPdf, renderPdfPage }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

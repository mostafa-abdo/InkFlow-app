import { useEffect, useState } from 'react'
import EditorCanvas from './EditorCanvas'
import DrawingToolbar from './DrawingToolbar'
import PageStrip from './PageStrip'
import PropertiesPanel from './PropertiesPanel'
import { useStore, selectCurrentNote } from '../../state/store'

/** Main workspace: canvas + floating toolbar + page rail + inspector. */
export default function EditorView(): React.JSX.Element {
  const note = useStore(selectCurrentNote)
  const saveState = useStore((s) => s.saveState)
  const showPagesRail = useStore((s) => s.settings.showPagesRail)
  const showInspector = useStore((s) => s.settings.showInspector)
  const [thumbVersion, setThumbVersion] = useState(0)

  // Refresh page thumbnails shortly after each autosave boundary (≈ stroke commit).
  useEffect(() => {
    if (saveState !== 'saved') return
    const t = window.setTimeout(() => setThumbVersion((v) => v + 1), 400)
    return () => window.clearTimeout(t)
  }, [saveState])

  return (
    <div className="relative flex min-w-0 flex-1">
      <div className="relative min-w-0 flex-1">
        {note ? (
          <>
            <EditorCanvas />
            <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2">
              <DrawingToolbar />
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      {note && showPagesRail && <PageStrip thumbVersion={thumbVersion} />}
      {note && showInspector && <PropertiesPanel />}
    </div>
  )
}

const EmptyState = (): React.JSX.Element => {
  const createNote = useStore((s) => s.createNote)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4" style={{ background: 'var(--stage)' }}>
      <svg width="72" height="72" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="empty-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c6cf6" />
            <stop offset="1" stopColor="#4f46e5" />
          </linearGradient>
        </defs>
        <path fill="url(#empty-g)" opacity="0.9" d="M32 6c-9.5 12.2-16 20.8-16 29.6a16 16 0 0 0 32 0C48 26.8 41.5 18.2 32 6z" />
      </svg>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">A blank page is a promise</h2>
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Pick a notebook and create your first note — or import a PDF to annotate.</p>
      </div>
      <button
        className="rounded-xl px-5 py-2 text-[13px] font-semibold transition-transform hover:scale-[1.03]"
        style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        onClick={() => void createNote()}
      >
        Create a note
      </button>
    </div>
  )
}

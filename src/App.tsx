import { useEffect, useMemo, useRef } from 'react'
import { useStore, selectCurrentNote, useCurrentPages } from './state/store'
import TitleBar from './features/shell/TitleBar'
import Sidebar from './features/shell/Sidebar'
import StatusBar from './features/shell/StatusBar'
import EditorView from './features/editor/EditorView'
import SettingsView from './features/settings/SettingsView'
import { engineRef, getEngineStrokes } from './features/editor/engineRef'
import { exportPagePNG } from './features/export/exportService'
import { Droplets } from 'lucide-react'

/** Builds the canonical combo string for a keyboard event, e.g. "Ctrl+Shift+Z". */
const comboFromEvent = (e: KeyboardEvent): string => {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key
  if (!['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) parts.push(key)
  return parts.join('+')
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export default function App(): React.JSX.Element {
  const init = useStore((s) => s.init)
  const initialised = useStore((s) => s.initialised)
  const initError = useStore((s) => s.initError)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const shortcuts = useStore((s) => s.shortcuts)
  const theme = useStore((s) => s.settings.theme)
  const settings = useStore((s) => s.settings)
  const showSidebar = useStore((s) => s.settings.showSidebar)
  const note = useStore(selectCurrentNote)
  const pages = useCurrentPages()
  const noteId = useStore((s) => s.currentNoteId)

  useEffect(() => {
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-resolve "system" theme live.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'light' : 'dark')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const comboMap = useMemo(() => new Map(shortcuts.map((s) => [s.combo.toLowerCase(), s.action])), [shortcuts])
  // Prefix state for sequence shortcuts like "E+1" (press E, then 1 within the window).
  const pendingPrefix = useRef<{ key: string; timer: number | null }>({ key: '', timer: null })

  useEffect(() => {
    const runAction = (action: string, e: KeyboardEvent): void => {
      const store = useStore.getState()
      const engine = engineRef.current

      switch (action) {
        case 'pen': e.preventDefault(); store.setTool('pen'); break
        case 'pencil': e.preventDefault(); store.setTool('pencil'); break
        case 'highlighter': e.preventDefault(); store.setTool('highlighter'); break
        case 'select': e.preventDefault(); store.setTool('select'); break
        case 'lasso': e.preventDefault(); store.setTool('lasso'); break
        case 'line': e.preventDefault(); store.setTool('line'); break
        case 'arrow': e.preventDefault(); store.setTool('arrow'); break
        case 'eraser-whole':
          e.preventDefault()
          store.setTool('eraser')
          void store.updateSettings({ eraserMode: 'stroke' })
          break
        case 'eraser-partial':
          e.preventDefault()
          store.setTool('eraser')
          void store.updateSettings({ eraserMode: 'partial' })
          break
        case 'shape': e.preventDefault(); store.setTool('shape'); break
        case 'shape-rect': e.preventDefault(); store.setTool('shape'); store.setShapeKind('rect'); break
        case 'shape-ellipse': e.preventDefault(); store.setTool('shape'); store.setShapeKind('ellipse'); break
        case 'shape-triangle': e.preventDefault(); store.setTool('shape'); store.setShapeKind('triangle'); break
        case 'shape-diamond': e.preventDefault(); store.setTool('shape'); store.setShapeKind('diamond'); break
        case 'shape-star': e.preventDefault(); store.setTool('shape'); store.setShapeKind('star'); break
        case 'undo': e.preventDefault(); engine?.undo(); break
        case 'redo': e.preventDefault(); engine?.redo(); break
        case 'duplicate-note':
          if (noteId) { e.preventDefault(); void store.duplicateNote(noteId); store.flashStatus('Note duplicated') }
          break
        case 'toggle-favorite':
          if (noteId) { e.preventDefault(); void store.toggleFavorite(noteId) }
          break
        case 'export-png': {
          e.preventDefault()
          if (!note) break
          const page = pages[store.currentPageIndex] ?? pages[0]
          if (page) void exportPagePNG({ note, pressureGamma: store.settings.pressureGamma }, page, getEngineStrokes())
          break
        }
        case 'zoom-in': e.preventDefault(); engine?.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25); break
        case 'zoom-out': e.preventDefault(); engine?.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8); break
        case 'zoom-reset': e.preventDefault(); engine?.zoomReset(); break
        case 'delete-selection': e.preventDefault(); engine?.deleteSelection(); break
        case 'search':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')?.focus()
          break
        case 'toggle-settings':
          e.preventDefault()
          setView(view === 'settings' ? 'workspace' : 'settings')
          break
        default:
          break
      }
    }

    const handler = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return
      const combo = comboFromEvent(e).toLowerCase()

      // If this key opens a sequence like E→1 or S→3, defer and wait for the follow-up key.
      const startsSequence = [...comboMap.keys()].some(
        (k) => k.startsWith(combo + '+') && k.split('+').length === 2,
      )
      if (startsSequence) {
        pendingPrefix.current.key = combo
        if (pendingPrefix.current.timer !== null) window.clearTimeout(pendingPrefix.current.timer)
        pendingPrefix.current.timer = window.setTimeout(() => { pendingPrefix.current = { key: '', timer: null } }, 650)
        e.preventDefault()
        return
      }

      // If a sequence prefix is armed, resolve the combined combo (e.g. "E+1").
      if (pendingPrefix.current.key) {
        if (pendingPrefix.current.timer !== null) window.clearTimeout(pendingPrefix.current.timer)
        const combined = `${pendingPrefix.current.key}+${combo}`
        pendingPrefix.current = { key: '', timer: null }
        const action = comboMap.get(combined)
        if (action) {
          runAction(action, e)
          return
        }
        // Not a known sequence — fall through and process this key on its own.
      }

      const action = comboMap.get(combo)
      if (!action) return
      runAction(action, e)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [comboMap, noteId, note, pages, view, setView])

  void settings

  if (!initialised) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: 'var(--bg-app)' }}>
        <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, #7c6cf6, #4f46e5)' }}>
          <Droplets size={22} className="text-white" />
        </div>
        <p className="text-[13px] text-[var(--text-secondary)]">Opening your workspace…</p>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: 'var(--bg-app)' }}>
        <p className="text-sm font-semibold text-[var(--danger)]">InkFlow could not open its local database.</p>
        <p className="max-w-md text-[12px] leading-relaxed text-[var(--text-secondary)]">{initError}</p>
        <button className="rounded-lg px-4 py-2 text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }} onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {showSidebar && <Sidebar />}
        {view === 'workspace' ? <EditorView /> : <SettingsView />}
      </div>
      <StatusBar />
    </div>
  )
}

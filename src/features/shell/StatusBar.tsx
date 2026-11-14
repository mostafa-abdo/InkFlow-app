import { useEffect, useRef } from 'react'
import { Cloud, CloudCheck, CloudAlert, Loader2, Eraser, MousePointer2, Lasso, PenTool, Pencil, Highlighter, Square, Minus, MoveUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore, useCurrentPages } from '../../state/store'
import { subscribePointerInfo } from '../editor/pointerBus'
import { backendKind } from '../../persistence/adapter'
import type { ToolId } from '../../types'

const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  select: MousePointer2,
  lasso: Lasso,
  pen: PenTool,
  pencil: Pencil,
  highlighter: Highlighter,
  eraser: Eraser,
  shape: Square,
  line: Minus,
  arrow: MoveUpRight,
}

/** Bottom status bar: save state, tool, pressure meter, page, zoom, storage backend. */
export default function StatusBar(): React.JSX.Element {
  const saveState = useStore((s) => s.saveState)
  const tool = useStore((s) => s.tool)
  const zoom = useStore((s) => s.zoom)
  const pageIndex = useStore((s) => s.currentPageIndex)
  const selectionCount = useStore((s) => s.selectionCount)
  const settings = useStore((s) => s.settings)
  const statusMessage = useStore((s) => s.statusMessage)
  const pages = useCurrentPages()
  const pressureRef = useRef<HTMLDivElement>(null)
  const deviceRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const off = subscribePointerInfo((info) => {
      if (pressureRef.current) {
        pressureRef.current.style.transform = `scaleX(${Math.min(1, info.pressure)})`
      }
      if (deviceRef.current) {
        deviceRef.current.textContent = info.pointerType === 'pen' ? 'Stylus' : info.pointerType === 'touch' ? 'Touch' : 'Mouse'
      }
    })
    return off
  }, [])

  const saveIndicator = (() => {
    switch (saveState) {
      case 'pending':
        return { icon: <Cloud size={12} className="text-[var(--warning)]" />, label: 'Unsaved changes' }
      case 'saving':
        return { icon: <Loader2 size={12} className="animate-spin text-[var(--text-secondary)]" />, label: 'Saving…' }
      case 'saved':
        return { icon: <CloudCheck size={12} className="text-[var(--success)]" />, label: 'Saved locally' }
      case 'error':
        return { icon: <CloudAlert size={12} className="text-[var(--danger)]" />, label: 'Save failed — retrying' }
      default:
        return { icon: <Cloud size={12} className="text-[var(--text-muted)]" />, label: 'All saved' }
    }
  })()

  const ToolIcon = TOOL_ICONS[tool]

  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-[10.5px] text-[var(--text-muted)]"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      aria-label="Status bar"
    >
      <span className="flex items-center gap-1.5" title="Autosave state">
        {saveIndicator.icon}
        <span className="hidden sm:inline">{statusMessage ?? saveIndicator.label}</span>
      </span>

      <span className="flex items-center gap-1.5" title="Active tool">
        <ToolIcon size={11} />
        <span className="hidden capitalize md:inline">{tool}</span>
        {selectionCount > 0 && <span className="rounded-full px-1.5 text-[9px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{selectionCount} selected</span>}
      </span>

      {settings.showPressureMeter && (
        <span className="hidden items-center gap-2 lg:flex" title="Stylus pressure">
          <span ref={deviceRef} className="w-8">Mouse</span>
          <span className="h-[3px] w-20 overflow-hidden rounded-full" style={{ background: 'var(--bg-active)' }}>
            <span ref={pressureRef} className="block h-full w-full origin-left rounded-full transition-transform duration-75" style={{ background: 'var(--accent)', transform: 'scaleX(0)' }} />
          </span>
        </span>
      )}

      <span className="flex-1" />

      <span title="Page">Page {Math.min(pageIndex + 1, pages.length)} / {pages.length}</span>
      <span title="Viewport zoom">{Math.round(zoom * 100)}%</span>
      <span className="hidden items-center gap-1 sm:flex" title="Storage backend">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} />
        {backendKind() === 'sqlite' ? 'SQLite' : 'IndexedDB'} · offline
      </span>
    </footer>
  )
}

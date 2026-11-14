import { useEffect, useRef, useState } from 'react'
import {
  MousePointer2, Lasso, PenTool, Pencil, Highlighter, Eraser,
  Square, Circle, Triangle, Diamond, Star, Minus, MoveUpRight,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize, ChevronDown, MouseOff,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../../state/store'
import { engineRef } from './engineRef'
import type { ShapeKind, ToolId, ToolbarItemId } from '../../types'

/** Contextual drawing toolbar — floating above the canvas, stylus-friendly targets. */

const INK_COLORS = ['#2b2a33', '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#ffffff']

interface ToolDef { id: ToolId; label: string; icon: LucideIcon; shortcut: string }
const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select / move', icon: MousePointer2, shortcut: 'V' },
  { id: 'lasso', label: 'Lasso select', icon: Lasso, shortcut: 'L' },
  { id: 'pen', label: 'Pen', icon: PenTool, shortcut: 'P' },
  { id: 'pencil', label: 'Pencil', icon: Pencil, shortcut: 'B' },
  { id: 'highlighter', label: 'Highlighter', icon: Highlighter, shortcut: 'H' },
  { id: 'eraser', label: 'Eraser', icon: Eraser, shortcut: 'E+1 · Whole / E+2 · Partial' },
  { id: 'shape', label: 'Shape', icon: Square, shortcut: 'S' },
  { id: 'line', label: 'Line', icon: Minus, shortcut: 'I' },
  { id: 'arrow', label: 'Arrow', icon: MoveUpRight, shortcut: 'A' },
]

const SHAPES: { id: ShapeKind; label: string; icon: LucideIcon; shortcut: string }[] = [
  { id: 'rect', label: 'Rectangle', icon: Square, shortcut: 'S+1' },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, shortcut: 'S+2' },
  { id: 'triangle', label: 'Triangle', icon: Triangle, shortcut: 'S+3' },
  { id: 'diamond', label: 'Diamond', icon: Diamond, shortcut: 'S+4' },
  { id: 'star', label: 'Star', icon: Star, shortcut: 'S+5' },
]

const iconBtn = (active: boolean, accent = true): string =>
  `flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${
    active
      ? accent
        ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_0_1px_var(--accent),0_4px_14px_-4px_var(--accent)]'
        : 'bg-[var(--bg-active)] text-[var(--text-primary)]'
      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
  }`

export default function DrawingToolbar(): React.JSX.Element {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const color = useStore((s) => s.color)
  const setColor = useStore((s) => s.setColor)
  const strokeWidth = useStore((s) => s.strokeWidth)
  const setStrokeWidth = useStore((s) => s.setStrokeWidth)
  const shapeKind = useStore((s) => s.shapeKind)
  const setShapeKind = useStore((s) => s.setShapeKind)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const interfaceMode = useStore((s) => s.settings.interfaceMode)
  const selection = useStore((s) => s.settings.toolbarSelection)
  const eraserMode = useStore((s) => s.settings.eraserMode)
  const updateSettings = useStore((s) => s.updateSettings)
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false)
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false)
  const shapeMenuRef = useRef<HTMLDivElement>(null)
  const eraserMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shapeMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!shapeMenuRef.current?.contains(e.target as Node)) setShapeMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [shapeMenuOpen])

  useEffect(() => {
    if (!eraserMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!eraserMenuRef.current?.contains(e.target as Node)) setEraserMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [eraserMenuOpen])

  const enabled = selection?.[interfaceMode] ?? []
  const show = (id: ToolbarItemId): boolean => enabled.includes(id)

  const zoom = (factor: number): void => {
    const engine = engineRef.current
    if (!engine) return
    engine.zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor)
  }

  const CurrentShapeIcon = SHAPES.find((s) => s.id === shapeKind)?.icon ?? Square

  const toolButtonEntries = TOOLS.filter((t) => show(t.id as ToolbarItemId)).map(({ id, label, icon: Icon, shortcut }) => {
    if (id === 'eraser') {
      return {
        id,
        node: (
          <div key="eraser" className="relative" ref={eraserMenuRef}>
            <div className="flex items-center">
              <button className={iconBtn(tool === 'eraser')} title={`Eraser (E+1 · Whole / E+2 · Partial) — ${eraserMode === 'stroke' ? 'whole strokes' : 'touch only'}`} aria-label="Eraser" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>
                {eraserMode === 'stroke' ? <WholeStrokeIcon /> : <PartialStrokeIcon />}
              </button>
              <button className="flex h-9 w-4 items-center justify-center rounded-r-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Choose eraser mode" onClick={() => setEraserMenuOpen((v) => !v)}>
                <ChevronDown size={12} />
              </button>
            </div>
            {eraserMenuOpen && (
              <div className="fade-in absolute top-11 left-0 z-40 flex w-56 flex-col gap-0.5 rounded-xl border p-1.5" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)', boxShadow: '0 16px 40px rgba(0,0,0,0.4)' }}>
                <EraserModeButton active={eraserMode === 'stroke'} label="Erase whole strokes" hint="Deletes the entire stroke it touches" icon={<WholeStrokeIcon />} onClick={() => { void updateSettings({ eraserMode: 'stroke' }); setTool('eraser'); setEraserMenuOpen(false) }} />
                <EraserModeButton active={eraserMode === 'partial'} label="Erase only what it touches" hint="Splits and trims the stroke in place" icon={<PartialStrokeIcon />} onClick={() => { void updateSettings({ eraserMode: 'partial' }); setTool('eraser'); setEraserMenuOpen(false) }} />
              </div>
            )}
          </div>
        ),
      }
    }
    if (id === 'shape') {
      return {
        id,
        node: (
          <div key="shape" className="relative" ref={shapeMenuRef}>
            <div className="flex items-center">
              <button className={iconBtn(tool === 'shape')} title={`${label} (${shortcut})`} aria-label="Shape" aria-pressed={tool === 'shape'} onClick={() => setTool('shape')}>
                <CurrentShapeIcon size={17} strokeWidth={1.8} />
              </button>
              <button className="flex h-9 w-4 items-center justify-center rounded-r-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Choose shape" onClick={() => setShapeMenuOpen((v) => !v)}>
                <ChevronDown size={12} />
              </button>
            </div>
            {shapeMenuOpen && (
              <div className="fade-in absolute top-11 left-0 z-40 flex gap-1 rounded-xl border p-1.5" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)', boxShadow: '0 16px 40px rgba(0,0,0,0.4)' }}>
                {SHAPES.map(({ id: shapeId, label: shapeLabel, icon: Icon, shortcut: sc }) => (
                  <button key={shapeId} className={iconBtn(shapeKind === shapeId, false)} title={`${shapeLabel} (${sc})`} aria-label={shapeLabel} onClick={() => { setShapeKind(shapeId); setTool('shape'); setShapeMenuOpen(false) }}>
                    <Icon size={16} strokeWidth={1.8} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      }
    }
    return {
      id,
      node: (
        <button key={id} className={iconBtn(tool === id)} title={`${label} (${shortcut})`} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)}>
          <Icon size={17} strokeWidth={1.8} />
        </button>
      ),
    }
  })

  const divider = <div className="mx-1 h-6 w-px shrink-0" style={{ background: 'var(--border-strong)' }} aria-hidden="true" />

  const blocks: React.ReactNode[] = []
  const selectionIds: ToolId[] = ['select', 'lasso']
  const selectionButtons = toolButtonEntries.filter((e) => selectionIds.includes(e.id)).map((e) => e.node)
  if (selectionButtons.length > 0) blocks.push(<div key="sel" className="flex items-center gap-1">{selectionButtons}</div>)
  const drawingIds: ToolId[] = ['pen', 'pencil', 'highlighter', 'eraser', 'shape', 'line', 'arrow']
  const drawingButtons = toolButtonEntries.filter((e) => drawingIds.includes(e.id)).map((e) => e.node)
  if (drawingButtons.length > 0) blocks.push(<div key="draw" className="flex items-center gap-1">{drawingButtons}</div>)
  if (show('undoRedo')) {
    blocks.push(
      <div key="undo" className="flex items-center gap-1">
        <button className={`${iconBtn(false, false)} disabled:opacity-30`} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => engineRef.current?.undo()}>
          <Undo2 size={16} strokeWidth={1.8} />
        </button>
        <button className={`${iconBtn(false, false)} disabled:opacity-30`} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => engineRef.current?.redo()}>
          <Redo2 size={16} strokeWidth={1.8} />
        </button>
      </div>,
    )
  }
  if (show('colors')) {
    blocks.push(
      <div key="colors" className="flex items-center gap-1.5">
        {INK_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Ink color ${c}`}
            className="h-5 w-5 rounded-full transition-transform hover:scale-110 focus-visible:scale-110"
            style={{
              background: c,
              boxShadow: color.toLowerCase() === c.toLowerCase()
                ? '0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--accent)'
                : '0 0 0 1px var(--border-strong)',
            }}
            onClick={() => setColor(c)}
          />
        ))}
        <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full" title="Custom color" style={{ background: 'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)', boxShadow: '0 0 0 1px var(--border-strong)' }}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom ink color" />
        </label>
      </div>,
    )
  }
  if (show('strokeWidth')) {
    blocks.push(
      <div key="width" className="flex items-center gap-2 px-1" title={`Stroke width ${strokeWidth.toFixed(1)}px`}>
        <div className="h-2 rounded-full transition-all" style={{ width: 4 + strokeWidth * 3, maxWidth: 30, background: 'var(--text-primary)', opacity: 0.75 }} />
        <input
          type="range"
          min={1}
          max={24}
          step={0.5}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
          className="h-1 w-24 cursor-pointer accent-[var(--accent)]"
          aria-label="Stroke width"
        />
      </div>,
    )
  }
  if (show('zoom')) {
    blocks.push(
      <div key="zoom" className="flex items-center gap-1">
        <button className={iconBtn(false, false)} title="Zoom out (Ctrl+-)" aria-label="Zoom out" onClick={() => zoom(0.8)}><ZoomOut size={16} strokeWidth={1.8} /></button>
        <button className={iconBtn(false, false)} title="Zoom to fit" aria-label="Zoom to fit" onClick={() => engineRef.current?.zoomToFit()}><Maximize size={16} strokeWidth={1.8} /></button>
        <button className={iconBtn(false, false)} title="Zoom in (Ctrl+=)" aria-label="Zoom in" onClick={() => zoom(1.25)}><ZoomIn size={16} strokeWidth={1.8} /></button>
      </div>,
    )
  }

  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-2xl border px-2 py-1.5"
      style={{
        background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)',
        borderColor: 'var(--border-strong)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
        backdropFilter: 'blur(14px)',
      }}
      role="toolbar"
      aria-label={`Drawing tools (${interfaceMode} interface)`}
    >
      {blocks.length === 0 ? (
        <span className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
          <MouseOff size={13} /> Empty toolbar — pick tools in Settings → Interface
        </span>
      ) : (
        blocks.flatMap((block, i) => (i === 0 ? [block] : [divider, block]))
      )}
    </div>
  )
}

/* ------------------- Custom eraser-mode glyphs (inline SVG) ------------------- */

const WholeStrokeIcon = (): React.JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 16c2.5-2 4 2 6.5 0s4-2.5 6.5 0" />
    <path d="M7 20l10-10" strokeDasharray="2.4 2.4" />
  </svg>
)

const PartialStrokeIcon = (): React.JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 16h6.5" />
    <path d="M13.5 16H20" />
    <path d="M4 20h2.5" opacity={0.55} />
    <path d="M10 20h2.5" opacity={0.85} />
    <path d="M16 20h4" />
  </svg>
)

const EraserModeButton = ({ active, label, hint, icon, onClick }: { active: boolean; label: string; hint: string; icon: React.ReactNode; onClick: () => void }): React.JSX.Element => (
  <button
    role="menuitemradio"
    aria-checked={active}
    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent-soft)]"
    onClick={onClick}
  >
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: active ? 'var(--accent)' : 'var(--bg-active)', color: active ? 'var(--accent-contrast)' : 'var(--text-secondary)' }}>{icon}</span>
    <span className="min-w-0">
      <span className="block text-[11px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <span className="mt-0.5 block text-[9px] leading-snug" style={{ color: 'var(--text-muted)' }}>{hint}</span>
    </span>
  </button>
)

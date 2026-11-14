import { useEffect, useMemo, useState } from 'react'
import {
  Monitor, Moon, Sun, Check, RotateCcw, Database, Info, Keyboard, Palette, PenLine, Save, Search, LayoutGrid,
} from 'lucide-react'
import { useStore } from '../../state/store'
import { ALL_TOOLBAR_ITEMS, DEFAULT_TOOLBAR_SELECTION } from '../../types'
import type { InterfaceMode } from '../../types'
import { repository } from '../../persistence/repository'
import { backendKind } from '../../persistence/adapter'

const ACTION_LABELS: Record<string, string> = {
  /* tools */
  pen: 'Pen tool',
  pencil: 'Pencil tool',
  highlighter: 'Highlighter',
  'eraser-whole': 'Eraser — whole strokes (1)',
  'eraser-partial': 'Eraser — partial, touch only (2)',
  select: 'Selection tool',
  lasso: 'Lasso tool',
  shape: 'Shape tool (current kind)',
  'shape-rect': 'Shape — Rectangle',
  'shape-ellipse': 'Shape — Ellipse',
  'shape-triangle': 'Shape — Triangle',
  'shape-diamond': 'Shape — Diamond',
  'shape-star': 'Shape — Star',
  line: 'Line tool',
  arrow: 'Arrow tool',
  /* general */
  undo: 'Undo',
  redo: 'Redo',
  'duplicate-note': 'Duplicate note',
  'toggle-favorite': 'Toggle favorite',
  'export-png': 'Export current page as PNG',
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'zoom-reset': 'Zoom to 100%',
  'delete-selection': 'Delete selection',
  search: 'Focus search',
  'toggle-settings': 'Toggle settings',
}

const ACCENTS = ['#7c6cf6', '#5b4ee6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6']

/** Settings screen: appearance, editing behavior, keyboard shortcuts, backups, storage info. */
export default function SettingsView(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const shortcuts = useStore((s) => s.shortcuts)
  const updateShortcut = useStore((s) => s.updateShortcut)
  const resetShortcuts = useStore((s) => s.resetShortcuts)
  const flashStatus = useStore((s) => s.flashStatus)

  const [recording, setRecording] = useState<string | null>(null)
  const [shortcutFilter, setShortcutFilter] = useState('')
  const [stats, setStats] = useState<{ notebooks: number; notes: number; pages: number } | null>(null)

  useEffect(() => {
    void repository.loadWorkspace().then((w) => setStats({ notebooks: w.notebooks.length, notes: w.notes.length, pages: w.pages.length }))
  }, [])

  // Shortcut recorder: next key combo wins.
  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.metaKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key
      if (!['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) parts.push(key)
      if (parts.length === 0) return
      void updateShortcut(recording, parts.join('+'))
      setRecording(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording, updateShortcut])

  const filteredShortcuts = useMemo(() => {
    const q = shortcutFilter.trim().toLowerCase()
    if (!q) return shortcuts
    return shortcuts.filter((s) => (ACTION_LABELS[s.action] ?? s.action).toLowerCase().includes(q) || s.combo.toLowerCase().includes(q))
  }, [shortcuts, shortcutFilter])

  const sectionTitle: React.CSSProperties = {
    fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'var(--text-muted)', fontWeight: 700,
  }
  const card: React.CSSProperties = {
    background: 'var(--bg-panel-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16,
  }
  const toggle = (label: string, hint: string, value: boolean, onChange: (v: boolean) => void): React.JSX.Element => (
    <button className="flex w-full items-center justify-between gap-4 py-2 text-left" onClick={() => onChange(!value)} role="switch" aria-checked={value} aria-label={label}>
      <span>
        <span className="block text-[12px] font-medium text-[var(--text-primary)]">{label}</span>
        <span className="block text-[10px] text-[var(--text-muted)]">{hint}</span>
      </span>
      <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ background: value ? 'var(--accent)' : 'var(--bg-active)' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: value ? 18 : 2 }} />
      </span>
    </button>
  )

  return (
    <div className="min-w-0 flex-1 overflow-y-auto" style={{ background: 'var(--bg-app)' }}>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Settings</h1>
        <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">Tune InkFlow to your pen, your eyes and your workflow. Everything works offline.</p>

        {/* Interface */}
        <section className="mt-6">
          <h2 style={sectionTitle}><span className="inline-flex items-center gap-1.5"><LayoutGrid size={12} /> Interface</span></h2>
          <div className="mt-2" style={card}>
            <div className="mb-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">Mode</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ['simple', 'Simple', 'Only the essentials — great for kids & quick notes'],
                ['advanced', 'Advanced', 'Every tool unlocked — the full studio'],
                ['custom', 'Custom', 'Pick exactly what your toolbar shows'],
              ] as const).map(([mode, label, hint]) => (
                <button
                  key={mode}
                  className="rounded-xl border p-3 text-left transition-all"
                  style={{
                    borderColor: settings.interfaceMode === mode ? 'var(--accent)' : 'var(--border)',
                    background: settings.interfaceMode === mode ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                    boxShadow: settings.interfaceMode === mode ? '0 0 0 1px var(--accent)' : 'none',
                  }}
                  onClick={() => void updateSettings({ interfaceMode: mode as InterfaceMode })}
                  aria-pressed={settings.interfaceMode === mode}
                >
                  <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: settings.interfaceMode === mode ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {settings.interfaceMode === mode && <Check size={12} />}{label}
                  </span>
                  <span className="mt-1 block text-[10px] leading-snug text-[var(--text-muted)]">{hint}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 mb-1 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Tools shown in each interface</span>
              <button
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                style={{ borderColor: 'var(--border-strong)' }}
                onClick={() => void updateSettings({ toolbarSelection: JSON.parse(JSON.stringify(DEFAULT_TOOLBAR_SELECTION)) as typeof DEFAULT_TOOLBAR_SELECTION })}
              >
                <RotateCcw size={11} /> Reset toolbar to defaults
              </button>
            </div>
            <div role="table" aria-label="Tools visible in each interface mode" className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              {/* column headers */}
              <div className="grid grid-cols-[1fr_56px_72px_64px] items-center border-b px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Tool</span>
                {(['simple', 'advanced', 'custom'] as const).map((mode) => (
                  <span key={mode} className="text-center text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: settings.interfaceMode === mode ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {mode}
                  </span>
                ))}
              </div>
              {ALL_TOOLBAR_ITEMS.map(({ id, label, hint }) => {
                const toggleTool = (mode: 'simple' | 'advanced' | 'custom'): void => {
                  const next = { ...settings.toolbarSelection }
                  const list = new Set(next[mode])
                  if (list.has(id)) list.delete(id)
                  else list.add(id)
                  next[mode] = [...list]
                  void updateSettings({ toolbarSelection: next })
                }
                return (
                  <div key={id} role="row" className="grid grid-cols-[1fr_56px_72px_64px] items-center border-b px-3 py-1.5 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <span>
                      <span className="block text-[11px] font-medium leading-tight text-[var(--text-primary)]">{label}</span>
                      <span className="block text-[9px] leading-tight text-[var(--text-muted)]">{hint}</span>
                    </span>
                    {(['simple', 'advanced', 'custom'] as const).map((mode) => {
                      const checked = settings.toolbarSelection[mode].includes(id)
                      return (
                        <button
                          key={mode}
                          role="checkbox"
                          aria-checked={checked}
                          aria-label={`${label} — ${mode}`}
                          className="mx-auto flex h-5 w-5 items-center justify-center rounded border transition-all"
                          style={{
                            borderColor: checked ? 'var(--accent)' : 'var(--border-strong)',
                            background: checked ? 'var(--accent)' : 'transparent',
                          }}
                          onClick={() => toggleTool(mode)}
                        >
                          {checked && <Check size={12} className="text-white" strokeWidth={3} />}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[var(--text-muted)]">Hide everything you don't need — the rest of the chrome (title bar, sidebar, inspector) stays untouched. Keyboard shortcuts keep working regardless of what the toolbar shows.</p>
          </div>
        </section>

        {/* Appearance */}
        <section className="mt-6">
          <h2 style={sectionTitle}><span className="inline-flex items-center gap-1.5"><Palette size={12} /> Appearance</span></h2>
          <div className="mt-2 grid gap-4 sm:grid-cols-2" style={card}>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">Theme</div>
              <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--bg-elevated)' }}>
                {([['dark', Moon, 'Dark'], ['light', Sun, 'Light'], ['system', Monitor, 'System']] as const).map(([mode, Icon, label]) => (
                  <button
                    key={mode}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
                    style={{ background: settings.theme === mode ? 'var(--bg-active)' : 'transparent', color: settings.theme === mode ? 'var(--text-primary)' : 'var(--text-muted)' }}
                    onClick={() => void updateSettings({ theme: mode })}
                    aria-pressed={settings.theme === mode}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">Accent</div>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-transform hover:scale-110"
                    style={{ background: c, boxShadow: settings.accent.toLowerCase() === c ? '0 0 0 2px var(--bg-panel-2), 0 0 0 4px var(--accent)' : 'none' }}
                    onClick={() => void updateSettings({ accent: c })}
                    aria-label={`Accent ${c}`}
                  >
                    {settings.accent.toLowerCase() === c && <Check size={14} className="text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Editing */}
        <section className="mt-6">
          <h2 style={sectionTitle}><span className="inline-flex items-center gap-1.5"><PenLine size={12} /> Editing &amp; input</span></h2>
          <div className="mt-2" style={card}>
            <label className="mb-1 flex items-center justify-between gap-4" htmlFor="autosave">
              <span>
                <span className="block text-[12px] font-medium text-[var(--text-primary)]">Autosave delay</span>
                <span className="block text-[10px] text-[var(--text-muted)]">Ink is committed to the local database this long after your last stroke.</span>
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-[var(--accent)]">{settings.autosaveMs} ms</span>
            </label>
            <input id="autosave" type="range" min={200} max={3000} step={100} value={settings.autosaveMs} onChange={(e) => void updateSettings({ autosaveMs: parseInt(e.target.value, 10) })} className="w-full accent-[var(--accent)]" aria-label="Autosave delay" />
            <div className="my-2 h-px" style={{ background: 'var(--border)' }} />
            {toggle('Velocity-based ink width', 'Synthesize pressure from stroke speed on devices without a pressure sensor (mouse, compat pens). Disable to draw uniform strokes.', settings.velocityPressure, (v) => void updateSettings({ velocityPressure: v }))}
            <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
            {toggle('Palm rejection', 'Ignore touch contacts while the stylus was recently active (Windows Ink).', settings.palmRejection, (v) => void updateSettings({ palmRejection: v }))}
            <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
            {toggle('Pen-only drawing', 'Only the stylus can lay ink — touch/mouse are reserved for navigation.', settings.penOnlyDrawing, (v) => void updateSettings({ penOnlyDrawing: v }))}
            <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
            {toggle('Pressure meter in status bar', 'Show live stylus pressure next to the save indicator.', settings.showPressureMeter, (v) => void updateSettings({ showPressureMeter: v }))}
          </div>
        </section>

        {/* Shortcuts */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 style={sectionTitle}><span className="inline-flex items-center gap-1.5"><Keyboard size={12} /> Keyboard shortcuts</span></h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={11} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input value={shortcutFilter} onChange={(e) => setShortcutFilter(e.target.value)} placeholder="Filter…" className="inkflow-input h-7 w-36 pl-6 text-[11px]" aria-label="Filter shortcuts" />
              </div>
              <button className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => void resetShortcuts()} title="Restore default shortcuts">
                <RotateCcw size={11} /> Reset
              </button>
            </div>
          </div>
          <div className="mt-2 max-h-80 overflow-y-auto" style={card}>
            {filteredShortcuts.map((binding) => (
              <div key={binding.action} className="flex items-center justify-between gap-4 border-b py-1.5 last:border-0" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[11px] text-[var(--text-secondary)]">{ACTION_LABELS[binding.action] ?? binding.action}</span>
                <button
                  className="min-w-[88px] rounded-md border px-2 py-1 text-center font-mono text-[10px] transition-colors"
                  style={{
                    borderColor: recording === binding.action ? 'var(--accent)' : 'var(--border-strong)',
                    background: recording === binding.action ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                    color: recording === binding.action ? 'var(--accent)' : 'var(--text-primary)',
                  }}
                  onClick={() => setRecording(recording === binding.action ? null : binding.action)}
                  aria-label={`Rebind ${ACTION_LABELS[binding.action] ?? binding.action}`}
                >
                  {recording === binding.action ? 'Press keys…' : binding.combo}
                </button>
              </div>
            ))}
            {filteredShortcuts.length === 0 && <p className="py-3 text-center text-[11px] text-[var(--text-muted)]">No shortcuts match “{shortcutFilter}”.</p>}
          </div>
        </section>

        {/* Storage */}
        <section className="mt-6">
          <h2 style={sectionTitle}><span className="inline-flex items-center gap-1.5"><Database size={12} /> Local storage</span></h2>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3" style={card}>
            <div className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <div><span className="font-semibold text-[var(--text-primary)]">Engine:</span> {backendKind() === 'sqlite' ? 'SQLite via tauri-plugin-sql' : 'IndexedDB (browser runtime)'} — fully offline</div>
              {stats && <div><span className="font-semibold text-[var(--text-primary)]">Stored:</span> {stats.notebooks} notebooks · {stats.notes} notes · {stats.pages} pages</div>}
              <div><span className="font-semibold text-[var(--text-primary)]">Stroke pages:</span> gzip-compressed, write-ahead journal, crash-safe</div>
            </div>
            <button className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]" onClick={() => flashStatus('Crash recovery runs automatically at launch — any interrupted save is replayed')}>
              <Save size={12} /> How recovery works
            </button>
          </div>
        </section>

        {/* About */}
        <section className="mt-6 mb-10">
          <h2 style={sectionTitle}><span className="inline-flex items-center gap-1.5"><Info size={12} /> About</span></h2>
          <div className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]" style={card}>
            <p className="font-semibold text-[var(--text-primary)]">InkFlow 0.1.0</p>
            <p className="mt-1">A professional handwriting and note-taking studio for graphics tablets. Strokes are pressure- and tilt-aware, interpolated with quadratic mid-point smoothing, and stored as compressed vector ink — export your work any time as PNG, SVG, PDF or an annotated PDF.</p>
          </div>
        </section>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  Settings, Moon, Sun, Monitor, FileUp, FileDown, ChevronDown, FileImage, FileText,
  FileCode2, Database, FolderInput, Droplets, Check, LayoutGrid,
  PanelLeft, PanelRight, GalleryVertical, Maximize2, Minimize2,
} from 'lucide-react'
import { setFullscreen } from './fullscreen'
import { useStore, selectCurrentNote, useCurrentPages } from '../../state/store'
import { engineRef, getEngineStrokes } from '../editor/engineRef'
import { exportPagePNG, exportPageSVG, exportNotePDF } from '../export/exportService'
import { importPdfFile } from '../pdf/importPdf'
import { repository } from '../../persistence/repository'
import type { InkStroke } from '../../types'

/** Top chrome: identity, breadcrumb with inline rename, import/export, theme, settings. */
export default function TitleBar(): React.JSX.Element {
  const note = useStore(selectCurrentNote)
  const pages = useCurrentPages()
  const notebooks = useStore((s) => s.notebooks)
  const currentNotebookId = useStore((s) => s.currentNotebookId)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const flashStatus = useStore((s) => s.flashStatus)
  const renameNote = useStore((s) => s.renameNote)
  const refresh = useStore((s) => s.refresh)
  const openNote = useStore((s) => s.openNote)
  const setView = useStore((s) => s.setView)
  const view = useStore((s) => s.view)

  const [exportOpen, setExportOpen] = useState(false)
  const [interfaceOpen, setInterfaceOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const interfaceRef = useRef<HTMLDivElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const [titleEdit, setTitleEdit] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    let mounted = true
    if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        const fs = await win.isFullscreen()
        if (mounted) setIsFullscreen(fs)
      })
      return () => { mounted = false }
    }
    if (typeof document !== 'undefined') {
      // Initialize from the current DOM state via a microtask so React doesn't
      // need a synchronous setState inside the effect body.
      void Promise.resolve().then(() => {
        if (mounted) setIsFullscreen(Boolean(document.fullscreenElement))
      })
      const onFullscreenChange = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
      document.addEventListener('fullscreenchange', onFullscreenChange)
      return () => {
        document.removeEventListener('fullscreenchange', onFullscreenChange)
        mounted = false
      }
    }
  }, [])

  const toggleFullscreen = (): void => {
    const next = !isFullscreen
    void setFullscreen(next).then(() => {
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        setIsFullscreen(next)
      } else {
        setIsFullscreen(Boolean(document.fullscreenElement))
      }
    }).catch(() => {
      flashStatus('Fullscreen is not available in this window')
    })
  }

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
      if (!interfaceRef.current?.contains(e.target as Node)) setInterfaceOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [])

  const notebook = notebooks.find((n) => n.id === currentNotebookId)

  const cycleTheme = (): void => {
    const order: typeof settings.theme[] = ['dark', 'light', 'system']
    const next = order[(order.indexOf(settings.theme) + 1) % order.length]
    void updateSettings({ theme: next })
    flashStatus(`Theme: ${next}`)
  }

  const ThemeIcon = settings.theme === 'dark' ? Moon : settings.theme === 'light' ? Sun : Monitor

  const exportPng = async (): Promise<void> => {
    if (!note) return
    const page = pages[useStore.getState().currentPageIndex] ?? pages[0]
    if (!page) return
    await exportPagePNG({ note, pressureGamma: settings.pressureGamma }, page, getEngineStrokes())
    flashStatus('PNG exported')
    setExportOpen(false)
  }

  const exportSvg = (): void => {
    if (!note) return
    const page = pages[useStore.getState().currentPageIndex] ?? pages[0]
    if (!page) return
    exportPageSVG({ note, pressureGamma: settings.pressureGamma }, page, getEngineStrokes())
    flashStatus('SVG exported')
    setExportOpen(false)
  }

  const exportPdf = async (): Promise<void> => {
    if (!note) return
    const strokesByPage = new Map<string, InkStroke[]>()
    // Current page uses live strokes; other pages come from storage.
    for (const page of pages) {
      if (page.id === engineRef.current?.getPageId()) strokesByPage.set(page.id, getEngineStrokes())
      else strokesByPage.set(page.id, await repository.loadStrokes(page.id))
    }
    await exportNotePDF({ note, pressureGamma: settings.pressureGamma }, pages, strokesByPage)
    flashStatus('PDF exported')
    setExportOpen(false)
  }

  const onImportPdf = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !currentNotebookId) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    try {
      const { note: created } = await importPdfFile(bytes, file.name, currentNotebookId, useStore.getState().currentFolderId)
      await refresh()
      openNote(created.id, 0)
      flashStatus('PDF imported — annotate freely')
    } catch (err) {
      console.error(err)
      flashStatus('Failed to import PDF')
    }
  }

  const exportBackup = async (): Promise<void> => {
    const backup = await repository.exportBackup()
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `inkflow-backup-${stamp}.inkflow.json`
    a.click()
    URL.revokeObjectURL(url)
    flashStatus('Backup exported')
  }

  const onRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      await repository.restoreBackup(parsed)
      await refresh()
      flashStatus('Backup restored (new copies created)')
    } catch (err) {
      console.error(err)
      flashStatus('Invalid backup file')
    }
  }

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 border-b px-3"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      aria-label="Application bar"
    >
      {/* Brand */}
      <div className="flex items-center gap-2 pr-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'linear-gradient(135deg, #7c6cf6, #4f46e5)', boxShadow: '0 4px 12px -2px rgba(124,108,246,0.6)' }}>
          <Droplets size={15} strokeWidth={2} className="text-white" fill="rgba(255,255,255,0.35)" />
        </div>
        <span className="text-[13px] font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>InkFlow</span>
      </div>

      <div className="h-5 w-px" style={{ background: 'var(--border-strong)' }} />

      {/* Panel visibility toggles — sidebar / pages rail / inspector */}
      <div className="flex items-center gap-0.5" aria-label="Panel visibility">
        <PanelToggleButton
          icon={<PanelLeft size={15} strokeWidth={1.8} />}
          active={settings.showSidebar}

          title={settings.showSidebar ? 'Hide sidebar' : 'Show sidebar'}
          onClick={() => void updateSettings({ showSidebar: !settings.showSidebar })}
        />
        <PanelToggleButton
          icon={<GalleryVertical size={15} strokeWidth={1.8} />}
          active={settings.showPagesRail}

          title={settings.showPagesRail ? 'Hide pages rail' : 'Show pages rail'}
          onClick={() => void updateSettings({ showPagesRail: !settings.showPagesRail })}
        />
        <PanelToggleButton
          icon={<PanelRight size={15} strokeWidth={1.8} />}
          active={settings.showInspector}

          title={settings.showInspector ? 'Hide inspector' : 'Show inspector'}
          onClick={() => void updateSettings({ showInspector: !settings.showInspector })}
        />
      </div>

      <div className="h-5 w-px" style={{ background: 'var(--border-strong)' }} />

      {/* Breadcrumb / note title */}
      <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
        <span className="shrink-0 text-[var(--text-muted)]">{notebook?.name ?? 'Workspace'}</span>
        <span className="shrink-0 text-[var(--text-muted)]">/</span>
        {note ? (
          titleEdit !== null ? (
            <input
              autoFocus
              className="inkflow-input h-6 min-w-0 flex-1 px-1.5 text-[12px] font-semibold"
              value={titleEdit}
              onChange={(e) => setTitleEdit(e.target.value)}
              onBlur={() => { void renameNote(note.id, titleEdit); setTitleEdit(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { void renameNote(note.id, titleEdit); setTitleEdit(null) }
                if (e.key === 'Escape') setTitleEdit(null)
              }}
              aria-label="Note title"
            />
          ) : (
            <button
              className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-[12px] font-semibold transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
              title="Rename note"
              onClick={() => setTitleEdit(note.title)}
            >
              {note.title}
            </button>
          )
        ) : (
          <span className="text-[var(--text-muted)]">No note selected</span>
        )}
      </div>

      {/* Import PDF */}
      <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void onImportPdf(e)} aria-hidden="true" />
      <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={() => pdfInputRef.current?.click()} title="Import a PDF to annotate">
        <FileUp size={14} /> <span className="hidden xl:inline">Import PDF</span>
      </button>

      {/* Export menu */}
      <div className="relative" ref={exportRef}>
        <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }} onClick={() => setExportOpen((v) => !v)} aria-haspopup="menu" aria-expanded={exportOpen}>
          <FileDown size={14} /> <span className="hidden xl:inline">Export</span> <ChevronDown size={12} />
        </button>
        {exportOpen && (
          <div role="menu" className="fade-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border py-1.5 shadow-2xl" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)' }}>
            <MenuRow icon={<FileImage size={15} />} label="Page as PNG" hint="Current page, 2×" onClick={() => void exportPng()} />
            <MenuRow icon={<FileCode2 size={15} />} label="Page as SVG" hint="Vector, current page" onClick={exportSvg} />
            <MenuRow icon={<FileText size={15} />} label="Note as PDF" hint={note?.pdfAssetId ? 'Annotated PDF, vector ink' : 'All pages rasterized'} onClick={() => void exportPdf()} />
            <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
            <MenuRow icon={<Database size={15} />} label="Backup workspace…" hint=".inkflow.json" onClick={() => { void exportBackup(); setExportOpen(false) }} />
            <MenuRow icon={<FolderInput size={15} />} label="Restore backup…" hint="Creates new copies" onClick={() => { backupInputRef.current?.click(); setExportOpen(false) }} />
          </div>
        )}
        <input ref={backupInputRef} type="file" accept="application/json,.json,.inkflow.json" className="hidden" onChange={(e) => void onRestoreBackup(e)} aria-hidden="true" />
      </div>

      {/* Interface mode picker — Simple / Advanced / Custom, lives in the top chrome */}
      <div className="relative" ref={interfaceRef}>
        <button
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          onClick={() => setInterfaceOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={interfaceOpen}
          aria-label="Toolbar interface"
          title={`Interface: ${settings.interfaceMode[0].toUpperCase() + settings.interfaceMode.slice(1)}`}
        >
          <LayoutGrid size={13} className="text-[var(--accent)]" />
          <span className="hidden xl:inline">{settings.interfaceMode[0].toUpperCase() + settings.interfaceMode.slice(1)}</span>
          <ChevronDown size={11} className="text-[var(--text-muted)]" />
        </button>
        {interfaceOpen && (
          <div role="menu" className="fade-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border py-1.5 shadow-2xl" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)' }}>
            <div className="px-3 pt-1.5 pb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">Toolbar interface</div>
            {([
              ['simple', 'Simple', 'Only the essentials — perfect for kids'],
              ['advanced', 'Advanced', 'Every tool unlocked'],
              ['custom', 'Custom', 'Your own tool selection'],
            ] as const).map(([mode, label, hint]) => (
              <button
                key={mode}
                role="menuitemradio"
                aria-checked={settings.interfaceMode === mode}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
                onClick={() => { void updateSettings({ interfaceMode: mode }); setInterfaceOpen(false); flashStatus(`Interface: ${label}`) }}
              >
                <span className="flex h-4 w-4 items-center justify-center">{settings.interfaceMode === mode && <Check size={14} className="text-[var(--accent)]" strokeWidth={3} />}</span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-[var(--text-primary)]">{label}</span>
                  <span className="block text-[10px] text-[var(--text-muted)]">{hint}</span>
                </span>
              </button>
            ))}
            <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
            <button
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-medium transition-colors hover:bg-[var(--accent-soft)]"
              style={{ color: 'var(--accent)' }}
              onClick={() => { setInterfaceOpen(false); setView('settings') }}
            >
              Edit tools shown in each toolbar…
            </button>
          </div>
        )}
      </div>

      {/* Fullscreen */}
      <button
        className="rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? <Minimize2 size={16} strokeWidth={1.8} /> : <Maximize2 size={16} strokeWidth={1.8} />}
      </button>

      {/* Theme */}
      <button className="rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={cycleTheme} title="Toggle theme (dark / light / system)" aria-label="Toggle theme">
        <ThemeIcon size={16} strokeWidth={1.8} />
      </button>

      {/* Settings */}
      <button
        className="rounded-lg p-2 transition-colors"
        style={{ background: view === 'settings' ? 'var(--accent-soft)' : 'transparent', color: view === 'settings' ? 'var(--accent)' : 'var(--text-secondary)' }}
        onClick={() => setView(view === 'settings' ? 'workspace' : 'settings')}
        title="Settings (Ctrl+,)"
        aria-label="Settings"
        aria-pressed={view === 'settings'}
      >
        <Settings size={16} strokeWidth={1.8} />
      </button>
    </header>
  )
}

const MenuRow = ({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }): React.JSX.Element => (
  <button role="menuitem" className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]" onClick={onClick}>
    <span className="text-[var(--accent)]">{icon}</span>
    <span className="min-w-0">
      <span className="block text-[12px] font-medium text-[var(--text-primary)]">{label}</span>
      {hint && <span className="block text-[10px] text-[var(--text-muted)]">{hint}</span>}
    </span>
  </button>
)

const PanelToggleButton = ({ icon, active, title, onClick }: { icon: React.ReactNode; active: boolean; title: string; onClick: () => void }): React.JSX.Element => (
  <button
    className="rounded-md p-1.5 transition-colors"
    style={{ background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)' }}
    onClick={onClick}
    title={title}
    aria-label={title}
    aria-pressed={active}
  >
    {icon}
  </button>
)

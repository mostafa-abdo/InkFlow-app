import { useState } from 'react'
import {
  Star, Archive, Copy, Trash2, Tag, X, FileDown, PanelRightClose, PanelRightOpen,
} from 'lucide-react'
import { useStore, selectCurrentNote, useCurrentPages } from '../../state/store'
import { getEngineStrokes, engineRef } from './engineRef'
import { exportNotePDF } from '../export/exportService'
import { repository } from '../../persistence/repository'
import type { PageTemplate, PaperSize, Note } from '../../types'
import { PAPER_SIZES } from '../../types'

const TEMPLATES: { id: PageTemplate; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'cornell', label: 'Cornell notes' },
  { id: 'planner', label: 'Planner' },
  { id: 'custom', label: 'Custom background' },
]

const PAPER_BACKGROUNDS = ['#fdfbf7', '#ffffff', '#f7f4ec', '#eef2f7', '#f2ead9', '#12141c', '#1c1a28', '#201612']

/** Right-hand inspector: page template, paper, pressure curve, tags, note actions. Collapsible. */
export default function PropertiesPanel(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [perPage, setPerPage] = useState(false)

  const note = useStore(selectCurrentNote)
  const pages = useCurrentPages()
  const pageIndex = useStore((s) => s.currentPageIndex)
  const updateNotePaper = useStore((s) => s.updateNotePaper)
  const setPagePaper = useStore((s) => s.setPagePaper)
  const setNoteTags = useStore((s) => s.setNoteTags)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const archiveNote = useStore((s) => s.archiveNote)
  const duplicateNote = useStore((s) => s.duplicateNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const flashStatus = useStore((s) => s.flashStatus)
  const pressureGamma = useStore((s) => s.settings.pressureGamma)
  const updateSettings = useStore((s) => s.updateSettings)

  if (!note) return (
    <div className="flex w-72 shrink-0 items-center justify-center border-l text-[12px] text-[var(--text-muted)]" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
      No note selected
    </div>
  )

  const currentPage = pages[pageIndex] ?? pages[0]
  const paper = currentPage?.paper ?? note.paper

  const applyPaper = (patch: Partial<Note['paper']>): void => {
    if (perPage && currentPage) void setPagePaper(currentPage.id, patch)
    else void updateNotePaper(note.id, patch)
  }

  const addTag = (): void => {
    const t = tagInput.trim().toLowerCase()
    if (!t) return
    void setNoteTags(note.id, [...note.tags, t])
    setTagInput('')
  }

  const exportAnnotated = async (): Promise<void> => {
    const strokesByPage = new Map<string, Awaited<ReturnType<typeof repository.loadStrokes>>>()
    for (const page of pages) {
      if (page.id === engineRef.current?.getPageId()) strokesByPage.set(page.id, getEngineStrokes())
      else strokesByPage.set(page.id, await repository.loadStrokes(page.id))
    }
    await exportNotePDF({ note, pressureGamma }, pages, strokesByPage)
    flashStatus('Annotated PDF exported')
  }

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-l py-3" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
        <button className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={() => setCollapsed(false)} aria-label="Expand inspector" title="Expand inspector">
          <PanelRightOpen size={15} />
        </button>
      </div>
    )
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6,
  }
  const inputCls = 'inkflow-input w-full text-[12px]'

  return (
    <div className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-l" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }} aria-label="Inspector">
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <span style={{ ...sectionTitle, marginBottom: 0 }}>Inspector</span>
        <button className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={() => setCollapsed(true)} aria-label="Collapse inspector" title="Collapse inspector">
          <PanelRightClose size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        {/* --------------------------------------------------- page */}
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 style={{ ...sectionTitle, marginBottom: 0 }}>Page</h3>
            {!note.pdfAssetId && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-[var(--text-muted)]" title="Apply changes only to the current page">
                <input type="checkbox" className="accent-[var(--accent)]" checked={perPage} onChange={(e) => setPerPage(e.target.checked)} />
                This page only
              </label>
            )}
          </div>

          {note.pdfAssetId ? (
            <p className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel-2)' }}>
              PDF page {currentPage?.pdfPage ?? 1} of {pages.length}. The original document is preserved; annotations are stored as a separate vector layer.
            </p>
          ) : (
            <>
              <label className="mb-1 block text-[10px] text-[var(--text-muted)]" htmlFor="tpl">Template</label>
              <select id="tpl" className={inputCls} value={paper.template} onChange={(e) => applyPaper({ template: e.target.value as PageTemplate })}>
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-muted)]" htmlFor="size">Paper size</label>
                  <select id="size" className={inputCls} value={paper.size} onChange={(e) => applyPaper({ size: e.target.value as PaperSize })}>
                    {Object.entries(PAPER_SIZES).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
                    <option value="infinite">Infinite canvas</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-muted)]" htmlFor="spacing">Spacing · {paper.spacing}px</label>
                  <input id="spacing" type="range" min={14} max={72} step={2} value={paper.spacing} onChange={(e) => applyPaper({ spacing: parseInt(e.target.value, 10) })} className="mt-2 w-full accent-[var(--accent)]" aria-label="Template spacing" />
                </div>
              </div>

              <div className="mt-2">
                <span className="mb-1 block text-[10px] text-[var(--text-muted)]">Background</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PAPER_BACKGROUNDS.map((c) => (
                    <button
                      key={c}
                      className="h-6 w-6 rounded-md transition-transform hover:scale-110"
                      style={{ background: c, boxShadow: paper.background.toLowerCase() === c ? '0 0 0 2px var(--bg-panel), 0 0 0 4px var(--accent)' : '0 0 0 1px var(--border-strong)' }}
                      onClick={() => applyPaper({ background: c })}
                      aria-label={`Paper background ${c}`}
                    />
                  ))}
                  <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-md" style={{ background: 'conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }} title="Custom background color">
                    <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={paper.background} onChange={(e) => applyPaper({ background: e.target.value })} aria-label="Custom background color" />
                  </label>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ----------------------------------------------------- ink */}
        <section>
          <h3 style={sectionTitle}>Ink</h3>
          <label className="mb-1 block text-[10px] text-[var(--text-muted)]" htmlFor="gamma">Pressure curve · {pressureGamma.toFixed(2)}</label>
          <input id="gamma" type="range" min={0.5} max={2.6} step={0.05} value={pressureGamma} onChange={(e) => void updateSettings({ pressureGamma: parseFloat(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label="Stylus pressure curve" />
          <div className="mt-1 flex justify-between text-[9px] text-[var(--text-muted)]"><span>Light touch</span><span>Firm press</span></div>
        </section>

        {/* ---------------------------------------------------- tags */}
        <section>
          <h3 style={sectionTitle}><span className="inline-flex items-center gap-1"><Tag size={10} /> Tags</span></h3>
          <div className="flex flex-wrap gap-1.5">
            {note.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] text-[var(--text-secondary)]" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel-2)' }}>
                #{tag}
                <button onClick={() => void setNoteTags(note.id, note.tags.filter((t) => t !== tag))} aria-label={`Remove tag ${tag}`} className="text-[var(--text-muted)] hover:text-[var(--danger)]"><X size={10} /></button>
              </span>
            ))}
            {note.tags.length === 0 && <span className="text-[10px] text-[var(--text-muted)]">No tags yet</span>}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <input
              className={inputCls}
              placeholder="Add tag…"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              aria-label="Add tag"
            />
            <button className="rounded-lg px-2 text-[11px] font-semibold" style={{ background: 'var(--bg-active)', color: 'var(--text-secondary)' }} onClick={addTag}>Add</button>
          </div>
        </section>

        {/* -------------------------------------------------- actions */}
        <section>
          <h3 style={sectionTitle}>Note actions</h3>
          <div className="grid grid-cols-2 gap-1.5">
            <ActionButton icon={<Star size={13} className={note.favorite ? 'fill-[var(--accent)] text-[var(--accent)]' : ''} />} label={note.favorite ? 'Unfavorite' : 'Favorite'} onClick={() => void toggleFavorite(note.id)} />
            <ActionButton icon={<Archive size={13} />} label={note.archived ? 'Unarchive' : 'Archive'} onClick={() => { void archiveNote(note.id, !note.archived); flashStatus(note.archived ? 'Note restored' : 'Note archived') }} />
            <ActionButton icon={<Copy size={13} />} label="Duplicate" onClick={() => { void duplicateNote(note.id); flashStatus('Note duplicated') }} />
            <ActionButton icon={<Trash2 size={13} />} label="Delete" danger onClick={() => { void deleteNote(note.id); flashStatus('Note deleted') }} />
          </div>
          {note.pdfAssetId && (
            <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors hover:bg-[var(--accent-soft)]" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => void exportAnnotated()}>
              <FileDown size={13} /> Export annotated PDF
            </button>
          )}
        </section>
      </div>
    </div>
  )
}

const ActionButton = ({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }): React.JSX.Element => (
  <button
    className="flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
    style={{ borderColor: 'var(--border)', color: danger ? 'var(--danger)' : 'var(--text-secondary)' }}
    onClick={onClick}
  >
    {icon} {label}
  </button>
)

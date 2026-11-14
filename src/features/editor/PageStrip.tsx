import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, FileText } from 'lucide-react'
import { useStore, selectCurrentNote, useCurrentPages } from '../../state/store'
import { repository } from '../../persistence/repository'
import { renderStroke } from '../../engine/strokeRenderer'
import { renderTemplate } from '../../engine/templates'
import type { Page } from '../../types'

/**
 * Vertical page rail with live thumbnails. Thumbnails redraw lazily and
 * debounce against stroke commits so scrubbing stays fluid.
 */
export default function PageStrip({ thumbVersion }: { thumbVersion: number }): React.JSX.Element | null {
  const note = useStore(selectCurrentNote)
  const pages = useCurrentPages()
  const pageIndex = useStore((s) => s.currentPageIndex)
  const setPageIndex = useStore((s) => s.setPageIndex)
  const addPage = useStore((s) => s.addPage)
  const removePage = useStore((s) => s.removePage)
  const pressureGamma = useStore((s) => s.settings.pressureGamma)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  if (!note) return null

  return (
    <div
      className="flex w-[86px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-l py-3"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      aria-label="Pages"
    >
      {pages.map((page, i) => (
        <div key={page.id} className="group relative flex flex-col items-center gap-1">
          <button
            className="relative block overflow-hidden rounded-md border-2 transition-all"
            style={{
              borderColor: i === pageIndex ? 'var(--accent)' : 'var(--border-strong)',
              boxShadow: i === pageIndex ? '0 0 0 3px var(--accent-soft)' : 'none',
              background: '#fdfbf7',
            }}
            onClick={() => setPageIndex(i)}
            aria-label={`Page ${i + 1}`}
            aria-current={i === pageIndex}
          >
            <Thumbnail noteId={note.id} page={page} pressureGamma={pressureGamma} refreshKey={thumbVersion} />
            {page.pdfPage != null && (
              <span className="absolute right-0.5 bottom-0.5 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[8px] font-bold text-white">
                <FileText size={8} />PDF
              </span>
            )}
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] tabular-nums" style={{ color: i === pageIndex ? 'var(--accent)' : 'var(--text-muted)' }}>{i + 1}</span>
            {pages.length > 1 && (
              confirmDelete === page.id ? (
                <button
                  className="rounded bg-[var(--danger)] px-1.5 text-[9px] font-bold text-white"
                  onClick={() => { void removePage(page.id); setConfirmDelete(null) }}
                >
                  Sure?
                </button>
              ) : (
                <button
                  className="rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--danger)]"
                  aria-label="Delete page"
                  onClick={() => setConfirmDelete(page.id)}
                >
                  <Trash2 size={10} />
                </button>
              )
            )}
          </div>
        </div>
      ))}
      <button
        className="flex h-14 w-16 items-center justify-center rounded-md border border-dashed transition-colors"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
        onClick={() => void addPage()}
        aria-label="Add page"
        title="Add page"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

const Thumbnail = ({ noteId, page, pressureGamma, refreshKey }: { noteId: string; page: Page; pressureGamma: number; refreshKey: number }): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const note = useStore((s) => s.notes.find((n) => n.id === noteId) ?? null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const paper = page.paper ?? note?.paper
      if (!paper) return
      const strokes = await repository.loadStrokes(page.id)
      if (cancelled || !canvasRef.current) return
      const W = 64
      const H = Math.max(20, Math.round((W * paper.height) / paper.width))
      const canvas = canvasRef.current
      canvas.width = W * 2
      canvas.height = H * 2
      const ctx = canvas.getContext('2d')!
      const scale = canvas.width / paper.width
      ctx.fillStyle = paper.background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      renderTemplate(ctx, paper, paper.width, paper.height)
      for (const stroke of strokes) renderStroke(ctx, stroke, pressureGamma)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.paper, note?.paper, refreshKey])

  return <canvas ref={canvasRef} style={{ width: 64, height: 'auto', display: 'block' }} aria-hidden="true" />
}

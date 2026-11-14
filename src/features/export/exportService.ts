import { jsPDF } from 'jspdf'
import { PDFDocument, rgb, type PDFPage, LineCapStyle } from 'pdf-lib'
import type { InkStroke, Note, Page, PaperSpec } from '../../types'
import { renderStroke, strokeToSvgPath } from '../../engine/strokeRenderer'
import { renderTemplate } from '../../engine/templates'
import { shapeAnchors } from '../../engine/strokeRenderer'
import { repository } from '../../persistence/repository'
import { openPdf, renderPdfPage, pointsToPx } from '../pdf/pdfService'

/**
 * Export pipeline: note pages → PNG / SVG / PDF / annotated PDF.
 * Rendering is shared with the on-screen engine through renderStroke(),
 * so exported ink looks exactly like what the user drew.
 */

export interface ExportContext {
  note: Note
  pressureGamma: number
  /** Optional custom background image for 'custom' template pages */
  customBackground?: ((pageIndex: number) => Promise<CanvasImageSource | null>) | null
}

const download = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const sanitizeFilename = (name: string): string =>
  (name.trim() || 'Untitled').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80)

const pagePaper = (note: Note, page: Page): PaperSpec => page.paper ?? note.paper

/** Load the PDF-backed page image at high resolution for export. */
const pdfImageForPage = async (note: Note, page: Page, targetWidthPx: number): Promise<HTMLCanvasElement | null> => {
  if (!note.pdfAssetId || page.pdfPage == null) return null
  const asset = await repository.getAsset(note.pdfAssetId)
  if (!asset) return null
  const { doc } = await openPdf(asset.bytes)
  return renderPdfPage(doc, page.pdfPage, targetWidthPx)
}

/** Render a full page (paper + template + PDF content + ink) to a canvas. */
export const renderPageToCanvas = async (
  note: Note,
  page: Page,
  strokes: InkStroke[],
  pressureGamma: number,
  scale = 2,
  customBackground?: ((pageIndex: number) => Promise<CanvasImageSource | null>) | null,
): Promise<HTMLCanvasElement> => {
  const paper = pagePaper(note, page)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(paper.width * scale))
  canvas.height = Math.max(1, Math.round(paper.height * scale))
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = paper.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  const pdfImage = await pdfImageForPage(note, page, canvas.width)
  if (pdfImage) {
    ctx.drawImage(pdfImage, 0, 0, paper.width, paper.height)
  } else if (paper.template === 'custom' && customBackground) {
    const img = await customBackground(page.index)
    if (img) ctx.drawImage(img, 0, 0, paper.width, paper.height)
  } else {
    renderTemplate(ctx, paper, paper.width, paper.height)
  }

  for (const stroke of strokes) renderStroke(ctx, stroke, pressureGamma)
  return canvas
}

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), type, quality)
  })

export const exportPagePNG = async (ctx: ExportContext, page: Page, strokes: InkStroke[]): Promise<void> => {
  const canvas = await renderPageToCanvas(ctx.note, page, strokes, ctx.pressureGamma, 2, ctx.customBackground)
  const blob = await canvasToBlob(canvas, 'image/png')
  download(`${sanitizeFilename(ctx.note.title)} — p${page.index + 1}.png`, blob)
}

/* ------------------------------------------------------------------- SVG */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const shapeToSvg = (s: InkStroke): string => {
  const [a, b] = shapeAnchors(s)
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const stroke = `stroke="${esc(s.color)}" stroke-width="${s.width}" stroke-opacity="${s.opacity}" fill="none" stroke-linecap="round" stroke-linejoin="round"`
  switch (s.kind) {
    case 'rect':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ${stroke}/>`
    case 'ellipse':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${stroke}/>`
    case 'triangle':
      return `<polygon points="${cx},${y} ${x + w},${y + h} ${x},${y + h}" ${stroke}/>`
    case 'diamond':
      return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" ${stroke}/>`
    case 'star': {
      const outer = Math.min(w, h) / 2
      const inner = outer / 2.1
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner
        const ang = (Math.PI / 5) * i - Math.PI / 2
        pts.push(`${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`)
      }
      return `<polygon points="${pts.join(' ')}" ${stroke}/>`
    }
    case 'line':
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${stroke}/>`
    case 'arrow': {
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const head = Math.max(12, s.width * 3.2)
      const spread = Math.PI / 7.5
      const h1x = b.x - head * Math.cos(ang - spread)
      const h1y = b.y - head * Math.sin(ang - spread)
      const h2x = b.x - head * Math.cos(ang + spread)
      const h2y = b.y - head * Math.sin(ang + spread)
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${stroke}/><line x1="${b.x}" y1="${b.y}" x2="${h1x}" y2="${h1y}" ${stroke}/><line x1="${b.x}" y1="${b.y}" x2="${h2x}" y2="${h2y}" ${stroke}/>`
    }
    default:
      return ''
  }
}

export const exportPageSVG = (ctx: ExportContext, page: Page, strokes: InkStroke[]): void => {
  const paper = pagePaper(ctx.note, page)
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paper.width} ${paper.height}" width="${paper.width}" height="${paper.height}">`)
  parts.push(`<rect width="100%" height="100%" fill="${esc(paper.background)}"/>`)
  for (const s of strokes) {
    if (s.kind === 'free') {
      const d = strokeToSvgPath(s.points)
      if (d) {
        parts.push(
          `<path d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="${s.width.toFixed(2)}" stroke-opacity="${s.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`,
        )
      }
    } else {
      parts.push(shapeToSvg(s))
    }
  }
  parts.push('</svg>')
  download(
    `${sanitizeFilename(ctx.note.title)} — p${page.index + 1}.svg`,
    new Blob([parts.join('')], { type: 'image/svg+xml' }),
  )
}

/* ------------------------------------------------------------------- PDF */

export const exportNotePDF = async (
  ctx: ExportContext,
  pages: Page[],
  strokesByPage: Map<string, InkStroke[]>,
): Promise<void> => {
  if (ctx.note.pdfAssetId) {
    await exportAnnotatedPdf(ctx, pages, strokesByPage)
    return
  }
  const ordered = [...pages].sort((a, b) => a.index - b.index)
  if (ordered.length === 0) return
  const firstPaper = pagePaper(ctx.note, ordered[0])
  const firstOrientation = firstPaper.width >= firstPaper.height ? 'landscape' : 'portrait'
  const doc = new jsPDF({
    unit: 'px',
    format: [firstPaper.width, firstPaper.height],
    orientation: firstOrientation,
    compress: true,
  })
  let first = true
  for (const page of ordered) {
    const paper = pagePaper(ctx.note, page)
    const canvas = await renderPageToCanvas(ctx.note, page, strokesByPage.get(page.id) ?? [], ctx.pressureGamma, 2, ctx.customBackground)
    if (first) {
      first = false
    } else {
      const orientation = paper.width >= paper.height ? 'landscape' : 'portrait'
      doc.addPage([paper.width, paper.height], orientation)
    }
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, paper.width, paper.height)
  }
  doc.save(`${sanitizeFilename(ctx.note.title)}.pdf`)
}

/**
 * Annotated-PDF export: copy the original (vector) PDF pages and draw the
 * ink layer on top as vector operations — the underlying text stays selectable.
 */
export const exportAnnotatedPdf = async (
  ctx: ExportContext,
  pages: Page[],
  strokesByPage: Map<string, InkStroke[]>,
): Promise<void> => {
  const asset = await repository.getAsset(ctx.note.pdfAssetId)
  if (!asset) throw new Error('Original PDF asset is missing — cannot export annotated copy')
  const doc = await PDFDocument.load(asset.bytes)

  for (const page of pages) {
    if (page.pdfPage == null) continue
    const strokes = strokesByPage.get(page.id) ?? []
    if (strokes.length === 0) continue
    const pdfPage = doc.getPage(page.pdfPage - 1)
    const { height } = pdfPage.getSize()
    const k = 72 / 96 // page units (px) → PDF points
    const toY = (y: number): number => height - y * k // flip y axis

    for (const stroke of strokes) {
      const opacity = Math.min(1, Math.max(0.05, stroke.opacity))
      const thickness = Math.max(0.4, stroke.width * k * 0.72)
      const color = hexToRgb(stroke.color)

      if (stroke.kind === 'free') {
        const d = freeStrokeSvgPath(stroke.points, k, toY)
        if (!d) continue
        pdfPage.drawSvgPath(d, { borderColor: color, borderWidth: thickness, borderOpacity: opacity, borderLineCap: LineCapStyle.Round })
      } else {
        drawShapeOnPdf(pdfPage, stroke, k, toY, color, opacity, thickness)
      }
    }
  }

  const bytes = await doc.save()
  download(
    `${sanitizeFilename(ctx.note.title)} (annotated).pdf`,
    new Blob([bytes as BlobPart], { type: 'application/pdf' }),
  )
}

const hexToRgb = (hex: string): ReturnType<typeof rgb> => {
  const m = hex.replace('#', '')
  const v = m.length === 3
    ? m.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
  return rgb((v[0] ?? 0) / 255, (v[1] ?? 0) / 255, (v[2] ?? 0) / 255)
}

const freeStrokeSvgPath = (
  points: { x: number; y: number }[],
  k: number,
  toY: (y: number) => number,
): string => {
  if (points.length === 0) return ''
  const fx = (n: number): string => (Math.round(n * k * 100) / 100).toString()
  const fy = (y: number): string => (Math.round(toY(y) * 100) / 100).toString()
  let d = `M ${fx(points[0].x)} ${fy(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2
    const midY = (points[i].y + points[i + 1].y) / 2
    d += ` Q ${fx(points[i].x)} ${fy(points[i].y)} ${fx(midX)} ${fy(midY)}`
  }
  const last = points[points.length - 1]
  d += ` L ${fx(last.x)} ${fy(last.y)}`
  return d
}

const drawShapeOnPdf = (
  pdfPage: PDFPage,
  stroke: InkStroke,
  k: number,
  toY: (y: number) => number,
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
): void => {
  const [a, b] = shapeAnchors(stroke)
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    pdfPage.drawLine({
      start: { x: x1 * k, y: toY(y1) },
      end: { x: x2 * k, y: toY(y2) },
      thickness,
      color,
      opacity,
      lineCap: LineCapStyle.Round,
    })
  }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  const cx = (a.x + b.x) / 2
  const cy = (y + y + h) / 2

  switch (stroke.kind) {
    case 'rect':
      pdfPage.drawRectangle({
        x: x * k, y: toY(y + h), width: w * k, height: h * k,
        borderColor: color, borderWidth: thickness, borderOpacity: opacity, borderLineCap: LineCapStyle.Round,
      })
      break
    case 'ellipse':
      pdfPage.drawEllipse({
        x: cx * k, y: toY((a.y + b.y) / 2), xScale: (w / 2) * k, yScale: (h / 2) * k,
        borderColor: color, borderWidth: thickness, borderOpacity: opacity, borderLineCap: LineCapStyle.Round,
      })
      break
    case 'triangle': {
      const pts: [number, number][] = [[cx, y], [x + w, y + h], [x, y + h], [cx, y]]
      for (let i = 1; i < pts.length; i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
      break
    }
    case 'diamond': {
      const pts: [number, number][] = [[cx, y], [x + w, cy], [cx, y + h], [x, cy], [cx, y]]
      for (let i = 1; i < pts.length; i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
      break
    }
    case 'line':
      line(a.x, a.y, b.x, b.y)
      break
    case 'arrow': {
      line(a.x, a.y, b.x, b.y)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const head = Math.max(12, stroke.width * 3.2) / k
      const spread = Math.PI / 7.5
      line(b.x, b.y, b.x - head * Math.cos(ang - spread), b.y - head * Math.sin(ang - spread))
      line(b.x, b.y, b.x - head * Math.cos(ang + spread), b.y - head * Math.sin(ang + spread))
      break
    }
    default:
      break
  }
}

/** Re-export for convenience — used by the PDF import flow. */
export const pdfPointsToPx = pointsToPx

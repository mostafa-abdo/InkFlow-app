import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * pdf.js integration. Loading is lazy — the worker is only configured the
 * first time a PDF is opened, so startup cost stays low.
 */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfHandle {
  pageCount: number
  pageSize(page: number): { width: number; height: number } // points
}

/** Open a PDF from raw bytes. */
export const openPdf = async (bytes: Uint8Array): Promise<{ handle: PdfHandle; doc: pdfjs.PDFDocumentProxy }> => {
  // pdf.js transfers the buffer; copy to keep the original usable.
  const copy = bytes.slice()
  const doc = await pdfjs.getDocument({ data: copy }).promise
  const sizes: { width: number; height: number }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    sizes.push({ width: viewport.width, height: viewport.height })
  }
  return {
    doc,
    handle: {
      pageCount: doc.numPages,
      pageSize: (page: number) => sizes[page - 1] ?? { width: 612, height: 792 },
    },
  }
}

/**
 * Rasterize one PDF page to a canvas. `targetWidthPx` controls render scale —
 * pass the on-screen paper width for crisp display (2x recommended).
 */
export const renderPdfPage = async (
  doc: pdfjs.PDFDocumentProxy,
  pageNumber: number,
  targetWidthPx: number,
): Promise<HTMLCanvasElement> => {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = targetWidthPx / base.width
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas
}

/** 96dpi-ish conversion between PDF points and page units. */
export const pointsToPx = (pt: number): number => (pt * 96) / 72
export const pxToPoints = (px: number): number => (px * 72) / 96

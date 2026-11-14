import type { Note, Page } from '../../types'
import { uid } from '../../types'
import { openPdf, pointsToPx } from './pdfService'
import { repository } from '../../persistence/repository'
import { getBackend } from '../../persistence/adapter'

/**
 * Create a PDF-backed note: one backing page per PDF page, the PDF bytes
 * stored once as an asset, and the ink layer initially empty.
 * Annotation strokes live in page_strokes — the original PDF is never modified.
 */
export const importPdfFile = async (
  bytes: Uint8Array,
  fileName: string,
  notebookId: string,
  folderId: string | null,
): Promise<{ note: Note; pages: Page[] }> => {
  const { handle } = await openPdf(bytes)
  const backend = await getBackend()

  const assetId = uid()
  await repository.saveAsset({ id: assetId, name: fileName, mime: 'application/pdf', bytes, createdAt: Date.now() })

  const now = Date.now()
  const first = handle.pageSize(1)
  const note: Note = {
    id: uid(),
    notebookId,
    folderId,
    title: fileName.replace(/\.pdf$/i, '') || 'Imported PDF',
    tags: ['pdf'],
    favorite: false,
    archived: false,
    paper: {
      size: 'pdf',
      width: Math.round(pointsToPx(first.width)),
      height: Math.round(pointsToPx(first.height)),
      background: '#ffffff',
      template: 'blank',
      spacing: 36,
    },
    sort: 0,
    pdfAssetId: assetId,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
  await backend.saveNote(note)

  const pages: Page[] = []
  for (let i = 1; i <= handle.pageCount; i++) {
    const size = handle.pageSize(i)
    const page: Page = {
      id: uid(),
      noteId: note.id,
      index: i - 1,
      // Preserve per-page geometry — PDFs may mix page sizes.
      paper: {
        size: 'pdf',
        width: Math.round(pointsToPx(size.width)),
        height: Math.round(pointsToPx(size.height)),
        background: '#ffffff',
        template: 'blank',
        spacing: 36,
      },
      pdfPage: i,
      createdAt: now,
    }
    await backend.savePage(page)
    pages.push(page)
  }

  return { note, pages }
}

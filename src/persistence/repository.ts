import type { Asset, Folder, InkStroke, Note, Notebook, Page, PaperSpec, PaperSize, PageTemplate } from '../types'
import { DEFAULT_SETTINGS, PAPER_SIZES, uid } from '../types'
import { getBackend } from './adapter'
import { encodeStrokes, decodeStrokes, bytesToBase64, base64ToBytes } from './codec'
import type { BackupData } from './backend'

/**
 * Repository — high-level, domain-oriented data access on top of the
 * runtime-selected backend. All crash-sensitive writes go through here.
 */

export interface WorkspaceSnapshot {
  notebooks: Notebook[]
  folders: Folder[]
  notes: Note[]
  pages: Page[]
}

const paperDims = (size: Exclude<PaperSize, 'infinite'>): { size: PaperSize; width: number; height: number } => {
  const { width, height } = PAPER_SIZES[size]
  return { size, width, height }
}

export const defaultPaper = (partial?: Partial<PaperSpec>): PaperSpec => ({
  ...paperDims(DEFAULT_SETTINGS.defaultPaperSize as Exclude<PaperSize, 'infinite'>),
  background: '#fdfbf7',
  template: DEFAULT_SETTINGS.defaultTemplate as PageTemplate,
  spacing: DEFAULT_SETTINGS.defaultSpacing,
  ...partial,
})

class Repository {
  async init(): Promise<void> {
    const backend = await getBackend()
    await backend.recoverJournal()
  }

  /* -------------------------------------------------------- workspace */

  async loadWorkspace(): Promise<WorkspaceSnapshot> {
    const backend = await getBackend()
    const [notebooks, folders, notes, pages] = await Promise.all([
      backend.listNotebooks(),
      backend.listFolders(),
      backend.listNotes(),
      backend.listPages(),
    ])
    return { notebooks, folders, notes, pages }
  }

  /* -------------------------------------------------------- notebooks */

  async createNotebook(name: string, color = '#7c6cf6'): Promise<Notebook> {
    const backend = await getBackend()
    const now = Date.now()
    const existing = await backend.listNotebooks()
    const nb: Notebook = {
      id: uid(),
      name: name.trim() || 'Untitled notebook',
      color,
      icon: 'notebook',
      archived: false,
      sort: existing.length,
      createdAt: now,
      updatedAt: now,
    }
    await backend.saveNotebook(nb)
    return nb
  }

  async renameNotebook(id: string, name: string): Promise<void> {
    const backend = await getBackend()
    const all = await backend.listNotebooks()
    const target = all.find((n) => n.id === id)
    if (!target) return
    await backend.saveNotebook({ ...target, name: name.trim() || target.name, updatedAt: Date.now() })
  }

  async deleteNotebook(id: string): Promise<void> {
    const backend = await getBackend()
    await backend.deleteNotebook(id)
  }

  /* ---------------------------------------------------------- folders */

  async createFolder(notebookId: string, name: string, parentId: string | null = null): Promise<Folder> {
    const backend = await getBackend()
    const existing = await backend.listFolders()
    const folder: Folder = {
      id: uid(),
      notebookId,
      parentId,
      name: name.trim() || 'New folder',
      sort: existing.filter((f) => f.notebookId === notebookId).length,
      createdAt: Date.now(),
    }
    await backend.saveFolder(folder)
    return folder
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const backend = await getBackend()
    const all = await backend.listFolders()
    const target = all.find((f) => f.id === id)
    if (!target) return
    await backend.saveFolder({ ...target, name: name.trim() || target.name })
  }

  async deleteFolder(id: string): Promise<void> {
    const backend = await getBackend()
    await backend.deleteFolder(id)
  }

  /* ------------------------------------------------------------ notes */

  async createNote(notebookId: string, folderId: string | null, title = 'Untitled note', paper?: PaperSpec): Promise<{ note: Note; page: Page }> {
    const backend = await getBackend()
    const now = Date.now()
    const notes = await backend.listNotes()
    const note: Note = {
      id: uid(),
      notebookId,
      folderId,
      title,
      tags: [],
      favorite: false,
      archived: false,
      paper: paper ?? defaultPaper(),
      sort: notes.filter((n) => n.notebookId === notebookId).length,
      pdfAssetId: null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    }
    const page: Page = {
      id: uid(),
      noteId: note.id,
      index: 0,
      paper: null,
      pdfPage: null,
      createdAt: now,
    }
    await backend.saveNote(note)
    await backend.savePage(page)
    return { note, page }
  }

  async updateNote(note: Note): Promise<void> {
    const backend = await getBackend()
    await backend.saveNote({ ...note, updatedAt: Date.now() })
  }

  /** Bump only lastOpenedAt (no updatedAt) — opening a note must not invalidate editor state. */
  async touchNoteLastOpened(noteId: string): Promise<Note | null> {
    const backend = await getBackend()
    const notes = await backend.listNotes()
    const target = notes.find((n) => n.id === noteId)
    if (!target) return null
    const updated = { ...target, lastOpenedAt: Date.now() }
    await backend.saveNote(updated)
    return updated
  }

  async deleteNote(id: string): Promise<void> {
    const backend = await getBackend()
    await backend.deleteNote(id)
  }

  async duplicateNote(noteId: string): Promise<{ note: Note; pages: Page[] } | null> {
    const backend = await getBackend()
    const [notes, pages] = await Promise.all([backend.listNotes(), backend.listPages()])
    const source = notes.find((n) => n.id === noteId)
    if (!source) return null
    const now = Date.now()
    const clone: Note = {
      ...source,
      id: uid(),
      title: `${source.title} copy`,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    }
    await backend.saveNote(clone)
    const newPages: Page[] = []
    for (const page of pages.filter((p) => p.noteId === noteId).sort((a, b) => a.index - b.index)) {
      const copy: Page = { ...page, id: uid(), noteId: clone.id, createdAt: now }
      await backend.savePage(copy)
      // Remap stroke pageIds so the copy is fully self-contained.
      const payload = await backend.loadStrokePayload(page.id)
      if (payload) {
        const strokes = decodeStrokes(payload).map((s) => ({ ...s, id: uid(), pageId: copy.id }))
        await backend.saveStrokePayload(copy.id, encodeStrokes(strokes))
      }
      newPages.push(copy)
    }
    return { note: clone, pages: newPages }
  }

  async toggleFavorite(noteId: string, notes: Note[]): Promise<Note | null> {
    const target = notes.find((n) => n.id === noteId)
    if (!target) return null
    const updated = { ...target, favorite: !target.favorite, updatedAt: Date.now() }
    const backend = await getBackend()
    await backend.saveNote(updated)
    return updated
  }

  /* ------------------------------------------------------------ pages */

  async addPage(noteId: string): Promise<Page> {
    const backend = await getBackend()
    const pages = await backend.listPages()
    const notePages = pages.filter((p) => p.noteId === noteId)
    const page: Page = {
      id: uid(),
      noteId,
      index: notePages.length,
      paper: null,
      pdfPage: null,
      createdAt: Date.now(),
    }
    await backend.savePage(page)
    return page
  }

  async removePage(pageId: string, noteId: string): Promise<void> {
    const backend = await getBackend()
    const pages = await backend.listPages()
    const siblings = pages.filter((p) => p.noteId === noteId).sort((a, b) => a.index - b.index)
    if (siblings.length <= 1) return // a note always keeps at least one page
    await backend.deletePage(pageId)
    const remaining = siblings.filter((p) => p.id !== pageId)
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].index !== i) await backend.savePage({ ...remaining[i], index: i })
    }
  }

  async reorderPages(_noteId: string, orderedIds: string[]): Promise<void> {
    const backend = await getBackend()
    const pages = await backend.listPages()
    const byId = new Map(pages.map((p) => [p.id, p]))
    for (let i = 0; i < orderedIds.length; i++) {
      const page = byId.get(orderedIds[i])
      if (page && page.index !== i) await backend.savePage({ ...page, index: i })
    }
  }

  /* ----------------------------------------------------------- strokes */

  async loadStrokes(pageId: string): Promise<InkStroke[]> {
    const backend = await getBackend()
    const payload = await backend.loadStrokePayload(pageId)
    if (!payload) return []
    try {
      return decodeStrokes(payload)
    } catch (err) {
      console.error('Failed to decode stroke payload for page', pageId, err)
      return []
    }
  }

  async saveStrokes(pageId: string, strokes: InkStroke[]): Promise<void> {
    const backend = await getBackend()
    const payload = encodeStrokes(strokes)
    await backend.saveStrokePayload(pageId, payload)
  }

  /* ------------------------------------------------------------ assets */

  async saveAsset(asset: Asset): Promise<void> {
    const backend = await getBackend()
    await backend.saveAsset(asset)
  }

  async getAsset(id: string | null): Promise<Asset | null> {
    if (!id) return null
    const backend = await getBackend()
    return backend.getAsset(id)
  }

  /* ------------------------------------------------------------ backup */

  async exportBackup(): Promise<BackupData> {
    const backend = await getBackend()
    const [notebooks, folders, notes, pages] = await Promise.all([
      backend.listNotebooks(),
      backend.listFolders(),
      backend.listNotes(),
      backend.listPages(),
    ])
    const strokePayloads: Record<string, string> = {}
    for (const page of pages) {
      const payload = await backend.loadStrokePayload(page.id)
      if (payload) strokePayloads[page.id] = bytesToBase64(payload)
    }
    const assets = await backend.listAssets()
    const settings = await backend.allSettings()
    return {
      format: 'inkflow-backup',
      version: 1,
      exportedAt: Date.now(),
      notebooks,
      folders,
      notes,
      pages,
      strokePayloads,
      assets: assets.map((a) => ({
        id: a.id,
        name: a.name,
        mime: a.mime,
        bytesB64: bytesToBase64(a.bytes),
        createdAt: a.createdAt,
      })),
      settings,
    }
  }

  /** Restores a backup with fresh ids so existing data is never clobbered. */
  async restoreBackup(backup: BackupData): Promise<void> {
    if (backup.format !== 'inkflow-backup' || backup.version !== 1) {
      throw new Error('Unsupported backup format')
    }
    const backend = await getBackend()

    const notebookMap = new Map<string, string>()
    const folderMap = new Map<string, string>()
    const noteMap = new Map<string, string>()
    const pageMap = new Map<string, string>()
    const assetMap = new Map<string, string>()

    const notebooks = backup.notebooks.map((n) => {
      const id = uid()
      notebookMap.set(n.id, id)
      return { ...n, id, name: n.name }
    })
    const folders = backup.folders.map((f) => {
      const id = uid()
      folderMap.set(f.id, id)
      return { ...f, id, notebookId: notebookMap.get(f.notebookId) ?? f.notebookId, parentId: f.parentId ? (folderMap.get(f.parentId) ?? null) : null }
    })
    const notes = backup.notes.map((n) => {
      const id = uid()
      noteMap.set(n.id, id)
      return {
        ...n,
        id,
        notebookId: notebookMap.get(n.notebookId) ?? n.notebookId,
        folderId: n.folderId ? (folderMap.get(n.folderId) ?? null) : null,
        pdfAssetId: n.pdfAssetId ? (assetMap.get(n.pdfAssetId) ?? null) : null,
      }
    })
    // Assets restore first so pdfAssetId mapping can be resolved in a second pass.
    const assets: Asset[] = backup.assets.map((a) => {
      const id = uid()
      assetMap.set(a.id, id)
      return { id, name: a.name, mime: a.mime, bytes: base64ToBytes(a.bytesB64), createdAt: a.createdAt }
    })
    const notesFixed = notes.map((n) => ({ ...n, pdfAssetId: n.pdfAssetId && assetMap.has(n.pdfAssetId) ? assetMap.get(n.pdfAssetId)! : n.pdfAssetId }))

    const pages = backup.pages.map((p) => {
      const id = uid()
      pageMap.set(p.id, id)
      return { ...p, id, noteId: noteMap.get(p.noteId) ?? p.noteId }
    })

    const strokePayloads: Record<string, Uint8Array> = {}
    for (const [oldPageId, b64] of Object.entries(backup.strokePayloads)) {
      const newPageId = pageMap.get(oldPageId)
      if (!newPageId) continue
      const strokes = decodeStrokes(base64ToBytes(b64)).map((s) => ({ ...s, id: uid(), pageId: newPageId }))
      strokePayloads[newPageId] = encodeStrokes(strokes)
    }

    await backend.bulkInsert({ notebooks, folders, notes: notesFixed, pages, strokePayloads, assets, settings: backup.settings })
  }
}

export const repository = new Repository()

/* ------------------------------------------------------------------ misc */

export const searchNotes = (notes: Note[], query: string): Note[] => {
  const q = query.trim().toLowerCase()
  if (!q) return notes
  return notes.filter((n) =>
    n.title.toLowerCase().includes(q) ||
    n.tags.some((t) => t.toLowerCase().includes(q)),
  )
}

export const allTags = (notes: Note[]): { tag: string; count: number }[] => {
  const counts = new Map<string, number>()
  for (const note of notes) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

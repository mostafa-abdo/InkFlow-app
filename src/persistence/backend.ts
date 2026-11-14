import type { Asset, Folder, Note, Notebook, Page } from '../types'

/**
 * Persistence backend contract. Two implementations exist:
 *  - TauriSqliteBackend (desktop, via @tauri-apps/plugin-sql)
 *  - IndexedDbBackend   (browser / dev, via IndexedDB)
 *
 * Both honor the same semantics, including ACID writes and the
 * write-ahead journal used for crash recovery of stroke pages.
 */
export interface BackupData {
  format: 'inkflow-backup'
  version: 1
  exportedAt: number
  notebooks: Notebook[]
  folders: Folder[]
  notes: Note[]
  pages: Page[]
  /** pageId → gzipped stroke payload, base64 */
  strokePayloads: Record<string, string>
  /** assets with base64 bytes */
  assets: { id: string; name: string; mime: string; bytesB64: string; createdAt: number }[]
  settings: Record<string, string>
}

export interface Backend {
  readonly kind: 'sqlite' | 'indexeddb'
  init(): Promise<void>

  /* notebooks */
  listNotebooks(): Promise<Notebook[]>
  saveNotebook(nb: Notebook): Promise<void>
  deleteNotebook(id: string): Promise<void>

  /* folders */
  listFolders(): Promise<Folder[]>
  saveFolder(folder: Folder): Promise<void>
  deleteFolder(id: string): Promise<void>

  /* notes */
  listNotes(): Promise<Note[]>
  saveNote(note: Note): Promise<void>
  deleteNote(id: string): Promise<void>

  /* pages */
  listPages(): Promise<Page[]>
  savePage(page: Page): Promise<void>
  deletePage(id: string): Promise<void>

  /* strokes (crash-safe) */
  loadStrokePayload(pageId: string): Promise<Uint8Array | null>
  saveStrokePayload(pageId: string, payload: Uint8Array): Promise<void>
  /** Re-apply any interrupted writes. Called once at startup. Returns recovered pageIds. */
  recoverJournal(): Promise<string[]>

  /* assets */
  saveAsset(asset: Asset): Promise<void>
  getAsset(id: string): Promise<Asset | null>
  deleteAsset(id: string): Promise<void>
  listAssets(): Promise<Asset[]>

  /* settings k/v */
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  allSettings(): Promise<Record<string, string>>

  /** Atomic bulk insert used by backup restore. All or nothing. */
  bulkInsert(data: {
    notebooks: Notebook[]
    folders: Folder[]
    notes: Note[]
    pages: Page[]
    /** pageId → gzipped stroke payload */
    strokePayloads: Record<string, Uint8Array>
    assets: Asset[]
    settings: Record<string, string>
  }): Promise<void>
}

import type { Asset, Folder, Note, Notebook, Page } from '../types'
import type { Backend, BackupData } from './backend'

/**
 * IndexedDB implementation of the InkFlow persistence backend.
 * Used automatically when the app runs outside Tauri (browser dev/preview),
 * and as a dependable reference for the SQLite implementation.
 *
 * Multi-store writes run inside a single IDB transaction, which makes them
 * atomic — a crash mid-save leaves either the old or the new state, never
 * a torn page. `recoverJournal` replays interrupted stroke saves.
 */

const DB_NAME = 'inkflow'
const DB_VERSION = 1
const STORES = [
  'notebooks',
  'folders',
  'notes',
  'pages',
  'page_strokes',
  'journal',
  'assets',
  'settings',
] as const
type StoreName = (typeof STORES)[number]

const requestToPromise = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

export class IndexedDbBackend implements Backend {
  readonly kind = 'indexeddb' as const
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('folders')) {
          const s = db.createObjectStore('folders', { keyPath: 'id' })
          s.createIndex('notebookId', 'notebookId', { unique: false })
        }
        if (!db.objectStoreNames.contains('notes')) {
          const s = db.createObjectStore('notes', { keyPath: 'id' })
          s.createIndex('notebookId', 'notebookId', { unique: false })
          s.createIndex('folderId', 'folderId', { unique: false })
        }
        if (!db.objectStoreNames.contains('pages')) {
          const s = db.createObjectStore('pages', { keyPath: 'id' })
          s.createIndex('noteId', 'noteId', { unique: false })
        }
        if (!db.objectStoreNames.contains('page_strokes')) db.createObjectStore('page_strokes', { keyPath: 'pageId' })
        if (!db.objectStoreNames.contains('journal')) db.createObjectStore('journal', { keyPath: 'pageId' })
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
    })
  }

  private store(name: StoreName, mode: IDBTransactionMode, tx?: IDBTransaction): { store: IDBObjectStore; tx: IDBTransaction } {
    const target = tx ?? this.db!.transaction(name, mode)
    return { store: target.objectStore(name), tx: target }
  }

  private async getAll<T>(name: StoreName): Promise<T[]> {
    const { tx, store } = this.store(name, 'readonly')
    const result = await requestToPromise(store.getAll() as IDBRequest<T[]>)
    await txDone(tx)
    return result
  }

  private async putAll(name: StoreName, records: unknown[], tx: IDBTransaction): Promise<void> {
    const store = tx.objectStore(name)
    for (const record of records) store.put(record)
  }

  /* ---------------------------------------------------------- notebooks */

  listNotebooks = (): Promise<Notebook[]> => this.getAll<Notebook>('notebooks')

  async saveNotebook(nb: Notebook): Promise<void> {
    const tx = this.db!.transaction('notebooks', 'readwrite')
    tx.objectStore('notebooks').put(nb)
    await txDone(tx)
  }

  async deleteNotebook(id: string): Promise<void> {
    // Cascade: folders, notes, pages, strokes, journal of this notebook.
    const folders = await this.getAll<Folder>('folders')
    const notes = await this.getAll<Note>('notes')
    const pages = await this.getAll<Page>('pages')
    const folderIds = new Set(folders.filter((f) => f.notebookId === id).map((f) => f.id))
    const noteIds = new Set(notes.filter((n) => n.notebookId === id).map((n) => n.id))
    const pageIds = pages.filter((p) => noteIds.has(p.noteId)).map((p) => p.id)

    const tx = this.db!.transaction(['notebooks', 'folders', 'notes', 'pages', 'page_strokes', 'journal'], 'readwrite')
    tx.objectStore('notebooks').delete(id)
    for (const fid of folderIds) tx.objectStore('folders').delete(fid)
    for (const nid of noteIds) tx.objectStore('notes').delete(nid)
    for (const p of pages) if (noteIds.has(p.noteId)) tx.objectStore('pages').delete(p.id)
    for (const pid of pageIds) {
      tx.objectStore('page_strokes').delete(pid)
      tx.objectStore('journal').delete(pid)
    }
    await txDone(tx)
  }

  /* ------------------------------------------------------------ folders */

  listFolders = (): Promise<Folder[]> => this.getAll<Folder>('folders')

  async saveFolder(folder: Folder): Promise<void> {
    const tx = this.db!.transaction('folders', 'readwrite')
    tx.objectStore('folders').put(folder)
    await txDone(tx)
  }

  async deleteFolder(id: string): Promise<void> {
    const notes = await this.getAll<Note>('notes')
    const tx = this.db!.transaction(['folders', 'notes'], 'readwrite')
    tx.objectStore('folders').delete(id)
    // Orphaned notes float up to the notebook root instead of being deleted.
    for (const note of notes) {
      if (note.folderId === id) tx.objectStore('notes').put({ ...note, folderId: null })
    }
    await txDone(tx)
  }

  /* -------------------------------------------------------------- notes */

  listNotes = (): Promise<Note[]> => this.getAll<Note>('notes')

  async saveNote(note: Note): Promise<void> {
    const tx = this.db!.transaction('notes', 'readwrite')
    tx.objectStore('notes').put(note)
    await txDone(tx)
  }

  async deleteNote(id: string): Promise<void> {
    const pages = await this.getAll<Page>('pages')
    const pageIds = pages.filter((p) => p.noteId === id).map((p) => p.id)
    const tx = this.db!.transaction(['notes', 'pages', 'page_strokes', 'journal'], 'readwrite')
    tx.objectStore('notes').delete(id)
    for (const p of pages) if (p.noteId === id) tx.objectStore('pages').delete(p.id)
    for (const pid of pageIds) {
      tx.objectStore('page_strokes').delete(pid)
      tx.objectStore('journal').delete(pid)
    }
    await txDone(tx)
  }

  /* -------------------------------------------------------------- pages */

  listPages = (): Promise<Page[]> => this.getAll<Page>('pages')

  async savePage(page: Page): Promise<void> {
    const tx = this.db!.transaction('pages', 'readwrite')
    tx.objectStore('pages').put(page)
    await txDone(tx)
  }

  async deletePage(id: string): Promise<void> {
    const tx = this.db!.transaction(['pages', 'page_strokes', 'journal'], 'readwrite')
    tx.objectStore('pages').delete(id)
    tx.objectStore('page_strokes').delete(id)
    tx.objectStore('journal').delete(id)
    await txDone(tx)
  }

  /* -------------------------------------------- strokes (crash-safe) */

  async loadStrokePayload(pageId: string): Promise<Uint8Array | null> {
    const { tx, store } = this.store('page_strokes', 'readonly')
    const row = await requestToPromise(store.get(pageId) as IDBRequest<{ pageId: string; payload: Uint8Array } | undefined>)
    await txDone(tx)
    return row ? new Uint8Array(row.payload) : null
  }

  async saveStrokePayload(pageId: string, payload: Uint8Array): Promise<void> {
    // 1) Write-ahead journal (intent). 2) Atomic commit. 3) Journal cleared inside the commit.
    const journalTx = this.db!.transaction('journal', 'readwrite')
    journalTx.objectStore('journal').put({ pageId, payload, updatedAt: Date.now() })
    await txDone(journalTx)

    const tx = this.db!.transaction(['page_strokes', 'journal'], 'readwrite')
    tx.objectStore('page_strokes').put({ pageId, payload, updatedAt: Date.now() })
    tx.objectStore('journal').delete(pageId)
    await txDone(tx)
  }

  async recoverJournal(): Promise<string[]> {
    const { tx, store } = this.store('journal', 'readonly')
    const pending = await requestToPromise(store.getAll() as IDBRequest<{ pageId: string; payload: Uint8Array }[]>)
    await txDone(tx)
    if (pending.length === 0) return []

    const recovered: string[] = []
    for (const entry of pending) {
      const commitTx = this.db!.transaction(['page_strokes', 'journal'], 'readwrite')
      commitTx.objectStore('page_strokes').put({ pageId: entry.pageId, payload: entry.payload, updatedAt: Date.now() })
      commitTx.objectStore('journal').delete(entry.pageId)
      await txDone(commitTx)
      recovered.push(entry.pageId)
    }
    return recovered
  }

  /* ------------------------------------------------------------- assets */

  async saveAsset(asset: Asset): Promise<void> {
    const tx = this.db!.transaction('assets', 'readwrite')
    tx.objectStore('assets').put(asset)
    await txDone(tx)
  }

  async getAsset(id: string): Promise<Asset | null> {
    const { tx, store } = this.store('assets', 'readonly')
    const row = await requestToPromise(store.get(id) as IDBRequest<Asset | undefined>)
    await txDone(tx)
    return row ?? null
  }

  async deleteAsset(id: string): Promise<void> {
    const tx = this.db!.transaction('assets', 'readwrite')
    tx.objectStore('assets').delete(id)
    await txDone(tx)
  }

  listAssets = (): Promise<Asset[]> => this.getAll<Asset>('assets')

  /* ----------------------------------------------------------- settings */

  async getSetting(key: string): Promise<string | null> {
    const { tx, store } = this.store('settings', 'readonly')
    const row = await requestToPromise(store.get(key) as IDBRequest<{ key: string; value: string } | undefined>)
    await txDone(tx)
    return row?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    const tx = this.db!.transaction('settings', 'readwrite')
    tx.objectStore('settings').put({ key, value })
    await txDone(tx)
  }

  async allSettings(): Promise<Record<string, string>> {
    const rows = await this.getAll<{ key: string; value: string }>('settings')
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  /* ------------------------------------------------------------- backup */

  async bulkInsert(data: Parameters<Backend['bulkInsert']>[0]): Promise<void> {
    const tx = this.db!.transaction([...STORES], 'readwrite')
    this.putAll('notebooks', data.notebooks, tx)
    this.putAll('folders', data.folders, tx)
    this.putAll('notes', data.notes, tx)
    this.putAll('pages', data.pages, tx)
    this.putAll('page_strokes', Object.entries(data.strokePayloads).map(([pageId, payload]) => ({ pageId, payload, updatedAt: Date.now() })), tx)
    this.putAll('assets', data.assets, tx)
    this.putAll('settings', Object.entries(data.settings).map(([key, value]) => ({ key, value })), tx)
    await txDone(tx)
  }
}

export const createIndexedDbBackend = (): IndexedDbBackend => new IndexedDbBackend()

export type { BackupData }

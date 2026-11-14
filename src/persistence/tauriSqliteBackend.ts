import type { Asset, Folder, Note, Notebook, Page } from '../types'
import type { Backend, BackupData } from './backend'
import { SCHEMA_SQL } from './schema'
import { bytesToBase64, base64ToBytes } from './codec'

/**
 * SQLite implementation backed by @tauri-apps/plugin-sql.
 * Enabled automatically when running inside Tauri (see adapter.ts).
 *
 * Binary payloads (gzipped stroke pages, asset bytes) are stored as base64
 * TEXT columns — portable across the plugin's parameter binding and tiny
 * enough thanks to compression.
 */

interface SqlDb {
  execute(query: string, bindValues?: unknown[]): Promise<[number, number]>
  select<T>(query: string, bindValues?: unknown[]): Promise<T>
}

const bool = (v: unknown): boolean => Number(v) === 1

export class TauriSqliteBackend implements Backend {
  readonly kind = 'sqlite' as const
  private db: SqlDb | null = null

  async init(): Promise<void> {
    const mod = await import('@tauri-apps/plugin-sql')
    const Database = mod.default
    this.db = (await Database.load('sqlite:inkflow.db')) as unknown as SqlDb
    // Apply schema idempotently on every launch.
    for (const statement of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.db.execute(statement)
    }
    // Enforce foreign keys for cascade-like behavior handled in code.
    await this.db.execute('PRAGMA foreign_keys = ON')
  }

  private sql(): SqlDb {
    if (!this.db) throw new Error('Backend not initialised — call init() first')
    return this.db
  }

  private async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.sql()
    await db.execute('BEGIN')
    try {
      const result = await fn()
      await db.execute('COMMIT')
      return result
    } catch (err) {
      await db.execute('ROLLBACK').catch(() => undefined)
      throw err
    }
  }

  /* ------------------------------------------------------- row mappings */

  private noteFromRow(r: any): Note {
    return {
      id: r.id,
      notebookId: r.notebook_id,
      folderId: r.folder_id ?? null,
      title: r.title,
      tags: JSON.parse(r.tags ?? '[]'),
      favorite: bool(r.favorite),
      archived: bool(r.archived),
      paper: typeof r.paper === 'string' ? JSON.parse(r.paper) : r.paper,
      sort: r.sort,
      pdfAssetId: r.pdf_asset_id ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastOpenedAt: r.last_opened_at,
    }
  }

  private pageFromRow(r: any): Page {
    return {
      id: r.id,
      noteId: r.note_id,
      index: r.page_index,
      paper: r.paper ? (typeof r.paper === 'string' ? JSON.parse(r.paper) : r.paper) : null,
      pdfPage: r.pdf_page ?? null,
      createdAt: r.created_at,
    }
  }

  /* ---------------------------------------------------------- notebooks */

  async listNotebooks(): Promise<Notebook[]> {
    const rows = await this.sql().select<any[]>('SELECT * FROM notebooks ORDER BY sort ASC, created_at ASC')
    return rows.map((r) => ({
      id: r.id, name: r.name, color: r.color, icon: r.icon,
      archived: bool(r.archived), sort: r.sort, createdAt: r.created_at, updatedAt: r.updated_at,
    }))
  }

  async saveNotebook(nb: Notebook): Promise<void> {
    await this.sql().execute(
      `INSERT INTO notebooks (id, name, color, icon, archived, sort, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, color=excluded.color, icon=excluded.icon,
         archived=excluded.archived, sort=excluded.sort, updated_at=excluded.updated_at`,
      [nb.id, nb.name, nb.color, nb.icon, nb.archived ? 1 : 0, nb.sort, nb.createdAt, nb.updatedAt],
    )
  }

  async deleteNotebook(id: string): Promise<void> {
    await this.withTransaction(async () => {
      const pageRows = await this.sql().select<{ id: string }[]>(
        'SELECT p.id FROM pages p JOIN notes n ON n.id = p.note_id WHERE n.notebook_id = ?1', [id])
      for (const { id: pid } of pageRows) {
        await this.sql().execute('DELETE FROM page_strokes WHERE page_id = ?1', [pid])
        await this.sql().execute('DELETE FROM journal WHERE page_id = ?1', [pid])
        await this.sql().execute('DELETE FROM pages WHERE id = ?1', [pid])
      }
      await this.sql().execute(
        'DELETE FROM pages WHERE note_id IN (SELECT id FROM notes WHERE notebook_id = ?1)', [id])
      await this.sql().execute('DELETE FROM notes WHERE notebook_id = ?1', [id])
      await this.sql().execute('DELETE FROM folders WHERE notebook_id = ?1', [id])
      await this.sql().execute('DELETE FROM notebooks WHERE id = ?1', [id])
    })
  }

  /* ------------------------------------------------------------ folders */

  async listFolders(): Promise<Folder[]> {
    const rows = await this.sql().select<any[]>('SELECT * FROM folders ORDER BY sort ASC, created_at ASC')
    return rows.map((r) => ({
      id: r.id, notebookId: r.notebook_id, parentId: r.parent_id ?? null,
      name: r.name, sort: r.sort, createdAt: r.created_at,
    }))
  }

  async saveFolder(folder: Folder): Promise<void> {
    await this.sql().execute(
      `INSERT INTO folders (id, notebook_id, parent_id, name, sort, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET notebook_id=excluded.notebook_id, parent_id=excluded.parent_id,
         name=excluded.name, sort=excluded.sort`,
      [folder.id, folder.notebookId, folder.parentId, folder.name, folder.sort, folder.createdAt],
    )
  }

  async deleteFolder(id: string): Promise<void> {
    await this.withTransaction(async () => {
      // Notes inside the folder float up to the notebook root.
      await this.sql().execute('UPDATE notes SET folder_id = NULL WHERE folder_id = ?1', [id])
      await this.sql().execute('DELETE FROM folders WHERE id = ?1', [id])
    })
  }

  /* -------------------------------------------------------------- notes */

  async listNotes(): Promise<Note[]> {
    const rows = await this.sql().select<any[]>('SELECT * FROM notes')
    return rows.map((r) => this.noteFromRow(r))
  }

  async saveNote(note: Note): Promise<void> {
    await this.sql().execute(
      `INSERT INTO notes (id, notebook_id, folder_id, title, tags, favorite, archived, paper, sort,
                          pdf_asset_id, created_at, updated_at, last_opened_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(id) DO UPDATE SET
         notebook_id=excluded.notebook_id, folder_id=excluded.folder_id, title=excluded.title,
         tags=excluded.tags, favorite=excluded.favorite, archived=excluded.archived,
         paper=excluded.paper, sort=excluded.sort, pdf_asset_id=excluded.pdf_asset_id,
         updated_at=excluded.updated_at, last_opened_at=excluded.last_opened_at`,
      [note.id, note.notebookId, note.folderId, note.title, JSON.stringify(note.tags),
       note.favorite ? 1 : 0, note.archived ? 1 : 0, JSON.stringify(note.paper), note.sort,
       note.pdfAssetId, note.createdAt, note.updatedAt, note.lastOpenedAt],
    )
  }

  async deleteNote(id: string): Promise<void> {
    await this.withTransaction(async () => {
      const pageRows = await this.sql().select<{ id: string }[]>('SELECT id FROM pages WHERE note_id = ?1', [id])
      for (const { id: pid } of pageRows) {
        await this.sql().execute('DELETE FROM page_strokes WHERE page_id = ?1', [pid])
        await this.sql().execute('DELETE FROM journal WHERE page_id = ?1', [pid])
      }
      await this.sql().execute('DELETE FROM pages WHERE note_id = ?1', [id])
      await this.sql().execute('DELETE FROM notes WHERE id = ?1', [id])
    })
  }

  /* -------------------------------------------------------------- pages */

  async listPages(): Promise<Page[]> {
    const rows = await this.sql().select<any[]>('SELECT * FROM pages ORDER BY page_index ASC')
    return rows.map((r) => this.pageFromRow(r))
  }

  async savePage(page: Page): Promise<void> {
    await this.sql().execute(
      `INSERT INTO pages (id, note_id, page_index, paper, pdf_page, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET
         note_id=excluded.note_id, page_index=excluded.page_index, paper=excluded.paper, pdf_page=excluded.pdf_page`,
      [page.id, page.noteId, page.index, page.paper ? JSON.stringify(page.paper) : null, page.pdfPage, page.createdAt],
    )
  }

  async deletePage(id: string): Promise<void> {
    await this.withTransaction(async () => {
      await this.sql().execute('DELETE FROM page_strokes WHERE page_id = ?1', [id])
      await this.sql().execute('DELETE FROM journal WHERE page_id = ?1', [id])
      await this.sql().execute('DELETE FROM pages WHERE id = ?1', [id])
    })
  }

  /* -------------------------------------------- strokes (crash-safe) */

  async loadStrokePayload(pageId: string): Promise<Uint8Array | null> {
    const rows = await this.sql().select<{ payload: string }[]>('SELECT payload FROM page_strokes WHERE page_id = ?1', [pageId])
    if (rows.length === 0) return null
    return base64ToBytes(rows[0].payload)
  }

  async saveStrokePayload(pageId: string, payload: Uint8Array): Promise<void> {
    const b64 = bytesToBase64(payload)
    const now = Date.now()
    // 1) WAL-style intent record
    await this.sql().execute(
      'INSERT INTO journal (page_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(page_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
      [pageId, b64, now])
    // 2) Atomic commit of the page payload + journal clear
    await this.withTransaction(async () => {
      await this.sql().execute(
        'INSERT INTO page_strokes (page_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(page_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
        [pageId, b64, now])
      await this.sql().execute('DELETE FROM journal WHERE page_id = ?1', [pageId])
    })
  }

  async recoverJournal(): Promise<string[]> {
    const rows = await this.sql().select<{ page_id: string; payload: string }[]>('SELECT page_id, payload FROM journal')
    const recovered: string[] = []
    for (const row of rows) {
      await this.withTransaction(async () => {
        await this.sql().execute(
          'INSERT INTO page_strokes (page_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(page_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
          [row.page_id, row.payload, Date.now()])
        await this.sql().execute('DELETE FROM journal WHERE page_id = ?1', [row.page_id])
      })
      recovered.push(row.page_id)
    }
    return recovered
  }

  /* ------------------------------------------------------------- assets */

  async saveAsset(asset: Asset): Promise<void> {
    await this.sql().execute(
      `INSERT INTO assets (id, name, mime, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, mime=excluded.mime, bytes=excluded.bytes`,
      [asset.id, asset.name, asset.mime, bytesToBase64(asset.bytes), asset.createdAt],
    )
  }

  async getAsset(id: string): Promise<Asset | null> {
    const rows = await this.sql().select<any[]>('SELECT * FROM assets WHERE id = ?1', [id])
    if (rows.length === 0) return null
    const r = rows[0]
    return { id: r.id, name: r.name, mime: r.mime, bytes: base64ToBytes(r.bytes), createdAt: r.created_at }
  }

  async deleteAsset(id: string): Promise<void> {
    await this.sql().execute('DELETE FROM assets WHERE id = ?1', [id])
  }

  async listAssets(): Promise<Asset[]> {
    const rows = await this.sql().select<any[]>('SELECT * FROM assets')
    return rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, bytes: base64ToBytes(r.bytes), createdAt: r.created_at }))
  }

  /* ----------------------------------------------------------- settings */

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.sql().select<{ value: string }[]>('SELECT value FROM settings WHERE key = ?1', [key])
    return rows[0]?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.sql().execute(
      'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, value],
    )
  }

  async allSettings(): Promise<Record<string, string>> {
    const rows = await this.sql().select<{ key: string; value: string }[]>('SELECT key, value FROM settings')
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  /* ------------------------------------------------------------- backup */

  async bulkInsert(data: Parameters<Backend['bulkInsert']>[0]): Promise<void> {
    await this.withTransaction(async () => {
      for (const nb of data.notebooks) await this.saveNotebook(nb)
      for (const f of data.folders) await this.saveFolder(f)
      for (const n of data.notes) await this.saveNote(n)
      for (const p of data.pages) await this.savePage(p)
      for (const [pageId, payload] of Object.entries(data.strokePayloads)) {
        await this.sql().execute(
          'INSERT INTO page_strokes (page_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(page_id) DO UPDATE SET payload=excluded.payload',
          [pageId, bytesToBase64(payload), Date.now()])
      }
      for (const a of data.assets) await this.saveAsset(a)
      for (const [k, v] of Object.entries(data.settings)) await this.setSetting(k, v)
    })
  }
}

export type { BackupData }

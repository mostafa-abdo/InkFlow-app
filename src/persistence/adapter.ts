import type { Backend } from './backend'
import { IndexedDbBackend } from './indexedDbBackend'
import { TauriSqliteBackend } from './tauriSqliteBackend'

/**
 * Selects the right persistence backend for the current runtime.
 * Inside Tauri → SQLite (via plugin-sql). Otherwise → IndexedDB.
 */

const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

let backend: Backend | null = null

export const getBackend = async (): Promise<Backend> => {
  if (backend) return backend
  backend = isTauri() ? new TauriSqliteBackend() : new IndexedDbBackend()
  await backend.init()
  return backend
}

export const backendKind = (): 'sqlite' | 'indexeddb' | 'unknown' => {
  if (backend) return backend.kind
  return isTauri() ? 'sqlite' : 'indexeddb'
}

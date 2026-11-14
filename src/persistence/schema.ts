/**
 * SQLite schema used by the Tauri backend (via @tauri-apps/plugin-sql).
 * Kept as a plain string so the same DDL can be applied on every launch
 * (IF NOT EXISTS) and documented for review.
 *
 * The IndexedDB backend mirrors this model with object stores.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7c6cf6',
  icon TEXT NOT NULL DEFAULT 'notebook',
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_notebook ON folders(notebook_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  paper TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  pdf_asset_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  paper TEXT,
  pdf_page INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_note ON pages(note_id, page_index);

-- One gzipped payload per page: atomic coarse-grained writes, tiny autosave cost.
CREATE TABLE IF NOT EXISTS page_strokes (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  payload BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Write-ahead journal so a crash mid-save can be replayed on next launch.
CREATE TABLE IF NOT EXISTS journal (
  page_id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

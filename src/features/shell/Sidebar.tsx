import { useMemo, useRef, useState } from 'react'
import {
  Plus, Search, NotebookPen, Folder as FolderIcon, FolderOpen, Star, Archive, Trash2,
  Copy, Tag, ChevronRight, X, PenLine, Undo2,
} from 'lucide-react'
import { useStore } from '../../state/store'
import { allTags } from '../../persistence/repository'
import ContextMenu, { type MenuItem } from '../../components/ContextMenu'
import Modal from '../../components/Modal'
import { NOTEBOOK_COLORS } from '../../state/store'
import type { Note } from '../../types'

// Day-level date labels computed once per session — sufficient for "today / yesterday" grouping.
const SESSION_NOW = Date.now()
const TODAY_STAMP = new Date(SESSION_NOW).toDateString()
const YESTERDAY_STAMP = new Date(SESSION_NOW - 86400000).toDateString()

export default function Sidebar(): React.JSX.Element {
  const notebooks = useStore((s) => s.notebooks)
  const folders = useStore((s) => s.folders)
  const allNotes = useStore((s) => s.notes)
  const currentNotebookId = useStore((s) => s.currentNotebookId)
  const currentFolderId = useStore((s) => s.currentFolderId)
  const currentNoteId = useStore((s) => s.currentNoteId)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const activeTag = useStore((s) => s.activeTag)
  const setActiveTag = useStore((s) => s.setActiveTag)
  const showArchived = useStore((s) => s.showArchived)
  const setShowArchived = useStore((s) => s.setShowArchived)
  const favoritesOnly = useStore((s) => s.favoritesOnly)
  const setFavoritesOnly = useStore((s) => s.setFavoritesOnly)
  const selectNotebook = useStore((s) => s.selectNotebook)
  const selectFolder = useStore((s) => s.selectFolder)
  const openNote = useStore((s) => s.openNote)
  const createNotebook = useStore((s) => s.createNotebook)
  const createFolder = useStore((s) => s.createFolder)
  const deleteNotebook = useStore((s) => s.deleteNotebook)
  const deleteFolder = useStore((s) => s.deleteFolder)
  const createNote = useStore((s) => s.createNote)
  const renameNote = useStore((s) => s.renameNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const duplicateNote = useStore((s) => s.duplicateNote)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const archiveNote = useStore((s) => s.archiveNote)
  const moveNoteToFolder = useStore((s) => s.moveNoteToFolder)
  const flashStatus = useStore((s) => s.flashStatus)
  const visibleNotesFn = useStore((s) => s.visibleNotes)

  const [notebookModal, setNotebookModal] = useState(false)
  const [folderModal, setFolderModal] = useState(false)
  const [moveNoteId, setMoveNoteId] = useState<string | null>(null)
  const [nbName, setNbName] = useState('')
  const [nbColor, setNbColor] = useState(NOTEBOOK_COLORS[0])
  const [folderName, setFolderName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; note: Note } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const visibleNotebooks = notebooks.filter((n) => !n.archived)
  const visibleFolders = folders.filter((f) => f.notebookId === currentNotebookId)
  const notes = visibleNotesFn()
  const tags = useMemo(() => allTags(allNotes.filter((n) => !n.archived)), [allNotes])

  const submitNotebook = async (): Promise<void> => {
    if (!nbName.trim()) return
    await createNotebook(nbName.trim(), nbColor)
    setNotebookModal(false)
    setNbName('')
    flashStatus('Notebook created')
  }

  const submitFolder = async (): Promise<void> => {
    if (!folderName.trim()) return
    await createFolder(folderName.trim())
    setFolderModal(false)
    setFolderName('')
    flashStatus('Folder created')
  }

  const commitRename = async (note: Note): Promise<void> => {
    await renameNote(note.id, renameValue)
    setRenamingId(null)
  }

  const noteMenuItems = (note: Note): MenuItem[] => [
    { label: 'Rename', icon: <PenLine size={14} />, onSelect: () => { setRenamingId(note.id); setRenameValue(note.title) } },
    { label: 'Duplicate', icon: <Copy size={14} />, shortcut: 'Ctrl+D', onSelect: () => { void duplicateNote(note.id); flashStatus('Note duplicated') } },
    { label: note.favorite ? 'Unfavorite' : 'Favorite', icon: <Star size={14} />, shortcut: 'Ctrl+Shift+F', onSelect: () => { void toggleFavorite(note.id) } },
    { label: note.archived ? 'Unarchive' : 'Archive', icon: note.archived ? <Undo2 size={14} /> : <Archive size={14} />, onSelect: () => { void archiveNote(note.id, !note.archived); flashStatus(note.archived ? 'Note restored' : 'Note archived') } },
    { label: 'Move to folder…', icon: <FolderIcon size={14} />, dividerAfter: true, onSelect: () => setMoveNoteId(note.id) },
    { label: 'Delete note', icon: <Trash2 size={14} />, danger: true, onSelect: () => { void deleteNote(note.id); flashStatus('Note deleted') } },
  ]

  const formatDate = (ts: number): string => {
    const d = new Date(ts)
    const stamp = d.toDateString()
    if (stamp === TODAY_STAMP) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (stamp === YESTERDAY_STAMP) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    fontWeight: 700,
  }

  return (
    <aside
      className="flex h-full w-[280px] shrink-0 flex-col border-r"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      aria-label="Sidebar navigation"
    >
      {/* ------------------------------------------------ notebooks */}
      <div className="border-b px-4 pt-4 pb-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-2 flex items-center justify-between">
          <span style={sectionLabel}>Notebooks</span>
          <button className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title="New notebook" aria-label="New notebook" onClick={() => setNotebookModal(true)}>
            <Plus size={14} />
          </button>
        </div>
        <ul className="flex flex-col gap-0.5">
          {visibleNotebooks.map((nb) => {
            const active = nb.id === currentNotebookId
            return (
              <li key={nb.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[5px] text-[13px] transition-colors"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                  onClick={() => selectNotebook(nb.id)}
                  onKeyDown={(e) => e.key === 'Enter' && selectNotebook(nb.id)}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: nb.color }} />
                  <span className="flex-1 truncate text-left">{nb.name}</span>
                  <button
                    className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)] group-hover:block"
                    title="Delete notebook"
                    aria-label={`Delete notebook ${nb.name}`}
                    onClick={(e) => { e.stopPropagation(); void deleteNotebook(nb.id); flashStatus('Notebook deleted (its notes were removed)') }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {/* Folders nested under the active notebook */}
                {active && (
                  <ul className="mt-0.5 flex flex-col gap-0.5 pl-5">
                    {visibleFolders.map((folder) => {
                      const fActive = currentFolderId === folder.id
                      return (
                        <li key={folder.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[4px] text-[12px] transition-colors"
                            style={{ background: fActive ? 'var(--bg-hover)' : 'transparent', color: fActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                            onClick={() => selectFolder(fActive ? null : folder.id)}
                            onKeyDown={(e) => e.key === 'Enter' && selectFolder(fActive ? null : folder.id)}
                          >
                            {fActive ? <FolderOpen size={13} className="shrink-0 text-[var(--accent)]" /> : <FolderIcon size={13} className="shrink-0 text-[var(--text-muted)]" />}
                            <span className="flex-1 truncate text-left">{folder.name}</span>
                            <button
                              className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)] group-hover:block"
                              title="Delete folder"
                              aria-label={`Delete folder ${folder.name}`}
                              onClick={(e) => { e.stopPropagation(); void deleteFolder(folder.id); flashStatus('Folder deleted; notes moved to notebook root') }}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                    <li>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-[4px] text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                        onClick={() => setFolderModal(true)}
                      >
                        <Plus size={11} /> New folder
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            )
          })}
          {visibleNotebooks.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-[var(--text-muted)]">No notebooks yet.</li>
          )}
        </ul>
      </div>

      {/* -------------------------------------------------------- notes */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
          <span style={sectionLabel}>Notes</span>
          <button
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
            onClick={() => void createNote()}
          >
            <Plus size={12} strokeWidth={2.5} /> New note
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes…  (Ctrl+F)"
              className="inkflow-input h-8 w-full pl-8 text-[12px]"
              aria-label="Search notes"
            />
            {searchQuery && (
              <button className="absolute top-1/2 right-2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setSearchQuery('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </div>
          {/* Filter chips */}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide transition-colors"
              style={{ background: !favoritesOnly ? 'var(--accent-soft)' : 'transparent', color: !favoritesOnly ? 'var(--accent)' : 'var(--text-muted)', border: '1px solid var(--border)' }}
              onClick={() => setFavoritesOnly(false)}
            >
              All
            </button>
            <button
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide transition-colors"
              style={{ background: favoritesOnly ? 'var(--accent-soft)' : 'transparent', color: favoritesOnly ? 'var(--accent)' : 'var(--text-muted)', border: '1px solid var(--border)' }}
              onClick={() => setFavoritesOnly(true)}
            >
              <Star size={10} /> Favorites
            </button>
            <button
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide transition-colors"
              style={{ background: showArchived ? 'var(--accent-soft)' : 'transparent', color: showArchived ? 'var(--accent)' : 'var(--text-muted)', border: '1px solid var(--border)' }}
              onClick={() => setShowArchived(!showArchived)}
            >
              <Archive size={10} /> Archived
            </button>
            {activeTag && (
              <button
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors"
                style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
                onClick={() => setActiveTag(null)}
                title="Clear tag filter"
              >
                #{activeTag} <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Note list */}
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" role="list">
          {notes.map((note) => {
            const active = note.id === currentNoteId
            return (
              <li key={note.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className="group cursor-pointer rounded-lg border border-transparent px-2.5 py-2 transition-all"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    borderColor: active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'transparent',
                  }}
                  onClick={() => openNote(note.id)}
                  onKeyDown={(e) => e.key === 'Enter' && openNote(note.id)}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, note }) }}
                >
                  {renamingId === note.id ? (
                    <input
                      autoFocus
                      className="inkflow-input h-6 w-full px-1.5 text-[12px]"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => void commitRename(note)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(note)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <NotebookPen size={12} className="shrink-0 text-[var(--text-muted)]" />
                      <span className="flex-1 truncate text-[12px] font-medium" style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {note.title}
                      </span>
                      {note.favorite && <Star size={11} className="shrink-0 fill-[var(--accent)] text-[var(--accent)]" />}
                      {note.archived && <Archive size={11} className="shrink-0 text-[var(--text-muted)]" />}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 pl-[18px]">
                    <span className="text-[10px] text-[var(--text-muted)]">{formatDate(note.updatedAt)}</span>
                    {note.tags.slice(0, 3).map((tag) => (
                      <button
                        key={tag}
                        className="rounded-full px-1.5 py-0.5 text-[9px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
                        style={{ background: 'var(--bg-panel-2)' }}
                        onClick={(e) => { e.stopPropagation(); setActiveTag(tag) }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
          {notes.length === 0 && (
            <li className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
              {searchQuery ? 'No notes match your search.' : 'Nothing here yet — create a note.'}
            </li>
          )}
        </ul>
      </div>

      {/* --------------------------------------------------------- tags */}
      {tags.length > 0 && (
        <div className="border-t px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-1.5 flex items-center gap-1.5" style={sectionLabel}><Tag size={9} /> Tags</div>
          <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
            {tags.slice(0, 16).map(({ tag, count }) => (
              <button
                key={tag}
                className="rounded-full border px-2 py-0.5 text-[10px] transition-colors"
                style={{
                  borderColor: 'var(--border)',
                  color: activeTag === tag ? 'var(--accent)' : 'var(--text-muted)',
                  background: activeTag === tag ? 'var(--accent-soft)' : 'transparent',
                }}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              >
                #{tag} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Context menu */}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={noteMenuItems(menu.note)} onClose={() => setMenu(null)} />}

      {/* New notebook modal */}
      {notebookModal && (
        <Modal title="New notebook" onClose={() => setNotebookModal(false)} footer={(
          <>
            <button className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => setNotebookModal(false)}>Cancel</button>
            <button className="rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }} onClick={() => void submitNotebook()}>Create</button>
          </>
        )}>
          <label className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]" htmlFor="nb-name">Name</label>
          <input id="nb-name" autoFocus className="inkflow-input w-full" placeholder="e.g. Research, Work, Sketches…" value={nbName} onChange={(e) => setNbName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submitNotebook()} />
          <div className="mt-3 mb-1 text-[11px] font-semibold text-[var(--text-secondary)]">Color</div>
          <div className="flex gap-2">
            {NOTEBOOK_COLORS.map((c) => (
              <button key={c} className="h-7 w-7 rounded-lg transition-transform hover:scale-110" style={{ background: c, boxShadow: nbColor === c ? '0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--accent)' : 'none' }} onClick={() => setNbColor(c)} aria-label={`Color ${c}`} />
            ))}
          </div>
        </Modal>
      )}

      {/* New folder modal */}
      {folderModal && (
        <Modal title="New folder" onClose={() => setFolderModal(false)} footer={(
          <>
            <button className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => setFolderModal(false)}>Cancel</button>
            <button className="rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }} onClick={() => void submitFolder()}>Create</button>
          </>
        )}>
          <label className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]" htmlFor="folder-name">Folder name</label>
          <input id="folder-name" autoFocus className="inkflow-input w-full" placeholder="e.g. Lectures" value={folderName} onChange={(e) => setFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submitFolder()} />
        </Modal>
      )}

      {/* Move note to folder */}
      {moveNoteId && (
        <Modal title="Move note to folder" onClose={() => setMoveNoteId(null)}>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            onClick={() => { void moveNoteToFolder(moveNoteId, null); setMoveNoteId(null) }}
          >
            <ChevronRight size={12} /> Notebook root
          </button>
          {visibleFolders.map((f) => (
            <button
              key={f.id}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              onClick={() => { void moveNoteToFolder(moveNoteId, f.id); setMoveNoteId(null); flashStatus('Note moved') }}
            >
              <FolderIcon size={13} /> {f.name}
            </button>
          ))}
          {visibleFolders.length === 0 && <p className="px-3 py-2 text-[11px] text-[var(--text-muted)]">No folders in this notebook yet.</p>}
        </Modal>
      )}
    </aside>
  )
}

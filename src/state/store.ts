import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  AppSettings, Folder, Note, Notebook, Page, PaperSize, ShapeKind,
  ShortcutBinding, ToolId,
} from '../types'
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, PAPER_SIZES } from '../types'
import { repository, searchNotes } from '../persistence/repository'
import { getBackend } from '../persistence/adapter'

/**
 * Global application store (zustand).
 *
 * Two concerns live here:
 *  1. Workspace data (notebooks/folders/notes/pages) mirrored from the DB.
 *  2. Editor UI state (tool, style, zoom, save status) shared between the
 *     toolbar, canvas host, keyboard shortcut dispatcher and status bar.
 */

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
export type MainView = 'workspace' | 'settings'

export const NOTEBOOK_COLORS = ['#7c6cf6', '#f0655a', '#f5a623', '#3ecf8e', '#38bdf8', '#ec4899', '#a3a3a3']

interface InkFlowState {
  initialised: boolean
  initError: string | null

  view: MainView
  setView: (view: MainView) => void

  /* workspace data */
  notebooks: Notebook[]
  folders: Folder[]
  notes: Note[]
  pages: Page[]
  currentNotebookId: string | null
  currentFolderId: string | null
  currentNoteId: string | null
  currentPageIndex: number
  searchQuery: string
  activeTag: string | null
  showArchived: boolean
  favoritesOnly: boolean

  /* settings & shortcuts */
  settings: AppSettings
  shortcuts: ShortcutBinding[]

  /* editor UI */
  tool: ToolId
  color: string
  strokeWidth: number
  strokeOpacity: number
  shapeKind: ShapeKind
  saveState: SaveState
  selectionCount: number
  canUndo: boolean
  canRedo: boolean
  zoom: number
  statusMessage: string | null

  /* lifecycle */
  init: () => Promise<void>
  refresh: () => Promise<void>

  /* navigation */
  selectNotebook: (id: string | null) => void
  selectFolder: (id: string | null) => void
  openNote: (noteId: string, pageIndex?: number) => void
  setPageIndex: (index: number) => void
  setSearchQuery: (q: string) => void
  setActiveTag: (tag: string | null) => void
  setShowArchived: (v: boolean) => void
  setFavoritesOnly: (v: boolean) => void

  /* CRUD */
  createNotebook: (name: string, color?: string) => Promise<Notebook>
  renameNotebook: (id: string, name: string) => Promise<void>
  deleteNotebook: (id: string) => Promise<void>
  createFolder: (name: string) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  createNote: (title?: string) => Promise<Note | null>
  renameNote: (id: string, title: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  duplicateNote: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  archiveNote: (id: string, archived: boolean) => Promise<void>
  setNoteTags: (id: string, tags: string[]) => Promise<void>
  moveNoteToFolder: (id: string, folderId: string | null) => Promise<void>
  updateNotePaper: (id: string, patch: Partial<Note['paper']>) => Promise<void>
  updateTagsEverywhere: (oldTag: string, newTag: string | null) => Promise<void>

  /* pages */
  addPage: () => Promise<void>
  removePage: (pageId: string) => Promise<void>
  setPagePaper: (pageId: string, patch: Partial<Note['paper']> | null) => Promise<void>

  /* editor UI actions */
  setTool: (tool: ToolId) => void
  setColor: (color: string) => void
  setStrokeWidth: (w: number) => void
  setStrokeOpacity: (o: number) => void
  setShapeKind: (k: ShapeKind) => void
  setSaveState: (s: SaveState) => void
  setSelectionCount: (n: number) => void
  setHistory: (canUndo: boolean, canRedo: boolean) => void
  setZoom: (z: number) => void
  flashStatus: (msg: string) => void

  /* settings actions */
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  updateShortcut: (action: string, combo: string) => Promise<void>
  resetShortcuts: () => Promise<void>

  /* selectors (derived) */
  visibleNotes: () => Note[]
  recentNotes: () => Note[]
}

const loadSettingsFromDb = async (): Promise<{ settings: AppSettings; shortcuts: ShortcutBinding[] }> => {
  try {
    const backend = await getBackend()
    const raw = await backend.getSetting('app.settings')
    const rawShortcuts = await backend.getSetting('app.shortcuts')
    const settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
    const parsed = rawShortcuts ? (JSON.parse(rawShortcuts) as ShortcutBinding[]) : null
    // Merge: keep stored combos for known actions; add new default actions; drop removed ones.
    const merged = (() => {
      if (!parsed || parsed.length === 0) return DEFAULT_SHORTCUTS
      const knownActions = new Set(DEFAULT_SHORTCUTS.map((d) => d.action))
      const storedKnown = parsed.filter((b) => knownActions.has(b.action))
      const storedActions = new Set(storedKnown.map((b) => b.action))
      const merged = [...storedKnown]
      for (const def of DEFAULT_SHORTCUTS) {
        if (!storedActions.has(def.action)) merged.push(def)
      }
      return merged
    })()
    return { settings, shortcuts: merged }
  } catch {
    return { settings: DEFAULT_SETTINGS, shortcuts: DEFAULT_SHORTCUTS }
  }
}

const persistSettings = async (settings: AppSettings, shortcuts: ShortcutBinding[]): Promise<void> => {
  const backend = await getBackend()
  await backend.setSetting('app.settings', JSON.stringify(settings))
  await backend.setSetting('app.shortcuts', JSON.stringify(shortcuts))
}

const applyTheme = (theme: AppSettings['theme'], accent?: string): void => {
  const root = document.documentElement
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme
  root.setAttribute('data-theme', resolved)
  if (accent) root.style.setProperty('--accent', accent)
}

let initPromise: Promise<void> | null = null

export const useStore = create<InkFlowState>((set, get) => ({
  initialised: false,
  initError: null,

  view: 'workspace',
  setView: (view) => set({ view }),

  notebooks: [],
  folders: [],
  notes: [],
  pages: [],
  currentNotebookId: null,
  currentFolderId: null,
  currentNoteId: null,
  currentPageIndex: 0,
  searchQuery: '',
  activeTag: null,
  showArchived: false,
  favoritesOnly: false,

  settings: DEFAULT_SETTINGS,
  shortcuts: DEFAULT_SHORTCUTS,

  tool: 'pen',
  color: '#2b2a33',
  strokeWidth: 3.2,
  strokeOpacity: 1,
  shapeKind: 'rect',
  saveState: 'idle',
  selectionCount: 0,
  canUndo: false,
  canRedo: false,
  zoom: 1,
  statusMessage: null,

  init: () => {
    // StrictMode double-mounts in dev — dedupe concurrent init calls.
    if (!initPromise) {
      initPromise = (async () => {
        try {
          await repository.init()
      const { settings, shortcuts } = await loadSettingsFromDb()
      applyTheme(settings.theme, settings.accent)
      const snapshot = await repository.loadWorkspace()

      // First run: seed a starter notebook with a note so the app isn't empty.
      if (snapshot.notebooks.length === 0) {
        const nb = await repository.createNotebook('My Notebook', '#7c6cf6')
        await repository.createNote(nb.id, null, 'Welcome to InkFlow')
        const refreshed = await repository.loadWorkspace()
        const firstNote = refreshed.notes[0]
        set({
          ...refreshed,
          settings,
          shortcuts,
          initialised: true,
          currentNotebookId: nb.id,
          currentNoteId: firstNote?.id ?? null,
          currentPageIndex: 0,
        })
        return
      }

      const notebooks = snapshot.notebooks.filter((n) => !n.archived)
      const firstNotebook = notebooks[0] ?? snapshot.notebooks[0] ?? null
      const notebookNotes = snapshot.notes.filter((n) => n.notebookId === firstNotebook?.id && !n.archived)
      const firstNote = [...notebookNotes].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0] ?? null
      set({
        ...snapshot,
        settings,
        shortcuts,
        initialised: true,
        currentNotebookId: firstNotebook?.id ?? null,
        currentNoteId: firstNote?.id ?? null,
        currentPageIndex: 0,
      })
        } catch (err) {
          console.error('InkFlow init failed', err)
          set({ initError: err instanceof Error ? err.message : String(err), initialised: true })
        }
      })()
    }
    return initPromise
  },

  refresh: async () => {
    const snapshot = await repository.loadWorkspace()
    set(snapshot)
  },

  /* navigation */
  selectNotebook: (id) => set({ currentNotebookId: id, currentFolderId: null, activeTag: null }),
  selectFolder: (id) => set({ currentFolderId: id }),
  openNote: (noteId, pageIndex = 0) => {
    const now = Date.now()
    set((state) => ({
      currentNoteId: noteId,
      currentPageIndex: pageIndex,
      notes: state.notes.map((n) => (n.id === noteId ? { ...n, lastOpenedAt: now } : n)),
    }))
    void repository.touchNoteLastOpened(noteId)
  },
  setPageIndex: (index) => set({ currentPageIndex: index }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveTag: (activeTag) => set({ activeTag }),
  setShowArchived: (showArchived) => set({ showArchived }),
  setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),

  /* CRUD */
  createNotebook: async (name, color) => {
    const nb = await repository.createNotebook(name, color)
    set((s) => ({ notebooks: [...s.notebooks, nb], currentNotebookId: nb.id, currentFolderId: null }))
    return nb
  },
  renameNotebook: async (id, name) => {
    await repository.renameNotebook(id, name)
    const now = Date.now()
    set((s) => ({ notebooks: s.notebooks.map((n) => (n.id === id ? { ...n, name: name.trim() || n.name, updatedAt: now } : n)) }))
  },
  deleteNotebook: async (id) => {
    await repository.deleteNotebook(id)
    const s = get()
    const notebooks = s.notebooks.filter((n) => n.id !== id)
    const folders = s.folders.filter((f) => f.notebookId !== id)
    const notes = s.notes.filter((n) => n.notebookId !== id)
    const noteIds = new Set(s.notes.filter((n) => n.notebookId === id).map((n) => n.id))
    const pages = s.pages.filter((p) => !noteIds.has(p.noteId))
    const currentNoteId = s.currentNoteId && notes.some((n) => n.id === s.currentNoteId) ? s.currentNoteId : null
    set({
      notebooks,
      folders,
      notes,
      pages,
      currentNotebookId: s.currentNotebookId === id ? (notebooks[0]?.id ?? null) : s.currentNotebookId,
      currentFolderId: null,
      currentNoteId,
      currentPageIndex: 0,
    })
  },

  createFolder: async (name) => {
    const { currentNotebookId, folders } = get()
    if (!currentNotebookId) return
    const folder = await repository.createFolder(currentNotebookId, name)
    set({ folders: [...folders, folder] })
  },
  renameFolder: async (id, name) => {
    await repository.renameFolder(id, name)
    set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)) }))
  },
  deleteFolder: async (id) => {
    await repository.deleteFolder(id)
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      notes: s.notes.map((n) => (n.folderId === id ? { ...n, folderId: null } : n)),
      currentFolderId: s.currentFolderId === id ? null : s.currentFolderId,
    }))
  },

  createNote: async (title = 'Untitled note') => {
    const { currentNotebookId, currentFolderId, settings } = get()
    if (!currentNotebookId) return null
    const dim = settings.defaultPaperSize !== 'infinite'
      ? PAPER_SIZES[settings.defaultPaperSize as Exclude<PaperSize, 'infinite'>]
      : { width: 1600, height: 1200 }
    const paper = {
      size: settings.defaultPaperSize,
      width: dim.width,
      height: dim.height,
      background: '#fdfbf7',
      template: settings.defaultTemplate,
      spacing: settings.defaultSpacing,
    }
    const { note, page } = await repository.createNote(currentNotebookId, currentFolderId, title, paper)
    set((s) => ({
      notes: [...s.notes, note],
      pages: [...s.pages, page],
      currentNoteId: note.id,
      currentPageIndex: 0,
    }))
    return note
  },
  renameNote: async (id, title) => {
    const s = get()
    const note = s.notes.find((n) => n.id === id)
    if (!note) return
    const updated = { ...note, title: title.trim() || 'Untitled note', updatedAt: Date.now() }
    await repository.updateNote(updated)
    set({ notes: s.notes.map((n) => (n.id === id ? updated : n)) })
  },
  deleteNote: async (id) => {
    await repository.deleteNote(id)
    const s = get()
    const notes = s.notes.filter((n) => n.id !== id)
    const pages = s.pages.filter((p) => p.noteId !== id)
    const nextNote = s.currentNoteId === id
      ? (notes.filter((n) => n.notebookId === s.currentNotebookId && !n.archived).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.id ?? null)
      : s.currentNoteId
    set({ notes, pages, currentNoteId: nextNote, currentPageIndex: 0 })
  },
  duplicateNote: async (id) => {
    const result = await repository.duplicateNote(id)
    if (!result) return
    set((s) => ({
      notes: [...s.notes, result.note],
      pages: [...s.pages, ...result.pages],
      currentNoteId: result.note.id,
      currentPageIndex: 0,
    }))
  },
  toggleFavorite: async (id) => {
    const s = get()
    const note = s.notes.find((n) => n.id === id)
    if (!note) return
    const updated = { ...note, favorite: !note.favorite, updatedAt: Date.now() }
    await repository.updateNote(updated)
    set({ notes: s.notes.map((n) => (n.id === id ? updated : n)) })
  },
  archiveNote: async (id, archived) => {
    const s = get()
    const note = s.notes.find((n) => n.id === id)
    if (!note) return
    const updated = { ...note, archived, updatedAt: Date.now() }
    await repository.updateNote(updated)
    const notes = s.notes.map((n) => (n.id === id ? updated : n))
    const patch: Partial<InkFlowState> = { notes }
    if (archived && s.currentNoteId === id) {
      const next = notes.filter((n) => n.notebookId === s.currentNotebookId && !n.archived)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]
      patch.currentNoteId = next?.id ?? null
      patch.currentPageIndex = 0
    }
    set(patch)
  },
  setNoteTags: async (id, tags) => {
    const s = get()
    const note = s.notes.find((n) => n.id === id)
    if (!note) return
    const normalized = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
    const updated = { ...note, tags: normalized, updatedAt: Date.now() }
    await repository.updateNote(updated)
    set({ notes: s.notes.map((n) => (n.id === id ? updated : n)) })
  },
  moveNoteToFolder: async (id, folderId) => {
    const s = get()
    const note = s.notes.find((n) => n.id === id)
    if (!note) return
    const updated = { ...note, folderId, updatedAt: Date.now() }
    await repository.updateNote(updated)
    set({ notes: s.notes.map((n) => (n.id === id ? updated : n)) })
  },
  updateNotePaper: async (id, patch) => {
    const s = get()
    const note = s.notes.find((n) => n.id === id)
    if (!note) return
    const merged = { ...note.paper, ...patch }
    // Keep width/height consistent with the chosen size unless explicitly overridden.
    if (patch.size && patch.size !== 'infinite' && PAPER_SIZES[patch.size as Exclude<PaperSize, 'infinite'>]) {
      const dim = PAPER_SIZES[patch.size as Exclude<PaperSize, 'infinite'>]
      merged.width = dim.width
      merged.height = dim.height
    }
    const updated = { ...note, paper: merged, updatedAt: Date.now() }
    await repository.updateNote(updated)
    set({ notes: s.notes.map((n) => (n.id === id ? updated : n)) })
  },
  updateTagsEverywhere: async (oldTag, newTag) => {
    const s = get()
    const backend = await getBackend()
    const next: Note[] = []
    for (const note of s.notes) {
      if (!note.tags.includes(oldTag)) {
        next.push(note)
        continue
      }
      const tags = note.tags.filter((t) => t !== oldTag)
      if (newTag) tags.push(newTag)
      const updated = { ...note, tags: [...new Set(tags)], updatedAt: Date.now() }
      await backend.saveNote(updated)
      next.push(updated)
    }
    set({ notes: next })
  },

  /* pages */
  addPage: async () => {
    const { currentNoteId, pages } = get()
    if (!currentNoteId) return
    const page = await repository.addPage(currentNoteId)
    set({ pages: [...pages, page], currentPageIndex: page.index })
  },
  removePage: async (pageId) => {
    const { currentNoteId, pages, currentPageIndex } = get()
    if (!currentNoteId) return
    await repository.removePage(pageId, currentNoteId)
    const remaining = pages.filter((p) => p.noteId === currentNoteId && p.id !== pageId).sort((a, b) => a.index - b.index)
    set({
      pages: pages.filter((p) => p.id !== pageId),
      currentPageIndex: Math.min(currentPageIndex, Math.max(0, remaining.length - 1)),
    })
  },
  setPagePaper: async (pageId, patch) => {
    const backend = await getBackend()
    const page = get().pages.find((p) => p.id === pageId)
    if (!page) return
    const note = get().notes.find((n) => n.id === page.noteId)
    const base = page.paper ?? note?.paper
    if (!base) return
    const paper = patch === null ? null : { ...base, ...patch }
    await backend.savePage({ ...page, paper })
    set((s) => ({ pages: s.pages.map((p) => (p.id === pageId ? { ...p, paper } : p)) }))
  },

  /* editor UI */
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  setStrokeOpacity: (strokeOpacity) => set({ strokeOpacity }),
  setShapeKind: (shapeKind) => set({ shapeKind }),
  setSaveState: (saveState) => set({ saveState }),
  setSelectionCount: (selectionCount) => set({ selectionCount }),
  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setZoom: (zoom) => set({ zoom }),
  flashStatus: (statusMessage) => {
    set({ statusMessage })
    window.setTimeout(() => {
      if (get().statusMessage === statusMessage) set({ statusMessage: null })
    }, 2600)
  },

  /* settings */
  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch }
    applyTheme(settings.theme, settings.accent)
    set({ settings })
    await persistSettings(settings, get().shortcuts)
  },
  updateShortcut: async (action, combo) => {
    const shortcuts = get().shortcuts.map((s) => (s.action === action ? { ...s, combo } : s))
    set({ shortcuts })
    await persistSettings(get().settings, shortcuts)
  },
  resetShortcuts: async () => {
    set({ shortcuts: DEFAULT_SHORTCUTS })
    await persistSettings(get().settings, DEFAULT_SHORTCUTS)
  },

  /* selectors */
  visibleNotes: () => {
    const s = get()
    let list = s.notes.filter((n) => n.notebookId === s.currentNotebookId)
    if (!s.showArchived) list = list.filter((n) => !n.archived)
    if (s.currentFolderId) list = list.filter((n) => n.folderId === s.currentFolderId)
    if (s.favoritesOnly) list = list.filter((n) => n.favorite)
    if (s.activeTag) list = list.filter((n) => n.tags.includes(s.activeTag!))
    list = searchNotes(list, s.searchQuery)
    return [...list].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  },
  recentNotes: () => {
    const s = get()
    return [...s.notes].filter((n) => !n.archived).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 12)
  },
}))

export const selectCurrentNote = (s: InkFlowState): Note | null =>
  s.notes.find((n) => n.id === s.currentNoteId) ?? null

export const selectCurrentPages = (s: InkFlowState): Page[] =>
  s.pages.filter((p) => p.noteId === s.currentNoteId).sort((a, b) => a.index - b.index)

/**
 * Shallow-equality selector for page lists — plain `selectCurrentPages`
 * allocates a new array per call, which would loop forever under
 * useSyncExternalStore. Use this hook anywhere pages are subscribed to.
 */
export const useCurrentPages = (): Page[] => useStore(useShallow(selectCurrentPages))

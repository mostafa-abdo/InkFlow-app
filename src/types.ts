/**
 * InkFlow — shared domain model.
 * Stroke geometry lives in "page coordinates": an abstract 2D space whose
 * origin is the top-left corner of the paper. Rendering converts page
 * coordinates into screen coordinates via a Viewport transform.
 */

export type ToolId =
  | 'select'
  | 'lasso'
  | 'pen'
  | 'pencil'
  | 'highlighter'
  | 'eraser'
  | 'shape'
  | 'line'
  | 'arrow'

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star'

/** Freehand strokes carry tool in {@link InkStroke.tool}; vector objects use `shape`. */
export type StrokeKind = 'free' | ShapeKind | 'line' | 'arrow'

export interface StrokePoint {
  /** Page-space coordinates */
  x: number
  y: number
  /** 0..1 — defaults to 0.5 for mice (PointerEvent spec) */
  pressure: number
  /** Degrees, PointerEvent.tiltX/tiltY — only present for stylus hardware */
  tiltX: number
  tiltY: number
  /** Monotonic timestamp (performance.now()) */
  t: number
}

export interface InkStroke {
  id: string
  pageId: string
  /** Layer architecture hook — a page always has at least one layer. */
  layerId: string
  kind: StrokeKind
  tool: ToolId | 'shape-tool'
  /** CSS color (hex) */
  color: string
  /** Base stroke width in page units at pressure = 1 */
  width: number
  /** 0..1 */
  opacity: number
  /** Freehand: decimated sample points. Shapes: exactly [start, end]. */
  points: StrokePoint[]
  /** For arrows: whether the head is at the end point */
  arrowHead: boolean
  createdAt: number
}

/* ---------------------------------------------------------------- notebooks */

export interface Notebook {
  id: string
  name: string
  /** Hex color used for the notebook dot/icon */
  color: string
  icon: string
  archived: boolean
  sort: number
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  notebookId: string
  parentId: string | null
  name: string
  sort: number
  createdAt: number
}

export type PageTemplate =
  | 'blank'
  | 'ruled'
  | 'grid'
  | 'dotted'
  | 'cornell'
  | 'planner'
  | 'custom'

export type PaperSize = 'a4-portrait' | 'a4-landscape' | 'letter-portrait' | 'letter-landscape' | 'a5-portrait' | 'pdf' | 'infinite'

export type InterfaceMode = 'simple' | 'advanced' | 'custom'

/** IDs of every toggleable toolbar item, shared by all modes. */
export type ToolbarItemId =
  | 'select' | 'lasso' | 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'shape' | 'line' | 'arrow'
  | 'undoRedo' | 'colors' | 'strokeWidth' | 'zoom'

export interface ToolbarSelection {
  simple: ToolbarItemId[]
  advanced: ToolbarItemId[]
  custom: ToolbarItemId[]
}

export interface PaperSpec {
  size: PaperSize
  /** Paper size in page units (96dpi-ish). Infinite pages grow in both axes. */
  width: number
  height: number
  /** Background color of the paper */
  background: string
  template: PageTemplate
  /** Distance between ruled lines / grid cells, page units */
  spacing: number
}

export interface Note {
  id: string
  notebookId: string
  folderId: string | null
  title: string
  tags: string[]
  favorite: boolean
  archived: boolean
  paper: PaperSpec
  sort: number
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  /** Set when this note was created from an imported PDF */
  pdfAssetId: string | null
}

export interface Page {
  id: string
  noteId: string
  index: number
  /** Overrides of the note's paper spec (per-page custom backgrounds) */
  paper: PaperSpec | null
  /** For PDF-backed notes: which PDF page this is (1-based) */
  pdfPage: number | null
  createdAt: number
}

/* ------------------------------------------------------------------ assets */

export interface Asset {
  id: string
  name: string
  mime: string
  bytes: Uint8Array
  createdAt: number
}

/* ---------------------------------------------------------------- settings */

export type ThemeMode = 'system' | 'light' | 'dark'

export interface AppSettings {
  theme: ThemeMode
  accent: string
  autosaveMs: number
  pressureGamma: number
  defaultTemplate: PageTemplate
  defaultPaperSize: PaperSize
  defaultSpacing: number
  /** Synthesize pressure from stroke speed on devices that report none (mouse, compat pens) */
  velocityPressure: boolean
  /** Show the stylus pressure readout in the status bar */
  showPressureMeter: boolean
  palmRejection: boolean
  /** Require pointerType === 'pen' to draw (mouse still works for selection) */
  penOnlyDrawing: boolean
  /** Eraser variant: whole stroke, or partial eraser that splits strokes */
  eraserMode: 'stroke' | 'partial'
  /** Show the left sidebar (notebooks / folders / notes / tags) */
  showSidebar: boolean
  /** Show the page rail (page thumbnails beside the canvas) */
  showPagesRail: boolean
  /** Show the right inspector panel */
  showInspector: boolean
  /** Which interface variant is shown */
  interfaceMode: InterfaceMode
  /** Tools enabled per interface mode */
  toolbarSelection: ToolbarSelection
}

export const ALL_TOOLBAR_ITEMS: { id: ToolbarItemId; label: string; hint: string }[] = [
  { id: 'pen', label: 'Pen', hint: 'Pressure-sensitive pen' },
  { id: 'pencil', label: 'Pencil', hint: 'Pencil-style texture' },
  { id: 'highlighter', label: 'Highlighter', hint: 'Multiply-blend marker' },
  { id: 'eraser', label: 'Eraser', hint: 'Whole stroke / partial mode' },
  { id: 'shape', label: 'Shapes', hint: 'Rect · Ellipse · Triangle · Diamond · Star' },
  { id: 'line', label: 'Line', hint: 'Straight line' },
  { id: 'arrow', label: 'Arrow', hint: 'Straight arrow' },
  { id: 'select', label: 'Select', hint: 'Select and move strokes' },
  { id: 'lasso', label: 'Lasso', hint: 'Freehand lasso selection' },
  { id: 'undoRedo', label: 'Undo / Redo', hint: 'Undo and redo buttons' },
  { id: 'colors', label: 'Ink colors', hint: 'Ink color swatches' },
  { id: 'strokeWidth', label: 'Stroke width', hint: 'Stroke width slider' },
  { id: 'zoom', label: 'Zoom controls', hint: 'Zoom in / out / fit' },
]

export const DEFAULT_TOOLBAR_SELECTION: ToolbarSelection = {
  simple: ['pen', 'highlighter', 'eraser', 'undoRedo', 'colors', 'strokeWidth'],
  advanced: [...ALL_TOOLBAR_ITEMS.map((i) => i.id)],
  custom: [...ALL_TOOLBAR_ITEMS.map((i) => i.id)],
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accent: '#7c6cf6',
  autosaveMs: 800,
  pressureGamma: 1.35,
  velocityPressure: true,
  defaultTemplate: 'ruled',
  defaultPaperSize: 'a4-portrait',
  defaultSpacing: 36,
  showPressureMeter: true,
  palmRejection: true,
  penOnlyDrawing: false,
  eraserMode: 'stroke',
  showSidebar: true,
  showPagesRail: true,
  showInspector: true,
  interfaceMode: 'advanced',
  toolbarSelection: DEFAULT_TOOLBAR_SELECTION,
}

export interface ShortcutBinding {
  /** Human readable combo, e.g. "Ctrl+Z" */
  combo: string
  action: string
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { action: 'undo', combo: 'Ctrl+Z' },
  { action: 'redo', combo: 'Ctrl+Shift+Z' },
  { action: 'pen', combo: 'P' },
  { action: 'pencil', combo: 'B' },
  { action: 'highlighter', combo: 'H' },
  { action: 'eraser-whole', combo: 'E+1' },
  { action: 'eraser-partial', combo: 'E+2' },
  { action: 'select', combo: 'V' },
  { action: 'lasso', combo: 'L' },
  { action: 'shape', combo: 'S' },
  { action: 'shape-rect', combo: 'S+1' },
  { action: 'shape-ellipse', combo: 'S+2' },
  { action: 'shape-triangle', combo: 'S+3' },
  { action: 'shape-diamond', combo: 'S+4' },
  { action: 'shape-star', combo: 'S+5' },
  { action: 'line', combo: 'I' },
  { action: 'arrow', combo: 'A' },
  { action: 'duplicate-note', combo: 'Ctrl+D' },
  { action: 'toggle-favorite', combo: 'Ctrl+Shift+F' },
  { action: 'export-png', combo: 'Ctrl+Shift+E' },
  { action: 'zoom-in', combo: 'Ctrl+=' },
  { action: 'zoom-out', combo: 'Ctrl+-' },
  { action: 'zoom-reset', combo: 'Ctrl+0' },
  { action: 'delete-selection', combo: 'Delete' },
  { action: 'search', combo: 'Ctrl+F' },
  { action: 'toggle-settings', combo: 'Ctrl+,' },
]

export const PAPER_SIZES: Record<Exclude<PaperSize, 'infinite'>, { width: number; height: number; label: string }> = {
  'a4-portrait': { width: 794, height: 1123, label: 'A4 · Portrait' },
  'a4-landscape': { width: 1123, height: 794, label: 'A4 · Landscape' },
  'letter-portrait': { width: 816, height: 1056, label: 'Letter · Portrait' },
  'letter-landscape': { width: 1056, height: 816, label: 'Letter · Landscape' },
  'a5-portrait': { width: 559, height: 794, label: 'A5 · Portrait' },
  pdf: { width: 794, height: 1123, label: 'PDF page' },
}

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

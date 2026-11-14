import type { InkStroke, PaperSpec, StrokePoint, ToolId, ShapeKind } from '../types'
import { uid } from '../types'
import { renderStroke, renderFreehand } from './strokeRenderer'
import { decimate, smoothSamples } from './smoothing'
import { strokeHitTest, lassoSelect, strokeBounds, distanceToStroke } from './hitTest'
import { unionBBox, type BBox } from './geometry'
import { synthesizePressureFromVelocity } from './velocityPressure'

/**
 * InkFlow drawing engine — framework-free.
 *
 * Canvas stack (bottom → top):
 *   background  paper fill, page template, optional PDF page image
 *   ink         committed strokes (redrawn only when committed data changes)
 *   active      the stroke currently being drawn (per animation frame)
 *   overlay     selection marquee, lasso polygon, selection handles
 *
 * The engine owns viewport transforms (zoom/pan) and converts pointer events
 * into page-space stroke samples. Persistence is delegated to the host via
 * the `strokes-changed` event — the engine itself is storage-agnostic.
 */

export const DEFAULT_LAYER_ID = 'layer-ink'
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5

export interface Viewport {
  zoom: number
  /** CSS-pixel offset of page origin relative to canvas origin */
  offsetX: number
  offsetY: number
}

export type EngineEvent =
  | { type: 'strokes-changed' }
  | { type: 'selection-changed'; ids: string[] }
  | { type: 'history-changed'; canUndo: boolean; canRedo: boolean }
  | { type: 'viewport-changed'; viewport: Viewport }
  | { type: 'point-info'; pressure: number; pointerType: string; tiltX: number; tiltY: number }

export interface EngineStyle {
  color: string
  /** Base width for pen-like tools, page units */
  width: number
  opacity: number
  shapeKind: ShapeKind
}

type ReplaceEntry = { id: string; before: StrokePoint[]; after: StrokePoint[] }

type Command =
  | { type: 'add'; stroke: InkStroke }
  | { type: 'remove-objects'; entries: { stroke: InkStroke; index: number }[] }
  | { type: 'replace-points'; entries: ReplaceEntry[] }
  | { type: 'replace-page'; before: InkStroke[]; after: InkStroke[] }

export type EraserMode = 'stroke' | 'partial'

interface PageContext {
  pageId: string
  paper: PaperSpec
  strokes: InkStroke[]
  /** Optional PDF page image, drawn beneath the ink layer */
  pdfImage: CanvasImageSource | null
}

const TOOL_FACTOR: Partial<Record<ToolId, number>> = {
  pencil: 0.85,
  highlighter: 4.6,
}

const TOOL_OPACITY: Partial<Record<ToolId, number>> = {
  pencil: 0.78,
  highlighter: 0.34,
}

export class DrawingEngine {
  private bg: HTMLCanvasElement | null = null
  private ink: HTMLCanvasElement | null = null
  private active: HTMLCanvasElement | null = null
  private overlay: HTMLCanvasElement | null = null

  private cssWidth = 1
  private cssHeight = 1
  private dpr = 1

  private page: PageContext | null = null
  private viewport: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 }

  private tool: ToolId = 'pen'
  private style: EngineStyle = { color: '#e8e6f2', width: 3.2, opacity: 1, shapeKind: 'rect' }
  private pressureGamma = 1.35

  private strokes: InkStroke[] = []
  private selection = new Set<string>()

  private undoStack: Command[] = []
  private redoStack: Command[] = []

  private drawing = false
  private panning = false
  private panStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 }
  private spaceDown = false
  private activePointerId: number | null = null
  private currentPoints: StrokePoint[] = []
  private shapeStart: StrokePoint | null = null

  private lassoPolygon: { x: number; y: number }[] = []

  // Selection interaction state
  private selectionDrag: {
    mode: 'move' | 'resize'
    handle: string | null
    startPage: { x: number; y: number }
    bbox: BBox
    snapshot: Map<string, StrokePoint[]>
    delta: { dx: number; dy: number }
    scale: { sx: number; sy: number; originX: number; originY: number } | null
  } | null = null
  private ghostDelta = { dx: 0, dy: 0 }
  private ghostScale: { sx: number; sy: number; originX: number; originY: number } | null = null

  private lastPenTime = 0

  private events = new Set<(e: EngineEvent) => void>()

  /** Palm rejection & settings injected by host. */
  public palmRejection = true
  /** Synthesize pressure from stroke speed when the device reports none */
  public velocityPressure = true
  private strokeSilenceTimer: number | null = null
  public penOnlyDrawing = false
  /** Which eraser variant: whole-stroke, or partial "pixel" eraser */
  public eraserMode: EraserMode = 'stroke'
  private eraserSnapshot: InkStroke[] | null = null
  /** Render callback for the background (paper + template + PDF) provided by the host. */
  public backgroundRenderer: ((ctx: CanvasRenderingContext2D, paper: PaperSpec, w: number, h: number) => void) | null = null

  /* ------------------------------------------------------------ lifecycle */

  attach(bg: HTMLCanvasElement, ink: HTMLCanvasElement, active: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
    this.bg = bg
    this.ink = ink
    this.active = active
    this.overlay = overlay
    this.resize(this.cssWidth, this.cssHeight)
  }

  detach(): void {
    this.bg = this.ink = this.active = this.overlay = null
  }

  onEvent(listener: (e: EngineEvent) => void): () => void {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  private emit(e: EngineEvent): void {
    for (const l of this.events) l(e)
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = Math.max(1, cssWidth)
    this.cssHeight = Math.max(1, cssHeight)
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    for (const canvas of [this.bg, this.ink, this.active, this.overlay]) {
      if (!canvas) continue
      canvas.width = Math.round(this.cssWidth * this.dpr)
      canvas.height = Math.round(this.cssHeight * this.dpr)
      canvas.style.width = `${this.cssWidth}px`
      canvas.style.height = `${this.cssHeight}px`
    }
    this.renderAll()
  }

  getViewport(): Viewport {
    return { ...this.viewport }
  }

  setViewport(v: Viewport): void {
    this.viewport = { ...v, zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM) }
    this.emit({ type: 'viewport-changed', viewport: this.getViewport() })
    this.renderAll()
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const v = this.viewport
    const newZoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    // Keep the page point under the cursor stationary.
    const px = (screenX - v.offsetX) / v.zoom
    const py = (screenY - v.offsetY) / v.zoom
    this.viewport = { zoom: newZoom, offsetX: screenX - px * newZoom, offsetY: screenY - py * newZoom }
    this.emit({ type: 'viewport-changed', viewport: this.getViewport() })
    this.renderAll()
  }

  panBy(dx: number, dy: number): void {
    this.viewport = { ...this.viewport, offsetX: this.viewport.offsetX + dx, offsetY: this.viewport.offsetY + dy }
    this.emit({ type: 'viewport-changed', viewport: this.getViewport() })
    this.renderAll()
  }

  zoomReset(): void {
    this.viewport = { zoom: 1, offsetX: 0, offsetY: 0 }
    this.emit({ type: 'viewport-changed', viewport: this.getViewport() })
    this.renderAll()
  }

  zoomToFit(): void {
    if (!this.page) return
    const paperW = this.page.paper.width
    const paperH = this.page.paper.height
    const margin = 48
    const zoom = clamp(Math.min((this.cssWidth - margin * 2) / paperW, (this.cssHeight - margin * 2) / paperH), MIN_ZOOM, MAX_ZOOM)
    this.viewport = {
      zoom,
      offsetX: (this.cssWidth - paperW * zoom) / 2,
      offsetY: (this.cssHeight - paperH * zoom) / 2,
    }
    this.emit({ type: 'viewport-changed', viewport: this.getViewport() })
    this.renderAll()
  }

  /* ---------------------------------------------------------------- page */

  loadPage(pageId: string, strokes: InkStroke[], paper: PaperSpec, pdfImage: CanvasImageSource | null = null): void {
    this.page = { pageId, paper, strokes: strokes.map((s) => ({ ...s })), pdfImage }
    this.strokes = this.page.strokes
    this.selection.clear()
    this.undoStack = []
    this.redoStack = []
    this.drawing = false
    this.currentPoints = []
    this.shapeStart = null
    this.eraserSnapshot = null
    this.lassoPolygon = []
    this.selectionDrag = null
    this.viewport = { zoom: 1, offsetX: 0, offsetY: 0 }
    this.emit({ type: 'viewport-changed', viewport: this.getViewport() })
    this.emit({ type: 'selection-changed', ids: [] })
    this.emit({ type: 'history-changed', canUndo: false, canRedo: false })
    this.renderAll()
    this.zoomToFit()
  }

  getStrokes(): InkStroke[] {
    return this.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) }))
  }

  getPageId(): string | null {
    return this.page?.pageId ?? null
  }

  /**
   * Commit a stroke produced by the direct input pipeline (Simple Ink path)
   * into the engine's stroke list, undo stack and autosave flow.
   */
  addExternalFreehandStroke(points: StrokePoint[]): void {
    if (points.length === 0 || !this.page) return
    const smoothed = smoothSamples(decimate(points), 2)
    const adjusted = this.velocityPressure ? synthesizePressureFromVelocity(smoothed) : smoothed
    const stroke: InkStroke = {
      ...this.makeBaseStroke(adjusted[0], adjusted[adjusted.length - 1]),
      kind: 'free',
      tool: this.tool,
      points: adjusted,
    }
    this.pushCommand({ type: 'add', stroke })
    this.strokes = [...this.strokes, stroke]
    this.afterStrokesMutated()
  }

  /** Commit a simple shape produced by the direct input pipeline. */
  addExternalShapeStroke(kind: InkStroke['kind'], start: StrokePoint, end: StrokePoint): void {
    if (!this.page) return
    const stroke: InkStroke = {
      ...this.makeBaseStroke(start, end),
      kind,
      tool: 'shape-tool',
      points: [start, end],
    }
    this.pushCommand({ type: 'add', stroke })
    this.strokes = [...this.strokes, stroke]
    this.afterStrokesMutated()
  }

  /** Begin an eraser session — snapshots the page so the gesture is one undo step. */
  beginEraseSession(): void {
    this.eraserSnapshot = cloneStrokes(this.strokes)
  }

  /** Erase a BATCH of page coordinates — one pass, one repaint for the whole pointermove batch. */
  eraseAtPublic(points: { x: number; y: number }[]): void {
    if (!this.page || points.length === 0) return
    if (!this.eraserSnapshot && this.tool === 'eraser') this.beginEraseSession()
    // Single coalesced pass over all points: split/remove strokes each point hits, then ONE repaint.
    const radius = 8 + this.style.width * 2
    let changed = false
    if (this.eraserMode === 'partial') {
      for (const pt of points) {
        const next: InkStroke[] = []
        for (const s of this.strokes) {
          const pieces = splitStrokeByEraser(s, pt.x, pt.y, radius)
          if (pieces === UNCHANGED) { next.push(s); continue }
          changed = true
          next.push(...pieces)
        }
        this.strokes = next
      }
    } else {
      for (const pt of points) {
        const kept = this.strokes.filter((s) => !strokeHitTest(pt.x, pt.y, radius, s))
        if (kept.length !== this.strokes.length) { this.strokes = kept; changed = true }
      }
    }
    if (changed) {
      this.selection.clear()
      this.renderInkLayer()
    }
  }

  /** Finalize any pending eraser batch — used by the direct input pipeline. */
  commitEraseAtPublic(): void {
    this.commitEraserBatch()
  }

  setTool(tool: ToolId): void {
    this.tool = tool
    this.clearSelection()
    this.clearOverlay()
  }

  getTool(): ToolId {
    return this.tool
  }

  setStyle(style: Partial<EngineStyle>): void {
    this.style = { ...this.style, ...style }
  }

  getStyle(): EngineStyle {
    return { ...this.style }
  }

  setPressureGamma(gamma: number): void {
    this.pressureGamma = gamma
    this.renderInkLayer()
  }

  setSpaceDown(down: boolean): void {
    this.spaceDown = down
  }

  /* --------------------------------------------------------- transforms */

  private applyTransform(ctx: CanvasRenderingContext2D): void {
    const s = this.dpr * this.viewport.zoom
    ctx.setTransform(s, 0, 0, s, this.dpr * this.viewport.offsetX, this.dpr * this.viewport.offsetY)
  }

  screenToPage(clientX: number, clientY: number): { x: number; y: number } {
    const target = this.ink ?? this.bg
    const rect = target!.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    return {
      x: (sx - this.viewport.offsetX) / this.viewport.zoom,
      y: (sy - this.viewport.offsetY) / this.viewport.zoom,
    }
  }

  /* ------------------------------------------------------------- render */

  private renderAll(): void {
    this.renderBackground()
    this.renderInkLayer()
    this.clearActive()
    this.clearOverlay()
  }

  private renderBackground(): void {
    if (!this.bg) return
    const ctx = this.bg.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.bg.width, this.bg.height)
    if (!this.page) return

    const { paper, pdfImage } = this.page
    this.applyTransform(ctx)

    // Drop shadow for the paper.
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 28
    ctx.shadowOffsetY = 8
    ctx.fillStyle = paper.background
    ctx.fillRect(0, 0, paper.width, paper.height)
    ctx.restore()

    if (pdfImage) {
      ctx.drawImage(pdfImage, 0, 0, paper.width, paper.height)
    }
    this.backgroundRenderer?.(ctx, paper, paper.width, paper.height)
  }

  private renderInkLayer(): void {
    if (!this.ink) return
    const ctx = this.ink.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.ink.width, this.ink.height)
    if (!this.page) return
    this.applyTransform(ctx)

    const selected = this.selectionDrag ? this.selection : null
    for (const stroke of this.strokes) {
      // While dragging a selection, selected strokes are previewed on the overlay instead.
      if (selected && selected.has(stroke.id)) continue
      renderStroke(ctx, stroke, this.pressureGamma)
    }
  }

  private clearActive(): void {
    if (!this.active) return
    const ctx = this.active.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.active.width, this.active.height)
  }

  private clearOverlay(): void {
    if (!this.overlay) return
    const ctx = this.overlay.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
  }

  /* ------------------------------------------------------ pointer input */

  private acceptPointer(e: PointerEvent): boolean {
    if (e.pointerType === 'pen') {
      this.lastPenTime = performance.now()
      return true
    }
    // Palm rejection: while (or shortly after) a stylus is active, ignore touch contacts.
    if (e.pointerType === 'touch' && this.palmRejection) {
      if (this.activePointerId !== null) return false
      if (performance.now() - this.lastPenTime < 2000) return false
      if (this.penOnlyDrawing) return false
    }
    if (e.pointerType === 'mouse') return !this.penOnlyDrawing
    return true
  }

  handlePointerDown(e: PointerEvent): void {
    if (!this.page) return
    const isMiddle = e.button === 1
    // A gesture is already in flight — ignore extra pointers (multi-pen, palm taps).
    if (this.activePointerId !== null || this.panning) return
    if (this.spaceDown || isMiddle) {
      this.panning = true
      this.panStart = { x: e.clientX, y: e.clientY, offsetX: this.viewport.offsetX, offsetY: this.viewport.offsetY }
      this.capturePointer(e.pointerId)
      return
    }
    if (e.button !== 0) return
    // Palm rejection & pen-only mode. Selection and lasso stay available to all pointers.
    if (e.pointerType === 'pen') {
      this.lastPenTime = performance.now()
    }
    const needsInkGate = this.tool !== 'select' && this.tool !== 'lasso'
    if (needsInkGate && !this.acceptPointer(e)) return

    this.activePointerId = e.pointerId
    this.capturePointer(e.pointerId)

    const p = this.eventToStrokePoint(e)

    if (this.tool === 'eraser') {
      this.beginEraseSession()
      this.eraseAt(p.x, p.y)
      return
    }
    if (this.tool === 'lasso') {
      this.lassoPolygon = [{ x: p.x, y: p.y }]
      return
    }
    if (this.tool === 'select') {
      this.beginSelectDrag(p, e.shiftKey, e.pointerId)
      if (!this.selectionDrag) {
        // No drag started (click on empty space / toggled selection) — release capture.
        this.activePointerId = null
        try { this.releasePointer(e.pointerId) } catch { /* already released */ }
      }
      return
    }

    // Drawing tools
    this.drawing = true
    this.currentPoints = [p]
    this.shapeStart = p
    this.armStrokeSilenceTimer()
    // Draw synchronously — rAF-starving hosts (occluded/headless previews) never fire it,
    // which would leave the in-flight stroke invisible until release.
    this.drawActive()
  }

  handlePointerMove(e: PointerEvent): void {
    if (this.panning) {
      const dx = e.clientX - this.panStart.x
      const dy = e.clientY - this.panStart.y
      this.viewport = { ...this.viewport, offsetX: this.panStart.offsetX + dx, offsetY: this.panStart.offsetY + dy }
      this.emit({ type: 'viewport-changed', viewport: this.getViewport() })
      this.renderAll()
      return
    }
    if (!this.page) return

    // Coalesced events carry the full 240 Hz stylus stream; some platforms
    // report an empty list — fall back to the event itself in that case.
    const coalescedRaw = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    const coalesced = coalescedRaw.length > 0 ? coalescedRaw : [e]

    // Gesture-state gating: if a freehand/shape gesture is open, any movement
    // extends it — regardless of pointerId. Huion tablets report hover and
    // contact with different pointerIds, so strict id equality stalls at the
    // initial dot for those devices. Touch is still filtered by palm rejection.
    if (this.drawing && this.isFreehandToolOrShape() && !this.isRejectedTouchDevice(e)) {
      for (const ev of coalesced) {
        if (this.isFreehandTool()) {
          this.currentPoints.push(this.eventToStrokePoint(ev))
        } else {
          // Shapes: only the live endpoint matters.
          this.currentPoints = [this.shapeStart!, this.eventToStrokePoint(ev)]
        }
      }
      this.armStrokeSilenceTimer()
      this.lastPressureInfo(coalesced[coalesced.length - 1])
      this.drawActive()
      return
    }

    if (this.tool === 'eraser' && e.buttons === 1 && !this.isRejectedTouchDevice(e)) {
      for (const ev of coalesced) {
        const p = this.eventToStrokePoint(ev)
        this.eraseAt(p.x, p.y)
      }
      return
    }

    if (this.tool === 'lasso' && this.lassoPolygon.length > 0 && e.buttons === 1 && !this.isRejectedTouchDevice(e)) {
      for (const ev of coalesced) {
        const p = this.eventToStrokePoint(ev)
        const last = this.lassoPolygon[this.lassoPolygon.length - 1]
        if (Math.hypot(p.x - last.x, p.y - last.y) > 3) this.lassoPolygon.push({ x: p.x, y: p.y })
      }
      this.renderLasso()
      return
    }

    if (this.selectionDrag && e.buttons === 1) {
      const p = this.eventToStrokePoint(e)
      this.updateSelectDrag(p)
      return
    }

    this.lastPressureInfo(e)
  }

  /** Abandon an in-flight stroke (blur / tab switch) — no commit, no residue. */
  cancelStroke(): void {
    if (this.eraserSnapshot) {
      this.strokes = cloneStrokes(this.eraserSnapshot)
      this.eraserSnapshot = null
      this.renderInkLayer()
    }
    this.clearStrokeSilenceTimer()
    this.drawing = false
    this.activePointerId = null
    this.currentPoints = []
    this.shapeStart = null
    this.lassoPolygon = []
    this.selectionDrag = null
    this.ghostDelta = { dx: 0, dy: 0 }
    this.ghostScale = null
    this.clearActive()
    this.clearOverlay()
    this.renderInkLayer()
  }

  handlePointerUp(e: PointerEvent): void {
    if (this.panning) {
      this.panning = false
      this.releasePointer(e.pointerId)
      return
    }
    if (this.lassoPolygon.length > 0 && this.tool === 'lasso') {
      const ids = lassoSelect(this.strokes, this.lassoPolygon)
      this.lassoPolygon = []
      this.clearOverlay()
      this.setSelection(ids)
      this.activePointerId = null
      return
    }
    if (this.tool === 'eraser' && this.activePointerId === e.pointerId) {
      this.commitEraserBatch()
      this.activePointerId = null
      return
    }
    if (this.selectionDrag && e.pointerId === this.activePointerId) {
      this.commitSelectDrag()
      this.activePointerId = null
      return
    }
    if (!this.drawing) return

    this.clearStrokeSilenceTimer()
    this.releasePointer(e.pointerId)
    this.finishDrawingStroke()
  }

  handleWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0016)
      const target = this.ink ?? this.bg
      const rect = target!.getBoundingClientRect()
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
    } else if (e.shiftKey) {
      this.panBy(-e.deltaY, 0)
    } else {
      this.panBy(0, -e.deltaY)
    }
  }

  /* --------------------------------------------------------- internals */

  /**
   * Arm the stroke-silence watchdog. Some pens (notably Huion compatibility
   * mode in Chrome) report pointer moves extremely sparsely — with 200+ ms
   * gaps even during a drag. 180 ms split every pair of points into disjoint
   * single-point strokes ("dotted writing"). 1200 ms ends the gesture only
   * when motion truly stops — press-pause-split is still useful, and normal
   * devices end on pointerup long before the timer fires.
   */
  private armStrokeSilenceTimer(): void {
    if (this.strokeSilenceTimer !== null) window.clearTimeout(this.strokeSilenceTimer)
    this.strokeSilenceTimer = window.setTimeout(() => {
      this.strokeSilenceTimer = null
      this.finishDrawingStroke()
    }, 1200)
  }

  private clearStrokeSilenceTimer(): void {
    if (this.strokeSilenceTimer !== null) {
      window.clearTimeout(this.strokeSilenceTimer)
      this.strokeSilenceTimer = null
    }
  }

  /** Commit the in-flight drawing gesture (shared by pointerup and the silence watchdog). */
  private finishDrawingStroke(): void {
    if (!this.drawing) return
    this.clearStrokeSilenceTimer()
    this.drawing = false
    this.activePointerId = null

    if (this.isFreehandTool()) {
      const smoothed = smoothSamples(decimate(this.currentPoints), 2)
      const adjusted = this.velocityPressure ? synthesizePressureFromVelocity(smoothed) : smoothed
      if (adjusted.length > 0) this.commitFreehand(adjusted)
    } else if (this.shapeStart) {
      const end = this.currentPoints[this.currentPoints.length - 1]
      const dist = Math.hypot(end.x - this.shapeStart.x, end.y - this.shapeStart.y)
      if (dist > 4) this.commitShape(this.shapeStart, end)
    }
    this.currentPoints = []
    this.shapeStart = null
    this.clearActive()
  }

  private capturePointer(id: number): void {
    try { this.active?.setPointerCapture(id) } catch { /* synthetic or stale pointers may not capture */ }
  }

  private releasePointer(id: number): void {
    try { this.active?.releasePointerCapture(id) } catch { /* ignore */ }
  }

  private isFreehandTool(): boolean {
    return this.tool === 'pen' || this.tool === 'pencil' || this.tool === 'highlighter'
  }

  private isFreehandToolOrShape(): boolean {
    return this.isFreehandTool() || this.tool === 'shape' || this.tool === 'line' || this.tool === 'arrow'
  }

  /** Palm rejection for the move stream — mirror of acceptPointer() for pointermove. */
  private isRejectedTouchDevice(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false
    if (!this.palmRejection) return false
    if (this.penOnlyDrawing) return true
    return performance.now() - this.lastPenTime < 2000
  }

  private eventToStrokePoint(e: PointerEvent): StrokePoint {
    const p = this.screenToPage(e.clientX, e.clientY)
    const pressure = e.pointerType === 'mouse' ? (e.buttons === 1 ? 0.55 : 0) : e.pressure || 0.5
    return { x: p.x, y: p.y, pressure, tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0, t: performance.now() }
  }

  private lastPressureInfo(e: PointerEvent): void {
    this.emit({ type: 'point-info', pressure: e.pressure || 0, pointerType: e.pointerType, tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0 })
  }

  private drawActive(): void {
    const ctx = this.active?.getContext('2d')
    if (!ctx || !this.page) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.active!.width, this.active!.height)
    this.applyTransform(ctx)

    if (this.isFreehandTool()) {
      if (this.currentPoints.length === 0) return
      const tool = this.tool
      const width = this.style.width * (TOOL_FACTOR[tool] ?? 1)
      const opacity = TOOL_OPACITY[tool] ?? this.style.opacity
      const composite: GlobalCompositeOperation = tool === 'highlighter' ? 'multiply' : 'source-over'
      // Live preview uses the raw (decimated) samples; the committed stroke gets the full smoothing pass.
      const raw = decimate(this.currentPoints, 0.7)
      const previewPoints = this.velocityPressure ? synthesizePressureFromVelocity(raw) : raw
      renderFreehand(ctx, previewPoints, this.style.color, width, opacity, this.pressureGamma, composite)
    } else if (this.shapeStart && this.currentPoints.length > 0) {
      const end = this.currentPoints[this.currentPoints.length - 1]
      const preview: InkStroke = {
        ...this.makeBaseStroke(this.shapeStart, end),
        points: [this.shapeStart, end],
      }
      renderStroke(ctx, preview, this.pressureGamma)
    }
  }

  private makeBaseStroke(a: StrokePoint, b: StrokePoint): InkStroke {
    const tool = this.tool
    let kind: InkStroke['kind'] = 'free'
    if (tool === 'line') kind = 'line'
    else if (tool === 'arrow') kind = 'arrow'
    else if (tool === 'shape') kind = this.style.shapeKind
    return {
      id: uid(),
      pageId: this.page!.pageId,
      layerId: DEFAULT_LAYER_ID,
      kind,
      tool: this.isFreehandTool() ? tool : 'shape-tool',
      color: this.style.color,
      width: this.style.width * (TOOL_FACTOR[tool] ?? 1),
      opacity: TOOL_OPACITY[tool] ?? this.style.opacity,
      points: [a, b],
      arrowHead: tool === 'arrow',
      createdAt: Date.now(),
    }
  }

  private commitFreehand(points: StrokePoint[]): void {
    const stroke: InkStroke = {
      ...this.makeBaseStroke(points[0], points[points.length - 1]),
      kind: 'free',
      tool: this.tool,
      points,
    }
    this.pushCommand({ type: 'add', stroke })
    this.strokes.push(stroke)
    this.afterStrokesMutated()
  }

  private commitShape(a: StrokePoint, b: StrokePoint): void {
    const stroke: InkStroke = {
      ...this.makeBaseStroke(a, b),
      points: [a, b],
    }
    this.pushCommand({ type: 'add', stroke })
    this.strokes.push(stroke)
    this.afterStrokesMutated()
  }

  /**
   * Public eraser for the direct pipeline. Mutates the live stroke list.
   * In 'stroke' mode, any stroke whose outline is touched disappears whole;
   * in 'partial' mode, only points under the eraser are removed and freehand
   * strokes are split into the surviving runs. Shapes/lines are atomic in both
   * modes (they have only two anchors).
   */
  private eraseAt(x: number, y: number): void {
    if (!this.page) return
    const radius = 8 + this.style.width * 2
    let changed = false
    if (this.eraserMode === 'partial') {
      const next: InkStroke[] = []
      for (const s of this.strokes) {
        const pieces = splitStrokeByEraser(s, x, y, radius)
        if (pieces === UNCHANGED) {
          next.push(s)
          continue
        }
        changed = true
        next.push(...pieces)
      }
      if (changed) this.strokes = next
    } else {
      const kept = this.strokes.filter((s) => !strokeHitTest(x, y, radius, s))
      if (kept.length !== this.strokes.length) {
        this.strokes = kept
        changed = true
      }
    }
    if (changed) {
      this.selection.clear()
      this.renderInkLayer()
    }
  }

  /** Commit the whole eraser gesture as ONE undoable page replacement. */
  private commitEraserBatch(): void {
    const before = this.eraserSnapshot
    this.eraserSnapshot = null
    if (!before) return
    if (strokeSignature(before) === strokeSignature(this.strokes)) return
    const after = cloneStrokes(this.strokes)
    this.pushCommand({ type: 'replace-page', before, after })
    this.afterStrokesMutated()
  }

  private afterStrokesMutated(): void {
    if (this.page) this.page.strokes = this.strokes
    this.renderInkLayer()
    this.emit({ type: 'strokes-changed' })
    this.emit({ type: 'history-changed', canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 })
  }

  private pushCommand(cmd: Command): void {
    this.undoStack.push(cmd)
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
  }

  undo(): void {
    const cmd = this.undoStack.pop()
    if (!cmd) return
    this.applyInverse(cmd)
    this.redoStack.push(cmd)
    this.afterStrokesMutated()
    this.emit({ type: 'selection-changed', ids: [...this.selection] })
  }

  redo(): void {
    const cmd = this.redoStack.pop()
    if (!cmd) return
    this.applyForward(cmd)
    this.undoStack.push(cmd)
    this.afterStrokesMutated()
    this.emit({ type: 'selection-changed', ids: [...this.selection] })
  }

  private applyInverse(cmd: Command): void {
    switch (cmd.type) {
      case 'add':
        this.strokes = this.strokes.filter((s) => s.id !== cmd.stroke.id)
        break
      case 'remove-objects':
        // Reinsert from the back so earlier splices don't shift later indexes.
        for (const { stroke, index } of [...cmd.entries].sort((a, b) => b.index - a.index)) {
          this.strokes = [...this.strokes.slice(0, index), stroke, ...this.strokes.slice(index)]
        }
        break
      case 'replace-points':
        for (const entry of cmd.entries) {
          const s = this.strokes.find((st) => st.id === entry.id)
          if (s) s.points = entry.before.map((p) => ({ ...p }))
        }
        break
      case 'replace-page':
        this.strokes = cmd.before.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) }))
        break
    }
  }

  private applyForward(cmd: Command): void {
    switch (cmd.type) {
      case 'add':
        this.strokes = [...this.strokes, cmd.stroke]
        break
      case 'remove-objects': {
        const ids = new Set(cmd.entries.map((e) => e.stroke.id))
        this.strokes = this.strokes.filter((s) => !ids.has(s.id))
        break
      }
      case 'replace-points':
        for (const entry of cmd.entries) {
          const s = this.strokes.find((st) => st.id === entry.id)
          if (s) s.points = entry.after.map((p) => ({ ...p }))
        }
        break
      case 'replace-page':
        this.strokes = cmd.after.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) }))
        break
    }
  }

  /* -------------------------------------------------------- selection */

  clearSelection(): void {
    if (this.selection.size === 0) return
    this.selection.clear()
    this.renderInkLayer()
    this.clearOverlay()
    this.emit({ type: 'selection-changed', ids: [] })
  }

  setSelection(ids: string[]): void {
    this.selection = new Set(ids)
    this.renderInkLayer()
    this.renderSelectionOverlay()
    this.emit({ type: 'selection-changed', ids: [...this.selection] })
  }

  deleteSelection(): void {
    if (this.selection.size === 0) return
    const entries: { stroke: InkStroke; index: number }[] = []
    const kept: InkStroke[] = []
    for (let i = 0; i < this.strokes.length; i++) {
      const s = this.strokes[i]
      if (this.selection.has(s.id)) entries.push({ stroke: s, index: i })
      else kept.push(s)
    }
    this.strokes = kept
    this.pushCommand({ type: 'remove-objects', entries })
    this.selection.clear()
    this.afterStrokesMutated()
    this.emit({ type: 'selection-changed', ids: [] })
  }

  getSelectionBounds(): BBox | null {
    const selected = this.strokes.filter((s) => this.selection.has(s.id))
    if (selected.length === 0) return null
    let box = unionBBox(strokeBounds(selected[0]), strokeBounds(selected[0]))
    for (const s of selected.slice(1)) box = unionBBox(box, strokeBounds(s))
    return box
  }

  private beginSelectDrag(p: { x: number; y: number }, additive: boolean, pointerId: number): void {
    const bounds = this.getSelectionBounds()

    // Hit a resize handle?
    if (bounds) {
      const handle = this.hitSelectionHandle(p, bounds)
      if (handle) {
        this.activePointerId = pointerId
        this.selectionDrag = {
          mode: 'resize',
          handle,
          startPage: p,
          bbox: { ...bounds },
          snapshot: this.snapshotSelection(),
          delta: { dx: 0, dy: 0 },
          scale: null,
        }
        this.ghostScale = null
        this.ghostDelta = { dx: 0, dy: 0 }
        return
      }
    }

    // Hit an existing selection → start moving it.
    if (bounds && this.pointInBBox(p, bounds)) {
      this.activePointerId = pointerId
      this.selectionDrag = {
        mode: 'move',
        handle: null,
        startPage: p,
        bbox: { ...bounds },
        snapshot: this.snapshotSelection(),
        delta: { dx: 0, dy: 0 },
        scale: null,
      }
      this.ghostDelta = { dx: 0, dy: 0 }
      this.ghostScale = null
      return
    }

    // Otherwise: click-select topmost stroke.
    const hit = this.topStrokeAt(p.x, p.y)
    if (hit) {
      if (additive) {
        if (this.selection.has(hit.id)) this.selection.delete(hit.id)
        else this.selection.add(hit.id)
        this.setSelection([...this.selection])
      } else {
        this.setSelection([hit.id])
      }
    } else if (!additive) {
      this.clearSelection()
    }
  }

  private updateSelectDrag(p: { x: number; y: number }): void {
    const drag = this.selectionDrag
    if (!drag) return
    if (drag.mode === 'move') {
      this.ghostDelta = { dx: p.x - drag.startPage.x, dy: p.y - drag.startPage.y }
      drag.delta = { ...this.ghostDelta }
      this.ghostScale = null
      drag.scale = null
    } else {
      const { bbox, handle } = drag
      const anchor = oppositeAnchor(bbox, handle!)
      const denomW = Math.max(bbox.maxX - bbox.minX, 1e-3)
      const denomH = Math.max(bbox.maxY - bbox.minY, 1e-3)
      let sx = drag.scale?.sx ?? 1
      let sy = drag.scale?.sy ?? 1
      if (handle!.includes('e') || handle!.includes('w')) {
        sx = (handle!.includes('e') ? p.x - anchor.x : anchor.x - p.x) / denomW
        sx = Math.max(Math.abs(sx), 0.05) * Math.sign(sx || 1)
      }
      if (handle!.includes('s') || handle!.includes('n')) {
        sy = (handle!.includes('s') ? p.y - anchor.y : anchor.y - p.y) / denomH
        sy = Math.max(Math.abs(sy), 0.05) * Math.sign(sy || 1)
      }
      this.ghostScale = { sx, sy, originX: anchor.x, originY: anchor.y }
      drag.scale = this.ghostScale
      this.ghostDelta = { dx: 0, dy: 0 }
      drag.delta = { dx: 0, dy: 0 }
    }
    this.renderSelectionGhost()
  }

  private commitSelectDrag(): void {
    const drag = this.selectionDrag
    if (!drag) {
      this.renderAll()
      return
    }
    const entries: ReplaceEntry[] = []
    for (const [id, before] of drag.snapshot) {
      const s = this.strokes.find((st) => st.id === id)
      if (!s) continue
      const after = this.transformPoints(before, drag)
      s.points = after
      entries.push({ id, before, after: after.map((p) => ({ ...p })) })
    }
    if (entries.length > 0) this.pushCommand({ type: 'replace-points', entries })
    this.selectionDrag = null
    this.ghostScale = null
    this.ghostDelta = { dx: 0, dy: 0 }
    this.afterStrokesMutated()
    this.renderSelectionOverlay()
  }

  private transformPoints(points: StrokePoint[], drag: NonNullable<typeof this.selectionDrag>): StrokePoint[] {
    const copy = points.map((p) => ({ ...p }))
    if (drag.mode === 'move') {
      for (const p of copy) {
        p.x += drag.delta.dx
        p.y += drag.delta.dy
      }
      return copy
    }
    const scale = drag.scale
    if (!scale) return copy
    for (const p of copy) {
      p.x = scale.originX + (p.x - scale.originX) * scale.sx
      p.y = scale.originY + (p.y - scale.originY) * scale.sy
    }
    return copy
  }

  private snapshotSelection(): Map<string, StrokePoint[]> {
    const map = new Map<string, StrokePoint[]>()
    for (const s of this.strokes) {
      if (this.selection.has(s.id)) map.set(s.id, s.points.map((p) => ({ ...p })))
    }
    return map
  }

  private topStrokeAt(x: number, y: number): InkStroke | null {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]
      if (strokeHitTest(x, y, 4, s)) return s
    }
    return null
  }

  private pointInBBox(p: { x: number; y: number }, b: BBox): boolean {
    return p.x >= b.minX - 2 && p.y >= b.minY - 2 && p.x <= b.maxX + 2 && p.y <= b.maxY + 2
  }

  private hitSelectionHandle(p: { x: number; y: number }, bounds: BBox): string | null {
    const handles = selectionHandles(bounds)
    const grab = 10 / this.viewport.zoom
    for (const h of handles) {
      if (Math.abs(p.x - h.x) <= grab && Math.abs(p.y - h.y) <= grab) return h.id
    }
    return null
  }

  private renderSelectionOverlay(): void {
    this.clearOverlay()
    const ctx = this.overlay?.getContext('2d')
    if (!ctx) return
    const bounds = this.getSelectionBounds()
    if (!bounds) return
    this.applyTransform(ctx)

    ctx.save()
    ctx.strokeStyle = '#7c6cf6'
    ctx.lineWidth = 1.6 / this.viewport.zoom
    ctx.setLineDash([6 / this.viewport.zoom, 4 / this.viewport.zoom])
    ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    ctx.restore()

    for (const h of selectionHandles(bounds)) {
      ctx.save()
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#7c6cf6'
      ctx.lineWidth = 1.4 / this.viewport.zoom
      const r = 4.5 / this.viewport.zoom
      ctx.beginPath()
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }

  private renderSelectionGhost(): void {
    const ctx = this.overlay?.getContext('2d')
    if (!ctx || !this.selectionDrag) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay!.width, this.overlay!.height)
    this.applyTransform(ctx)

    const drag = this.selectionDrag
    for (const [id, before] of drag.snapshot) {
      const stroke = this.strokes.find((s) => s.id === id)
      if (!stroke) continue
      const ghostStroke: InkStroke = {
        ...stroke,
        points: this.transformPoints(before.map((p) => ({ ...p })), drag),
        opacity: Math.min(stroke.opacity + 0.15, 1),
      }
      renderStroke(ctx, ghostStroke, this.pressureGamma)
    }
    // Ghost bounding box with handles
    const b = drag.bbox
    const corners = drag.mode === 'move'
      ? translateBox(b, this.ghostDelta)
      : scaleBox(b, this.ghostScale)
    ctx.save()
    ctx.strokeStyle = '#7c6cf6'
    ctx.lineWidth = 1.4 / this.viewport.zoom
    ctx.setLineDash([5 / this.viewport.zoom, 4 / this.viewport.zoom])
    ctx.strokeRect(corners.minX, corners.minY, corners.maxX - corners.minX, corners.maxY - corners.minY)
    ctx.restore()
  }

  private renderLasso(): void {
    const ctx = this.overlay?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay!.width, this.overlay!.height)
    if (this.lassoPolygon.length < 2) return
    this.applyTransform(ctx)
    ctx.save()
    ctx.fillStyle = 'rgba(124, 108, 246, 0.14)'
    ctx.strokeStyle = '#8f81f8'
    ctx.lineWidth = 1.4 / this.viewport.zoom
    ctx.setLineDash([4 / this.viewport.zoom, 4 / this.viewport.zoom])
    ctx.beginPath()
    ctx.moveTo(this.lassoPolygon[0].x, this.lassoPolygon[0].y)
    for (const p of this.lassoPolygon.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

/* ------------------------------------------------------------- helpers */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Deep-copy helpers for the eraser snapshot/replace-page undo command. */
const cloneStroke = (s: InkStroke): InkStroke => ({
  ...s,
  points: s.points.map((p) => ({ ...p })),
})
const cloneStrokes = (arr: InkStroke[]): InkStroke[] => arr.map(cloneStroke)

const UNAFFECTED = Symbol('unaffected')
/** Sentinel meaning "stroke untouched by this eraser pass" — lets callers keep object identity. */
const UNCHANGED = UNAFFECTED as unknown as InkStroke[]

/** Compact signature for cheap stroke-page comparisons (undo-aware). */
const strokeSignature = (strokes: InkStroke[]): string =>
  strokes
    .map((s) => `${s.id}:${s.points.length}:${s.points[0]?.x.toFixed(1)},${s.points[0]?.y.toFixed(1)}:${s.points[s.points.length - 1]?.x.toFixed(1)},${s.points[s.points.length - 1]?.y.toFixed(1)}`)
    .join('|')

/**
 * Split a stroke around the eraser circle.
 * Returns UNCHANGED when no point/segment intersects, [] when everything is erased,
 * or the surviving runs (each keeping the original visual style).
 * Shapes/lines (2-anchor strokes) behave atomically: hit → removed whole.
 */
const splitStrokeByEraser = (stroke: InkStroke, x: number, y: number, radius: number): InkStroke[] | typeof UNCHANGED => {
  const rr = radius + stroke.width / 2

  // Quick reject: bounds of the stroke vs circle (bounding box)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (x < minX - rr || x > maxX + rr || y < minY - rr || y > maxY + rr) return UNCHANGED

  // For atomic (shape/line) strokes: whole hit removes the stroke, no point slicing.
  const isFreehand = stroke.points.length > 2 || stroke.kind === 'free'
  if (!isFreehand) {
    const hit = distanceToStroke(x, y, stroke) <= rr
    return hit ? [] : UNCHANGED
  }

  // Point-slice the freehand polyline into runs of survivors.
  const survivors: InkStroke[] = []
  let run: StrokePoint[] = []
  const flush = (): void => {
    if (run.length === 0) return
    survivors.push({
      ...stroke,
      id: stroke.points[0] === run[0] ? stroke.id : uid(),
      points: run,
      createdAt: stroke.createdAt,
    })
    run = []
  }
  for (const p of stroke.points) {
    if (Math.hypot(p.x - x, p.y - y) <= rr) {
      flush()
      continue
    }
    run.push(p)
  }
  flush()
  return survivors
}



const selectionHandles = (b: BBox): { id: string; x: number; y: number }[] => {
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return [
    { id: 'nw', x: b.minX, y: b.minY },
    { id: 'n', x: cx, y: b.minY },
    { id: 'ne', x: b.maxX, y: b.minY },
    { id: 'e', x: b.maxX, y: cy },
    { id: 'se', x: b.maxX, y: b.maxY },
    { id: 's', x: cx, y: b.maxY },
    { id: 'sw', x: b.minX, y: b.maxY },
    { id: 'w', x: b.minX, y: cy },
  ]
}

const oppositeAnchor = (b: BBox, handle: string): { x: number; y: number } => {
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  switch (handle) {
    case 'nw': return { x: b.maxX, y: b.maxY }
    case 'n': return { x: cx, y: b.maxY }
    case 'ne': return { x: b.minX, y: b.maxY }
    case 'e': return { x: b.minX, y: cy }
    case 'se': return { x: b.minX, y: b.minY }
    case 's': return { x: cx, y: b.minY }
    case 'sw': return { x: b.maxX, y: b.minY }
    case 'w': return { x: b.maxX, y: cy }
    default: return { x: cx, y: cy }
  }
}

const translateBox = (b: BBox, d: { dx: number; dy: number }): BBox => ({
  minX: b.minX + d.dx, minY: b.minY + d.dy, maxX: b.maxX + d.dx, maxY: b.maxY + d.dy,
})

const scaleBox = (b: BBox, s: { sx: number; sy: number; originX: number; originY: number } | null): BBox => {
  if (!s) return { ...b }
  const pts = [
    { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY },
  ].map((p) => ({ x: s.originX + (p.x - s.originX) * s.sx, y: s.originY + (p.y - s.originY) * s.sy }))
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

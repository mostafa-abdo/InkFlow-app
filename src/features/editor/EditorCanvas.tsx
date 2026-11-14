import { useEffect, useRef, type CSSProperties } from 'react'
import { DrawingEngine } from '../../engine/DrawingEngine'
import type { EngineEvent } from '../../engine/DrawingEngine'
import { renderTemplate } from '../../engine/templates'
import { renderFreehand, renderStroke } from '../../engine/strokeRenderer'
import { decimate } from '../../engine/smoothing'
import type { InkStroke, Page, PaperSpec, StrokePoint, ToolId } from '../../types'
import { useStore, selectCurrentNote, useCurrentPages } from '../../state/store'
import { repository } from '../../persistence/repository'
import { openPdf, renderPdfPage } from '../pdf/pdfService'
import { engineRef } from './engineRef'
import { publishPointerInfo } from './pointerBus'
import type * as pdfjs from 'pdfjs-dist'

/**
 * Hosts the 4-canvas stack (background / ink / active / overlay) and owns the
 * engine lifecycle: loading pages, autosaving (debounced + flushed on unload),
 * and wiring engine events into the app store.
 */

const canvasStyle: CSSProperties = { position: 'absolute', inset: 0 }

// Cache rasterized PDF pages — they don't change while the annotation session is open.
const pdfImageCache = new Map<string, HTMLCanvasElement>()

const loadPdfImage = async (pageId: string, assetId: string, pdfPage: number, targetWidth: number): Promise<HTMLCanvasElement | null> => {
  const cacheKey = `${pageId}:${targetWidth}`
  const cached = pdfImageCache.get(cacheKey)
  if (cached) return cached
  const asset = await repository.getAsset(assetId)
  if (!asset) return null
  const { doc }: { doc: pdfjs.PDFDocumentProxy } = await openPdf(asset.bytes)
  const canvas = await renderPdfPage(doc, pdfPage, targetWidth)

  pdfImageCache.set(cacheKey, canvas)
  return canvas
}

const SIMPLE_TOOL_FACTOR: Partial<Record<ToolId, number>> = { pencil: 0.85, highlighter: 4.6 }
const SIMPLE_TOOL_OPACITY: Partial<Record<ToolId, number>> = { pencil: 0.78, highlighter: 0.34 }

interface SimpleGesture {
  tool: ToolId
  start: StrokePoint
  points: StrokePoint[]
}

const SIMPLE_TOOLS: ReadonlySet<ToolId> = new Set(['pen', 'pencil', 'highlighter', 'eraser', 'shape', 'line', 'arrow'])

export default function EditorCanvas(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const inkRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const engineRefLocal = useRef<DrawingEngine | null>(null)
  const simpleRef = useRef<SimpleGesture | null>(null)
  // Custom cursor overlay — drawn directly on a top canvas so the cursor never disappears
  // (Windows Ink / touch-action:none hide the OS cursor over the drawing surface).
  const cursorRef = useRef<HTMLCanvasElement>(null)
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null)
  const pendingSaves = useRef(new Map<string, InkStroke[]>())
  const saveTimer = useRef<number | null>(null)

  const noteId = useStore((s) => s.currentNoteId)
  const pageIndex = useStore((s) => s.currentPageIndex)
  const note = useStore(selectCurrentNote)
  const pages = useCurrentPages()
  const strokeWidth = useStore((s) => s.strokeWidth)
  const strokeOpacity = useStore((s) => s.strokeOpacity)
  const color = useStore((s) => s.color)
  const shapeKind = useStore((s) => s.shapeKind)
  const tool = useStore((s) => s.tool)
  const settings = useStore((s) => s.settings)

  const currentPage: Page | null = pages[pageIndex] ?? pages[0] ?? null
  const paper: PaperSpec | null = currentPage ? (currentPage.paper ?? note?.paper ?? null) : null

  /* ------------------------------------------------------------ engine */

  const flushPending = async (): Promise<void> => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const pending = [...pendingSaves.current.entries()]
    pendingSaves.current.clear()
    if (pending.length === 0) return
    const { setSaveState } = useStore.getState()
    setSaveState('saving')
    try {
      for (const [pageId, strokes] of pending) {
        await repository.saveStrokes(pageId, strokes)
      }
      setSaveState('saved')
    } catch (err) {
      console.error('Autosave failed', err)
      // Re-queue — never silently drop unsaved ink.
      for (const [pageId, strokes] of pending) pendingSaves.current.set(pageId, strokes)
      setSaveState('error')
    }
  }

  // Draw the custom stylus/eraser cursor on the top overlay canvas.
  const drawCursorNow = (): void => {
    const canvas = cursorRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    // Reset to device pixels so clearRect covers the full canvas.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const p = cursorPosRef.current
    if (!p) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { tool, color, strokeWidth } = useStore.getState()
    ctx.lineWidth = 1.6
    if (tool === 'eraser') {
      // Eraser circle — matches the actual erase radius (8 + width*2) so you see exactly what disappears.
      const r = Math.max(10, 8 + strokeWidth * 2)
      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = '#1c1c22'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 1.4, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    if (tool === 'pen' || tool === 'pencil' || tool === 'highlighter') {
      // Cursor matches the actual stroke width (with the per-tool multiplier baked in).
      const factor = tool === 'highlighter' ? 4.6 : tool === 'pencil' ? 0.85 : 1
      const baseWidth = (strokeWidth || 3) * factor
      const r = Math.max(baseWidth / 2, 1.4)
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 1.4
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.stroke()
      return
    }
    // Crosshair for everything else (selection, shapes, lines…)
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y)
    ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8)
    ctx.stroke()
    ctx.strokeStyle = '#1c1c22'
    ctx.beginPath()
    ctx.moveTo(p.x - 8, p.y + 0.5); ctx.lineTo(p.x + 8, p.y + 0.5)
    ctx.moveTo(p.x + 0.5, p.y - 8); ctx.lineTo(p.x + 0.5, p.y + 8)
    ctx.stroke()
  }

  const onContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const canvas = cursorRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    cursorPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    drawCursorNow()
  }

  const onContainerPointerLeave = (): void => {
    cursorPosRef.current = null
    drawCursorNow()
  }

  const sizeCursorCanvas = (w: number, h: number): void => {
    const canvas = cursorRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    drawCursorNow()
  }

  const scheduleSave = (): void => {
    const engine = engineRef.current
    if (!engine) return
    const pageId = engine.getPageId()
    if (!pageId) return
    pendingSaves.current.set(pageId, engine.getStrokes())
    useStore.getState().setSaveState('pending')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flushPending(), useStore.getState().settings.autosaveMs)
  }

  // Create engine once
  useEffect(() => {
    const engine = new DrawingEngine()
    engineRefLocal.current = engine
    engineRef.current = engine
    if (import.meta.env.DEV) {
      // Debug/testing handle (development only).
      ;(window as unknown as { __inkflowEngine?: DrawingEngine }).__inkflowEngine = engine
    }
    engine.backgroundRenderer = (ctx, spec, w, h) => renderTemplate(ctx, spec, w, h)
    engine.attach(bgRef.current!, inkRef.current!, activeRef.current!, overlayRef.current!)

    // Initial size — don't rely on ResizeObserver's first delivery for correctness.
    const initialRect = containerRef.current!.getBoundingClientRect()
    engine.resize(initialRect.width, initialRect.height)
    sizeCursorCanvas(initialRect.width, initialRect.height)

    const off = engine.onEvent((e: EngineEvent) => {
      const { setSelectionCount, setHistory, setZoom } = useStore.getState()
      switch (e.type) {
        case 'strokes-changed':
          scheduleSave()
          break
        case 'selection-changed':
          setSelectionCount(e.ids.length)
          break
        case 'history-changed':
          setHistory(e.canUndo, e.canRedo)
          break
        case 'viewport-changed':
          setZoom(e.viewport.zoom)
          break
        case 'point-info':
          publishPointerInfo({ pressure: e.pressure, pointerType: e.pointerType, tiltX: e.tiltX, tiltY: e.tiltY })
          break
      }
    })

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) {
        engine.resize(rect.width, rect.height)
        sizeCursorCanvas(rect.width, rect.height)
      }
    })
    ro.observe(containerRef.current!)

    const pagehide = (): void => {
      void flushPending()
    }
    window.addEventListener('pagehide', pagehide)
    window.addEventListener('beforeunload', pagehide)

    // Safety net: never leave a stroke "stuck" when the pointer is released
    // outside the canvas or the window loses focus mid-gesture.
    const safetyPointerEnd = (e: PointerEvent): void => engineRefLocal.current?.handlePointerUp(e)
    const cancelOnBlur = (): void => engineRefLocal.current?.cancelStroke()
    window.addEventListener('pointerup', safetyPointerEnd, true)
    window.addEventListener('pointercancel', safetyPointerEnd, true)
    window.addEventListener('blur', cancelOnBlur)
    document.addEventListener('visibilitychange', cancelOnBlur)

    // Native wheel listener with passive:false so ctrl+wheel can prevent the
    // host webview's own zoom behavior.
    const wheelHandler = (e: WheelEvent): void => engine.handleWheel(e)
    const overlay = overlayRef.current!
    overlay.addEventListener('wheel', wheelHandler, { passive: false })

    return () => {
      off()
      ro.disconnect()
      window.removeEventListener('pagehide', pagehide)
      window.removeEventListener('beforeunload', pagehide)
      window.removeEventListener('pointerup', safetyPointerEnd, true)
      window.removeEventListener('pointercancel', safetyPointerEnd, true)
      window.removeEventListener('blur', cancelOnBlur)
      document.removeEventListener('visibilitychange', cancelOnBlur)
      overlay.removeEventListener('wheel', wheelHandler)
      void flushPending()
      engine.detach()
      engineRef.current = null
      engineRefLocal.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync style/tool/settings into the engine
  useEffect(() => {
    const engine = engineRefLocal.current
    if (!engine) return
    engine.setStyle({ color, width: strokeWidth, opacity: strokeOpacity, shapeKind })
    engine.setTool(tool)
    engine.palmRejection = settings.palmRejection
    engine.penOnlyDrawing = settings.penOnlyDrawing
    engine.setPressureGamma(settings.pressureGamma)
    engine.velocityPressure = settings.velocityPressure
    engine.eraserMode = settings.eraserMode
  }, [color, strokeWidth, strokeOpacity, shapeKind, tool, settings])

  // Load the active page (flushes pending autosave for the previous page first)
  useEffect(() => {
    const engine = engineRefLocal.current
    if (!engine || !note || !currentPage || !paper) return

    let cancelled = false
    void (async () => {
      try {
        await flushPending()
        const strokes = await repository.loadStrokes(currentPage.id)

        let pdfImage: HTMLCanvasElement | null = null
        if (currentPage.pdfPage != null && note.pdfAssetId) {
          pdfImage = await loadPdfImage(currentPage.id, note.pdfAssetId, currentPage.pdfPage, Math.round(paper.width * 1.6))
        }
        // Only the surviving (non-cancelled) run commits — strict-mode double-fires are cancelled above.
        if (cancelled || !engineRefLocal.current) return
        engine.loadPage(currentPage.id, strokes, paper, pdfImage)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[inkflow] load-page failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, currentPage?.id, paper?.template, paper?.spacing, paper?.background, paper?.width, paper?.height, currentPage?.paper, currentPage?.pdfPage])

  // Keyboard: space = pan
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        engineRefLocal.current?.setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') engineRefLocal.current?.setSpaceDown(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [])

  /* -------------------------------------------- Simple (direct) drawing path
     Used for pen/pencil/highlighter/eraser/shapes — the exact approach that
     works in the Pen Pad test surface (React props → canvas, no gates).        */

  /** Publish pointer info from the direct drawing pipeline (drives the status-bar pressure meter). */
  const publishDirectPointer = (e: PointerEvent): void => {
    const pressure = e.pressure || (e.pointerType === 'mouse' && e.buttons !== 0 ? 0.55 : 0)
    publishPointerInfo({ pressure, pointerType: e.pointerType, tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0 })
  }

  const toSimplePoint = (e: PointerEvent): StrokePoint => {
    const engine = engineRefLocal.current!
    const p = engine.screenToPage(e.clientX, e.clientY)
    const pressure = e.pointerType === 'mouse' ? (e.buttons === 1 ? 0.55 : 0) : (e.pressure || 0.5)
    return { x: p.x, y: p.y, pressure, tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0, t: e.timeStamp || performance.now() }
  }

  const drawActiveFrame = (): void => {
    const engine = engineRefLocal.current
    const gesture = simpleRef.current
    const canvas = activeRef.current
    if (!engine || !gesture || !canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const vp = engine.getViewport()
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    ctx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, dpr * vp.offsetX, dpr * vp.offsetY)
    const tool = gesture.tool
    const { color, width, opacity, shapeKind } = engine.getStyle()

    if (tool === 'pen' || tool === 'pencil' || tool === 'highlighter') {
      const baseWidth = width * (SIMPLE_TOOL_FACTOR[tool] ?? 1)
      const op = SIMPLE_TOOL_OPACITY[tool] ?? opacity
      const composite: GlobalCompositeOperation = tool === 'highlighter' ? 'multiply' : 'source-over'
      renderFreehand(ctx, decimate(gesture.points, 0.7), color, baseWidth, op, 1.35, composite)
      return
    }
    if (tool === 'eraser') return // eraser adds nothing visually; it erases live
    const kind: InkStroke['kind'] = tool === 'line' ? 'line' : tool === 'arrow' ? 'arrow' : shapeKind
    const preview: InkStroke = {
      id: 'preview',
      pageId: engine.getPageId() ?? '',
      layerId: 'layer-ink',
      kind,
      tool: 'shape-tool',
      color,
      width,
      opacity,
      points: [gesture.start, gesture.points[gesture.points.length - 1]],
      arrowHead: tool === 'arrow',
      createdAt: 0,
    }
    renderStroke(ctx, preview, 1.35)
  }

  const onDirectPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const engine = engineRefLocal.current
    if (!engine) return
    const tool = useStore.getState().tool
    if (!SIMPLE_TOOLS.has(tool)) return
    const native = e.nativeEvent
    publishDirectPointer(native)
    try { overlayRef.current?.setPointerCapture(native.pointerId) } catch { /* optional */ }
    const p = toSimplePoint(native)
    simpleRef.current = { tool, start: p, points: [p] }
    drawActiveFrame()
  }

  const onDirectPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const gesture = simpleRef.current
    const engine = engineRefLocal.current
    if (!gesture || !engine) return
    const native = e.nativeEvent as PointerEvent
    publishDirectPointer(native)
    const coalesced = typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0 ? native.getCoalescedEvents() : [native]
    const mode = gesture.tool

    if (mode === 'eraser') {
      // Collect all erase points from this batch and run ONE combined pass + repaint.
      const points = coalesced.map((ev) => toSimplePoint(ev as PointerEvent))
      engine.eraseAtPublic(points.map((p) => ({ x: p.x, y: p.y })))
      return
    }

    for (const ev of coalesced) {
      const p = toSimplePoint(ev as PointerEvent)
      if (mode === 'shape' || mode === 'line' || mode === 'arrow') {
        gesture.points = [gesture.start, p]
      } else {
        gesture.points.push(p)
      }
    }
    drawActiveFrame()
  }

  const onDirectPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const gesture = simpleRef.current
    const engine = engineRefLocal.current
    publishDirectPointer(e.nativeEvent as PointerEvent)
    if (!gesture || !engine) return
    simpleRef.current = null
    const active = activeRef.current
    if (active) {
      const ctx = active.getContext('2d')!
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, active.width, active.height)
    }
    if (gesture.tool === 'eraser') {
      engine.commitEraseAtPublic()
      return
    }
    if (gesture.tool === 'pen' || gesture.tool === 'pencil' || gesture.tool === 'highlighter') {
      engine.addExternalFreehandStroke(gesture.points)
      return
    }
    const kind: InkStroke['kind'] = gesture.tool === 'line' ? 'line' : gesture.tool === 'arrow' ? 'arrow' : engine.getStyle().shapeKind
    const end = gesture.points[gesture.points.length - 1]
    if (Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) > 4) {
      engine.addExternalShapeStroke(kind, gesture.start, end)
    }
  }

  const pointerHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => (SIMPLE_TOOLS.has(useStore.getState().tool) ? onDirectPointerDown(e) : engineRefLocal.current?.handlePointerDown(e.nativeEvent)),
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => (simpleRef.current ? onDirectPointerMove(e) : engineRefLocal.current?.handlePointerMove(e.nativeEvent)),
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => (simpleRef.current ? onDirectPointerUp(e) : engineRefLocal.current?.handlePointerUp(e.nativeEvent)),
    onPointerCancel: (e: React.PointerEvent<HTMLCanvasElement>) => (simpleRef.current ? onDirectPointerUp(e) : engineRefLocal.current?.handlePointerUp(e.nativeEvent)),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--stage)' }}
      onPointerMove={onContainerPointerMove}
      onPointerLeave={onContainerPointerLeave}
    >
      <canvas ref={bgRef} style={canvasStyle} />
      <canvas ref={inkRef} style={canvasStyle} />
      <canvas ref={activeRef} style={canvasStyle} />
      <canvas ref={overlayRef} style={{ ...canvasStyle, cursor: 'none' }} {...pointerHandlers} />
      <canvas ref={cursorRef} style={{ ...canvasStyle, pointerEvents: 'none' }} />
    </div>
  )
}

import type { InkStroke, StrokePoint } from '../types'
import { pressureScale } from './geometry'

/**
 * Canvas renderer for InkStroke objects.
 *
 * Callers are expected to set the canvas transform so that drawing happens in
 * *page coordinates* (i.e. ctx.setTransform(scale, 0, 0, scale, tx, ty)).
 *
 * Freehand strokes use per-segment widths derived from stylus pressure and
 * are outlined by round caps/joins. Strokes with opacity < 1 are rendered to
 * a shared scratch buffer (sized to the target canvas) first, so overlapping
 * segments of a highlighter stroke don't compound alpha.
 */

let scratch: HTMLCanvasElement | null = null
let scratchCtx: CanvasRenderingContext2D | null = null

const getScratch = (w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  if (!scratch || scratch.width !== w || scratch.height !== h) {
    scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = h
    scratchCtx = scratch.getContext('2d')!
  }
  return { canvas: scratch, ctx: scratchCtx! }
}

let dprWarned = false
const warnDpr = (): void => {
  if (!dprWarned) {
    dprWarned = true
    // eslint-disable-next-line no-console
    console.warn('InkFlow: target canvas exceeds scratch buffer limits')
  }
}

const drawVariableWidthPath = (
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  width: number,
  gamma: number,
  color: string,
): void => {
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = color

  if (points.length === 1) {
    const p = points[0]
    const w = width * pressureScale(p.pressure, gamma)
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(w / 2, 0.4), 0, Math.PI * 2)
    ctx.fill()
    return
  }

  // Draw segment-by-segment; width follows the segment's average pressure.
  // Round caps make consecutive segments blend into a continuous ribbon.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const w = width * pressureScale((a.pressure + b.pressure) / 2, gamma)
    ctx.lineWidth = Math.max(w, 0.4)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
}

/** Shape/line/arrow anchors live in points[0] and points[points.length - 1]. */
export const shapeAnchors = (stroke: InkStroke): [StrokePoint, StrokePoint] => {
  const pts = stroke.points
  return [pts[0], pts[pts.length - 1]]
}

const drawShape = (ctx: CanvasRenderingContext2D, stroke: InkStroke): void => {
  const [start, end] = shapeAnchors(stroke)
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.y - start.y)
  const cx = (start.x + end.x) / 2
  const cy = (start.y + end.y) / 2

  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (stroke.kind) {
    case 'rect':
      roundedRect(ctx, x, y, w, h, Math.min(10, Math.min(w, h) / 8))
      ctx.stroke()
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'triangle': {
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h)
      ctx.closePath()
      ctx.stroke()
      break
    }
    case 'diamond':
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.lineTo(x + w, cy)
      ctx.lineTo(cx, y + h)
      ctx.lineTo(x, cy)
      ctx.closePath()
      ctx.stroke()
      break
    case 'star':
      starPath(ctx, cx, cy, Math.min(w, h) / 2, Math.min(w, h) / 4.2)
      ctx.stroke()
      break
    case 'line':
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      break
    case 'arrow':
      drawArrow(ctx, start, end, stroke.width)
      break
    default:
      break
  }
}

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const starPath = (
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, outer: number, inner: number,
): void => {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const px = cx + radius * Math.cos(angle)
    const py = cy + radius * Math.sin(angle)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

const drawArrow = (
  ctx: CanvasRenderingContext2D,
  start: StrokePoint,
  end: StrokePoint,
  width: number,
): void => {
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const headLen = Math.max(12, width * 3.2)
  const spread = Math.PI / 7.5
  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(end.x - headLen * Math.cos(angle - spread), end.y - headLen * Math.sin(angle - spread))
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(end.x - headLen * Math.cos(angle + spread), end.y - headLen * Math.sin(angle + spread))
  ctx.stroke()
}

/** Render one committed stroke into ctx (page coordinate space). */
export const renderStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  pressureGamma: number,
): void => {
  const isHighlighter = stroke.tool === 'highlighter'
  const needsComposite = stroke.opacity < 0.99 || isHighlighter

  ctx.save()

  if (!needsComposite) {
    if (stroke.kind === 'free') {
      drawVariableWidthPath(ctx, stroke.points, stroke.width, pressureGamma, stroke.color)
    } else {
      drawShape(ctx, stroke)
    }
    ctx.restore()
    return
  }

  // Composite path: draw into a scratch canvas at the same transform, then
  // blit with alpha + optional multiply blend.
  const target = ctx.canvas
  if (target.width > 8192 || target.height > 8192) {
    warnDpr()
    // Fall back to direct drawing (alpha compounds, but output remains correct).
    ctx.globalAlpha = stroke.opacity
    if (stroke.kind === 'free') {
      drawVariableWidthPath(ctx, stroke.points, stroke.width, pressureGamma, stroke.color)
    } else {
      drawShape(ctx, stroke)
    }
    ctx.restore()
    return
  }

  const { canvas, ctx: sctx } = getScratch(target.width, target.height)
  const currentTransform = ctx.getTransform()
  sctx.save()
  sctx.clearRect(0, 0, canvas.width, canvas.height)
  sctx.setTransform(currentTransform)
  sctx.globalAlpha = 1
  sctx.globalCompositeOperation = 'source-over'
  if (stroke.kind === 'free') {
    drawVariableWidthPath(sctx, stroke.points, stroke.width, pressureGamma, stroke.color)
  } else {
    drawShape(sctx, stroke)
  }
  sctx.restore()

  ctx.globalAlpha = stroke.opacity
  ctx.globalCompositeOperation = isHighlighter ? 'multiply' : 'source-over'
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(canvas, 0, 0)

  ctx.restore()
}

/** Render a freehand preview stroke (already smoothed) — used for the active stroke layer. */
export const renderFreehand = (
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  color: string,
  width: number,
  opacity: number,
  pressureGamma: number,
  composite: GlobalCompositeOperation = 'source-over',
): void => {
  if (points.length === 0) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = composite
  drawVariableWidthPath(ctx, points, width, pressureGamma, color)
  ctx.restore()
}

/** SVG path-data for a freehand stroke (centre line). Used by the SVG exporter. */
export const strokeToSvgPath = (points: StrokePoint[]): string => {
  if (points.length === 0) return ''
  const fmt = (n: number): string => (Math.round(n * 10) / 10).toString()
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2
    const midY = (points[i].y + points[i + 1].y) / 2
    d += ` Q ${fmt(points[i].x)} ${fmt(points[i].y)} ${fmt(midX)} ${fmt(midY)}`
  }
  const last = points[points.length - 1]
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`
  return d
}

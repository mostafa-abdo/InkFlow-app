import type { InkStroke, StrokePoint } from '../types'
import {
  emptyBBox,
  expandBBox,
  distToSegment,
  segmentsIntersect,
  pointInPolygon,
  type BBox,
} from './geometry'
import { shapeAnchors } from './strokeRenderer'

/**
 * Hit-testing for selection, erasing and lasso.
 * Freehand strokes are tested as polylines against a query point/circle;
 * vector shapes are reduced to outline polylines via {@link outlinePoints}.
 */

export const strokeBounds = (stroke: InkStroke, pad = 0): BBox => {
  const b = emptyBBox()
  for (const p of stroke.points) expandBBox(b, p.x, p.y, pad + stroke.width / 2)
  return b
}

const regularPolygon = (cx: number, cy: number, radius: number, sides: number, rot = -Math.PI / 2): StrokePoint[] => {
  const pts: StrokePoint[] = []
  for (let i = 0; i <= sides; i++) {
    const a = rot + (2 * Math.PI * (i % sides)) / sides
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), pressure: 1, tiltX: 0, tiltY: 0, t: 0 })
  }
  return pts
}

/** Reduce any stroke kind to an outline polyline (closed for shapes). */
export const outlinePoints = (stroke: InkStroke): StrokePoint[] => {
  const [start, end] = shapeAnchors(stroke)
  const pt = (x: number, y: number): StrokePoint => ({ x, y, pressure: 1, tiltX: 0, tiltY: 0, t: 0 })
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.y - start.y)
  const cx = (start.x + end.x) / 2
  const cy = (start.y + end.y) / 2

  switch (stroke.kind) {
    case 'rect':
      return [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h), pt(x, y)]
    case 'ellipse':
      return regularPolygon(cx, cy, 1, 48).map((p) =>
        pt(cx + (p.x - cx) * (w / 2), cy + (p.y - cy) * (h / 2)),
      )
    case 'triangle':
      return [pt(cx, y), pt(x + w, y + h), pt(x, y + h), pt(cx, y)]
    case 'diamond':
      return [pt(cx, y), pt(x + w, cy), pt(cx, y + h), pt(x, cy), pt(cx, y)]
    case 'star': {
      const pts: StrokePoint[] = []
      const outer = Math.min(w, h) / 2
      const inner = outer / 2.1
      for (let i = 0; i <= 10; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = (Math.PI / 5) * (i % 10) - Math.PI / 2
        pts.push(pt(cx + r * Math.cos(a), cy + r * Math.sin(a)))
      }
      return pts
    }
    case 'line':
    case 'arrow':
      return [start, end]
    default:
      return stroke.points
  }
}

/** Minimum distance from a query point to the stroke's visible geometry. */
export const distanceToStroke = (x: number, y: number, stroke: InkStroke): number => {
  const pts = stroke.kind === 'free' ? stroke.points : outlinePoints(stroke)
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y)
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y)
    if (d < best) best = d
  }
  return best
}

/** True when the query circle (radius r) touches the stroke. */
export const strokeHitTest = (x: number, y: number, r: number, stroke: InkStroke): boolean =>
  distanceToStroke(x, y, stroke) <= r + stroke.width / 2

/** Ids of strokes selected by a lasso polygon. */
export const lassoSelect = (strokes: InkStroke[], polygon: { x: number; y: number }[]): string[] => {
  if (polygon.length < 3) return []
  const selected = new Set<string>()
  for (const stroke of strokes) {
    const pts = stroke.kind === 'free' ? stroke.points : outlinePoints(stroke)
    let insideCount = 0
    for (const p of pts) if (pointInPolygon(p.x, p.y, polygon)) insideCount++
    if (insideCount > 0) {
      selected.add(stroke.id)
      continue
    }
    // Any lasso edge crossing a stroke segment also selects it.
    let crossed = false
    for (let i = 1; i < pts.length && !crossed; i++) {
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j]
        const b = polygon[(j + 1) % polygon.length]
        if (segmentsIntersect(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, a.x, a.y, b.x, b.y)) {
          crossed = true
          break
        }
      }
    }
    if (crossed) selected.add(stroke.id)
  }
  return [...selected]
}

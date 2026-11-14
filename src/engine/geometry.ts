import type { StrokePoint } from '../types'

/** Small vector helpers on page-space coordinates. */
export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const emptyBBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })

export const expandBBox = (b: BBox, x: number, y: number, pad = 0): void => {
  if (x - pad < b.minX) b.minX = x - pad
  if (y - pad < b.minY) b.minY = y - pad
  if (x + pad > b.maxX) b.maxX = x + pad
  if (y + pad > b.maxY) b.maxY = y + pad
}

export const unionBBox = (a: BBox, b: BBox): BBox => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
})

export const bboxValid = (b: BBox): boolean => b.minX !== Infinity

export const translateBBox = (b: BBox, dx: number, dy: number): BBox => ({
  minX: b.minX + dx,
  minY: b.minY + dy,
  maxX: b.maxX + dx,
  maxY: b.maxY + dy,
})

export const distance = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by)

export const distToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const abx = bx - ax
  const aby = by - ay
  const lengthSq = abx * abx + aby * aby
  if (lengthSq === 0) return distance(px, py, ax, ay)
  let t = ((px - ax) * abx + (py - ay) * aby) / lengthSq
  t = Math.max(0, Math.min(1, t))
  return distance(px, py, ax + t * abx, ay + t * aby)
}

/** Ray-casting point-in-polygon. Polygon given as flat [{x,y}...]. */
export const pointInPolygon = (x: number, y: number, poly: { x: number; y: number }[]): boolean => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export const segmentsIntersect = (
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean => {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

/** Pressure-aware width multiplier: maps 0..1 → [minFactor, 1]. */
export const pressureScale = (pressure: number, gamma: number, minFactor = 0.18): number => {
  const p = Math.max(0, Math.min(1, pressure))
  return minFactor + (1 - minFactor) * Math.pow(p, gamma)
}

export const pointsBBox = (points: StrokePoint[], pad = 0): BBox => {
  const b = emptyBBox()
  for (const p of points) expandBBox(b, p.x, p.y, pad)
  return b
}

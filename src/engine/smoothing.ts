import type { StrokePoint } from '../types'

/**
 * Stroke smoothing pipeline.
 *
 * 1. `decimate` drops samples that are too close together (or too close in time),
 *    which is essential for stylus hardware that reports at 200+ Hz.
 * 2. `smoothSamples` applies a small centred moving average to position only
 *    (pressure is preserved) to kill quantisation jitter from digitisers.
 * 3. Rendering uses quadratic curves through segment midpoints
 *    (see strokeRenderer.ts) which converts a polyline into a smooth curve.
 */

export const decimate = (points: StrokePoint[], minDistance = 1.4, minTimeMs = 2): StrokePoint[] => {
  if (points.length <= 2) return points.slice()
  const out: StrokePoint[] = [points[0]]
  let last = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const dx = p.x - last.x
    const dy = p.y - last.y
    const d2 = dx * dx + dy * dy
    if (d2 >= minDistance * minDistance || p.t - last.t >= minTimeMs) {
      out.push(p)
      last = p
    }
  }
  out.push(points[points.length - 1])
  return out
}

/** Centred moving average over position (radius in samples). Pressure untouched. */
export const smoothSamples = (points: StrokePoint[], radius = 2): StrokePoint[] => {
  const n = points.length
  if (n <= 2 || radius <= 0) return points.slice()
  const out = new Array<StrokePoint>(n)
  for (let i = 0; i < n; i++) {
    let sx = 0
    let sy = 0
    let count = 0
    for (let k = -radius; k <= radius; k++) {
      const j = i + k
      if (j < 0 || j >= n) continue
      sx += points[j].x
      sy += points[j].y
      count++
    }
    out[i] = { ...points[i], x: sx / count, y: sy / count }
  }
  return out
}

export const smoothStroke = (points: StrokePoint[]): StrokePoint[] =>
  smoothSamples(decimate(points), 2)

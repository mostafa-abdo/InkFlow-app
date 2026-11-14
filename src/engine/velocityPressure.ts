import type { StrokePoint } from '../types'

/**
 * Velocity-based pressure synthesis.
 *
 * Styluses that report constant (or no) pressure — common when a pen runs in
 * mouse-compatibility mode, or in browsers without Windows Ink routed —
 * produce uniform-width strokes, which look dead. This synthesizes a natural
 * profile from drawing speed: slow movement → firm press, fast flicks →
 * light touch.
 *
 * Real pressure readings always win: if the pressure range across the stroke
 * is meaningful, the points are returned untouched.
 */

export interface VelocityPressureOptions {
  /** Pressure target for very slow strokes (firm) */
  slowPressure?: number
  /** Pressure target for very fast strokes (light) */
  fastPressure?: number
  /** Minimum pressure range that counts as a working pressure sensor */
  minVariation?: number
}

export const synthesizePressureFromVelocity = (
  points: StrokePoint[],
  { slowPressure = 0.88, fastPressure = 0.3, minVariation = 0.15 }: VelocityPressureOptions = {},
): StrokePoint[] => {
  if (points.length < 3) return points

  const pressures = points.map((p) => p.pressure)
  const range = Math.max(...pressures) - Math.min(...pressures)
  if (range > minVariation) return points // sensor is live — leave it alone

  const out = points.map((p) => ({ ...p }))
  let smoothedSpeed = 0
  const SMOOTH = 0.72 // EMA inertia — kills jitter between samples
  const LOG_MIN = Math.log(0.08) // ≈ 8 page-units/s — crawl
  const LOG_MAX = Math.log(2.6) // ≈ 260 page-units/s — fast flick

  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]
    const b = out[i]
    const dt = Math.max(b.t - a.t, 0.5)
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const instant = dist / dt
    smoothedSpeed = smoothedSpeed === 0 ? instant : smoothedSpeed * SMOOTH + instant * (1 - SMOOTH)

    const t = Math.min(1, Math.max(0, (Math.log(Math.max(smoothedSpeed, 1e-3)) - LOG_MIN) / (LOG_MAX - LOG_MIN)))
    // Slow → slowPressure (heavy) · Fast → fastPressure (light)
    out[i] = { ...b, pressure: slowPressure + (fastPressure - slowPressure) * t }
  }

  // Anchor the first point to its neighbour so stroke entry isn't a cliff.
  out[0] = { ...out[0], pressure: (out[0].pressure + out[1].pressure) / 2 }
  return out
}

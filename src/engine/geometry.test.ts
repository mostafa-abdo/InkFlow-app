import { describe, expect, it } from 'vitest'
import { distToSegment, distance, pointInPolygon, pressureScale, pointsBBox } from './geometry'
import type { StrokePoint } from '../types'

const pt = (x: number, y: number, pressure = 0.5): StrokePoint => ({
  x,
  y,
  pressure,
  tiltX: 0,
  tiltY: 0,
  t: 0,
})

describe('distToSegment', () => {
  it('returns the perpendicular distance for points projecting onto the segment', () => {
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBe(5)
    expect(distToSegment(0, 5, 0, 0, 10, 0)).toBe(5)
  })

  it('clamps to segment endpoints', () => {
    expect(distToSegment(-5, 0, 0, 0, 10, 0)).toBe(5)
    expect(distToSegment(15, 0, 0, 0, 10, 0)).toBe(5)
  })

  it('handles degenerate (point) segments', () => {
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBe(5)
  })
})

describe('distance', () => {
  it('computes euclidean distance', () => {
    expect(distance(0, 0, 3, 4)).toBe(5)
  })
})

describe('pointInPolygon', () => {
  const square = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)]

  it('detects interior points', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true)
  })

  it('rejects exterior points', () => {
    expect(pointInPolygon(15, 5, square)).toBe(false)
    expect(pointInPolygon(-1, -1, square)).toBe(false)
    expect(pointInPolygon(5, 15, square)).toBe(false)
  })

  it('handles concave polygons', () => {
    const concave = [pt(0, 0), pt(10, 0), pt(10, 10), pt(5, 5), pt(0, 10)]
    expect(pointInPolygon(5, 2, concave)).toBe(true) // above the notch
    expect(pointInPolygon(5, 8, concave)).toBe(false) // inside the notch
  })
})

describe('pressureScale', () => {
  it('produces smallest width at zero pressure and full width at pressure 1', () => {
    expect(pressureScale(0, 1.35)).toBeCloseTo(0.18, 5)
    expect(pressureScale(1, 1.35)).toBeCloseTo(1, 5)
  })

  it('is monotonically increasing for typical gamma values', () => {
    const values = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => pressureScale(p, 1.35))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it('clamps out-of-range input', () => {
    expect(pressureScale(-1, 1.35)).toBeCloseTo(0.18, 5)
    expect(pressureScale(2, 1.35)).toBeCloseTo(1, 5)
  })
})

describe('pointsBBox', () => {
  it('bounds all points with optional padding', () => {
    const box = pointsBBox([pt(0, 0), pt(10, 20), pt(-5, 7)], 2)
    expect(box).toEqual({ minX: -7, minY: -2, maxX: 12, maxY: 22 })
  })
})

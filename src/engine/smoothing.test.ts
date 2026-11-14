import { describe, expect, it } from 'vitest'
import { decimate, smoothSamples, smoothStroke } from './smoothing'
import type { StrokePoint } from '../types'

const pt = (x: number, y: number, pressure = 0.5, t = 0): StrokePoint => ({
  x,
  y,
  pressure,
  tiltX: 0,
  tiltY: 0,
  t,
})

describe('decimate', () => {
  it('keeps first and last points exactly', () => {
    const input = [pt(0, 0, 0.5, 0), pt(0.2, 0.1, 0.6, 5), pt(0.4, 0.2, 0.7, 10), pt(30, 30, 0.9, 50)]
    const out = decimate(input, 1.4, 2)
    expect(out[0]).toEqual(input[0])
    expect(out[out.length - 1]).toEqual(input[input.length - 1])
  })

  it('drops samples that are too close together', () => {
    const input = Array.from({ length: 50 }, (_, i) => pt(i * 0.2, 0, 0.5, 0))
    const out = decimate(input, 1.4, Number.MAX_SAFE_INTEGER)
    expect(out.length).toBeLessThan(input.length)
    // Kept points must respect the minimum distance (except endpoints).
    for (let i = 1; i < out.length - 1; i++) {
      const previous = out[i - 1]
      expect(Math.hypot(out[i].x - previous.x, out[i].y - previous.y)).toBeGreaterThanOrEqual(1.4)
    }
  })

  it('keeps sparse strokes untouched', () => {
    const input = [pt(0, 0), pt(100, 100)]
    expect(decimate(input)).toEqual(input)
  })
})

describe('smoothSamples', () => {
  it('preserves pressure values untouched', () => {
    const input = [pt(0, 0, 0.1), pt(10, 10, 0.9), pt(20, 0, 0.3), pt(30, 10, 0.7)]
    const out = smoothSamples(input, 1)
    expect(out.map((p) => p.pressure)).toEqual([0.1, 0.9, 0.3, 0.7])
  })

  it('pulls outlier samples toward the trend line', () => {
    const input = [pt(0, 0), pt(10, 0), pt(20, 30), pt(30, 0), pt(40, 0)]
    const out = smoothSamples(input, 1)
    expect(out[2].y).toBeLessThan(30)
    expect(out[2].y).toBeGreaterThan(0)
  })

  it('keeps displacement within a small radius', () => {
    const input = Array.from({ length: 20 }, (_, i) => pt(i * 4, i % 2 === 0 ? 0 : 2))
    const out = smoothSamples(input, 2)
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(out[i].y - input[i].y)).toBeLessThanOrEqual(2)
    }
  })

  it('returns a copy for tiny inputs', () => {
    const input = [pt(1, 1), pt(2, 2)]
    expect(smoothSamples(input)).toEqual(input)
  })
})

describe('smoothStroke', () => {
  it('produces a non-empty result for realistic stylus input', () => {
    const input = Array.from({ length: 100 }, (_, i) => pt(i * 1.5, Math.sin(i / 8) * 20, 0.5 + (i % 10) / 20, i * 5))
    const out = smoothStroke(input)
    expect(out.length).toBeGreaterThan(2)
  })
})

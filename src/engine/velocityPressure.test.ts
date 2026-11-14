import { describe, expect, it } from 'vitest'
import { synthesizePressureFromVelocity } from './velocityPressure'
import type { StrokePoint } from '../types'

const pt = (x: number, y: number, t: number, pressure = 0.55): StrokePoint => ({
  x,
  y,
  pressure,
  tiltX: 0,
  tiltY: 0,
  t,
})

describe('synthesizePressureFromVelocity', () => {
  it('leaves real pressure readings untouched', () => {
    const input = [
      pt(0, 0, 0, 0.2),
      pt(10, 0, 10, 0.5),
      pt(20, 0, 20, 0.9),
      pt(30, 0, 30, 0.4),
    ]
    expect(synthesizePressureFromVelocity(input)).toBe(input)
  })

  it('synthesizes heavy pressure for slow strokes', () => {
    const input = [0, 1, 2, 3, 4, 5].map((i) => pt(i * 0.3, 0, i * 100)) // crawl
    const out = synthesizePressureFromVelocity(input)
    for (const p of out.slice(1)) {
      expect(p.pressure).toBeGreaterThan(0.75)
    }
  })

  it('synthesizes light pressure for fast flicks', () => {
    const input = [0, 1, 2, 3, 4, 5].map((i) => pt(i * 30, 0, i * 50)) // fast
    const out = synthesizePressureFromVelocity(input)
    for (const p of out.slice(1)) {
      expect(p.pressure).toBeLessThan(0.6)
    }
  })

  it('keeps a smooth transition through a crawl-to-flick speed change', () => {
    // Even when speed itself jumps discontinuously, pressure must not cliff.
    const input = Array.from({ length: 30 }, (_, i) => pt(i * (i < 15 ? 1 : 12), Math.sin(i) * 8, i * 30))
    const out = synthesizePressureFromVelocity(input)
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i].pressure - out[i - 1].pressure)).toBeLessThanOrEqual(0.4)
    }
  })

  it('ignores short paths safely', () => {
    const input = [pt(0, 0, 0), pt(10, 0, 10)]
    expect(synthesizePressureFromVelocity(input)).toBe(input)
  })
})

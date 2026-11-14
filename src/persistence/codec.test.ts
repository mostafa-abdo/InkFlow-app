import { describe, expect, it } from 'vitest'
import { encodeStrokes, decodeStrokes, bytesToBase64, base64ToBytes } from './codec'
import type { InkStroke } from '../types'
import { uid } from '../types'

const makeStroke = (id: string): InkStroke => ({
  id,
  pageId: 'page-1',
  layerId: 'layer-ink',
  kind: 'free',
  tool: 'pen',
  color: '#1b1bff',
  width: 3.25,
  opacity: 0.9,
  points: [
    { x: 10.25, y: 20.5, pressure: 0.5, tiltX: 11, tiltY: -5, t: 1000 },
    { x: 15.75, y: 26.25, pressure: 0.75, tiltX: 12, tiltY: -6, t: 1008 },
    { x: 21.5, y: 33.75, pressure: 1, tiltX: 13, tiltY: -7, t: 1016 },
  ],
  arrowHead: false,
  createdAt: 1700000000000,
})

describe('stroke codec', () => {
  it('round-trips strokes with quantized but faithful geometry', () => {
    const original = [makeStroke('a'), makeStroke('b')]
    const decoded = decodeStrokes(encodeStrokes(original))
    expect(decoded).toHaveLength(2)

    const first = decoded[0]
    expect(first.id).toBe('a')
    expect(first.color).toBe('#1b1bff')
    expect(first.width).toBe(3.25)
    expect(first.opacity).toBe(0.9)
    expect(first.points).toHaveLength(3)
    expect(first.points[0].x).toBeCloseTo(10.3, 1)
    expect(first.points[1].y).toBeCloseTo(26.3, 1)
    expect(first.points[2].pressure).toBe(1)
  })

  it('handles an empty stroke list', () => {
    expect(decodeStrokes(encodeStrokes([]))).toEqual([])
  })

  it('compresses meaningfully below raw JSON size', () => {
    const strokes = Array.from({ length: 60 }, (_, i) => makeStroke(`stroke-${i}`))
    const raw = JSON.stringify(strokes)
    const encoded = encodeStrokes(strokes)
    expect(encoded.byteLength).toBeLessThan(raw.length)
  })
})

describe('base64 helpers', () => {
  it('round-trips binary payloads', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('round-trips larger buffers', () => {
    const bytes = new Uint8Array(4096).map((_, i) => (i * 37) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

describe('stroke ids', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uid()))
    expect(ids.size).toBe(200)
  })
})

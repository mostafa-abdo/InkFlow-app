import { describe, expect, it } from 'vitest'
import { distanceToStroke, lassoSelect, strokeHitTest, strokeBounds } from './hitTest'
import type { InkStroke, StrokePoint } from '../types'
import { uid } from '../types'

const pt = (x: number, y: number, pressure = 0.5): StrokePoint => ({
  x,
  y,
  pressure,
  tiltX: 0,
  tiltY: 0,
  t: 0,
})

const freeStroke = (points: StrokePoint[], width = 4): InkStroke => ({
  id: uid(),
  pageId: 'page',
  layerId: 'layer-ink',
  kind: 'free',
  tool: 'pen',
  color: '#000000',
  width,
  opacity: 1,
  points,
  arrowHead: false,
  createdAt: 0,
})

const anchorStroke = (kind: InkStroke['kind'], a: [number, number], b: [number, number], width = 4): InkStroke => ({
  ...freeStroke([pt(a[0], a[1]), pt(b[0], b[1])], width),
  kind,
  tool: 'shape-tool',
})

describe('distanceToStroke', () => {
  it('computes the distance to a straight freehand stroke', () => {
    const stroke = freeStroke([pt(0, 0), pt(100, 0)])
    expect(distanceToStroke(50, 30, stroke)).toBeCloseTo(30, 5)
  })

  it('measures to shapes through outline points, not the anchor diagonal', () => {
    const rect = anchorStroke('rect', [0, 0], [100, 50])
    // The centre of the rectangle is far from its outline.
    expect(distanceToStroke(50, 25, rect)).toBeCloseTo(25, 0)
    expect(distanceToStroke(50, 5, rect)).toBeCloseTo(5, 0)
  })
})

describe('strokeHitTest', () => {
  it('hits strokes within the radius plus half stroke width', () => {
    const stroke = freeStroke([pt(0, 0), pt(100, 0)], 6)
    expect(strokeHitTest(50, 5, 3, stroke)).toBe(true)
    expect(strokeHitTest(50, 20, 3, stroke)).toBe(false)
  })
})

describe('strokeBounds', () => {
  it('includes the stroke width in the padding', () => {
    const stroke = freeStroke([pt(10, 10), pt(50, 40)], 8)
    const box = strokeBounds(stroke)
    expect(box.minX).toBeLessThanOrEqual(10 - 4)
    expect(box.maxX).toBeGreaterThanOrEqual(50 + 4)
  })
})

describe('lassoSelect', () => {
  const strokeA = freeStroke([pt(10, 10), pt(20, 15), pt(30, 10)])
  const strokeB = freeStroke([pt(200, 200), pt(210, 210)])

  it('selects strokes with points inside the lasso', () => {
    const lasso = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)]
    const ids = lassoSelect([strokeA, strokeB], lasso)
    expect(ids).toEqual([strokeA.id])
  })

  it('selects strokes crossed by a lasso edge', () => {
    const strokeC = freeStroke([pt(50, -50), pt(50, 150)]) // crosses the lasso boundary
    const lasso = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)]
    const ids = lassoSelect([strokeC], lasso)
    expect(ids).toEqual([strokeC.id])
  })

  it('returns nothing for a degenerate lasso', () => {
    expect(lassoSelect([strokeA], [pt(0, 0), pt(10, 10)])).toEqual([])
  })
})

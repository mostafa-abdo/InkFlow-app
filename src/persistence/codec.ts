import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate'
import type { InkStroke } from '../types'

/**
 * Efficient stroke serialization.
 *
 * Points are quantized (sub-pixel precision is meaningless) before encoding,
 * then the JSON payload is gzip-compressed with fflate. A dense 2,000-stroke
 * page lands around ~100–250 KB — orders of magnitude smaller than raw JSON.
 *
 * Format: Uint8Array = gzip( JSON.stringify({ v: 1, strokes }) )
 */

const QUANT = 10 // 0.1 page-unit precision

const quantizeStroke = (s: InkStroke): InkStroke => ({
  ...s,
  points: s.points.map((p) => ({
    x: Math.round(p.x * QUANT) / QUANT,
    y: Math.round(p.y * QUANT) / QUANT,
    pressure: Math.round(p.pressure * 100) / 100,
    tiltX: Math.round(p.tiltX),
    tiltY: Math.round(p.tiltY),
    t: Math.round(p.t),
  })),
})

export const encodeStrokes = (strokes: InkStroke[]): Uint8Array => {
  const payload = JSON.stringify({ v: 1, strokes: strokes.map(quantizeStroke) })
  return gzipSync(strToU8(payload), { level: 6 })
}

export const decodeStrokes = (bytes: Uint8Array): InkStroke[] => {
  const json = strFromU8(gunzipSync(bytes))
  const parsed = JSON.parse(json) as { v: number; strokes: InkStroke[] }
  if (!Array.isArray(parsed.strokes)) return []
  return parsed.strokes
}

/* ------------------------------------------------------- base64 helpers */

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

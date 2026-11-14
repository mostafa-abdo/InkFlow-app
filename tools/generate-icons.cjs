// One-off icon generator for InkFlow — draws the app mark programmatically and
// emits PNG (32/128/256/512) + a PNG-compressed .ico for the Windows bundle.
// Usage: node tools/generate-icons.cjs
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT_DIR = path.join(__dirname, '..', 'src-tauri', 'icons')
fs.mkdirSync(OUT_DIR, { recursive: true })

/* ------------------------------------------------------------ png encoder */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
const encodePng = (width, height, rgba) => {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------ the artwork */
// Signed-distance helpers (page-centered coordinates in [-1, 1]).
const roundedRectSD = (x, y, halfW, halfH, r) => {
  const qx = Math.abs(x) - (halfW - r)
  const qy = Math.abs(y) - (halfH - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}
const circleSD = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r
const triangleSD = (px, py, ax, ay, bx, by, cx, cy) => {
  // Distance to triangle boundary (negative inside).
  const sdLine = (x1, y1, x2, y2) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    return ((px - x1) * dy - (py - y1) * dx) / len
  }
  const d1 = sdLine(ax, ay, bx, by)
  const d2 = sdLine(bx, by, cx, cy)
  const d3 = sdLine(cx, cy, ax, ay)
  const inside = d1 >= 0 && d2 >= 0 && d3 >= 0
  const edgeDist = Math.min(Math.abs(d1), Math.abs(d2), Math.abs(d3))
  return inside ? -edgeDist : edgeDist
}
const smin = (a, b, k) => {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1)
  return b * (1 - h) + a * h - k * h * (1 - h)
}
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const smooth = (edge0, edge1, v) => {
  const t = clamp01((v - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t
const mixRGB = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)]

const VOILET_TOP = [0x8b, 0x7c, 0xf8]
const INDIGO_BOTTOM = [0x4a, 0x3f, 0xd8]
const DROPLET_HI = [0xff, 0xff, 0xff]
const DROPLET_LO = [0xd9, 0xd4, 0xff]

const renderPixel = (px, py, size) => {
  // Normalize to [-1, 1] with y down.
  const x = ((px + 0.5) / size) * 2 - 1
  const y = ((py + 0.5) / size) * 2 - 1

  // Background squircle with diagonal violet gradient.
  const bgD = roundedRectSD(x, y, 1.0, 1.0, 0.46)
  if (bgD > 1) return [0, 0, 0, 0]
  const bgAlpha = clamp01(1 - smooth(0, 0.025, bgD))
  const gT = (x + y + 2) / 4
  let col = mixRGB(VOILET_TOP, INDIGO_BOTTOM, gT)

  // Droplet: circle blended into an apex triangle (smooth union).
  const dCircle = circleSD(x, y, 0, 0.28, 0.40)
  const dTri = triangleSD(x, y, 0, -0.62, -0.36, 0.18, 0.36, 0.18)
  const dropD = smin(dCircle, dTri, 0.14)
  const dropAlpha = clamp01(1 - smooth(-0.02, 0.035, dropD))
  const dropGrad = clamp01(1 - (y + 0.62) / 1.1)
  const dropCol = mixRGB(DROPLET_LO, DROPLET_HI, dropGrad)
  col = mixRGB(col, dropCol, dropAlpha)

  // Inner shadow/edge: darken droplet rim slightly for depth.
  const rim = 1 - smooth(-0.09, 0.0, Math.abs(dropD + 0.045))
  col = mixRGB(col, [0x6d, 0x5c, 0xe8], rim * 0.55 * dropAlpha)

  // Small specular highlight on upper-left of the droplet.
  const spec = circleSD(x, y, -0.16, -0.02, 0.085)
  const specAlpha = clamp01(1 - smooth(0.0, 0.05, spec)) * 0.7
  col = mixRGB(col, DROPLET_HI, specAlpha)

  return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), Math.round(bgAlpha * 255)]
}

const renderSize = (size) => {
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = renderPixel(x, y, size)
      const o = (y * size + x) * 4
      buf[o] = r
      buf[o + 1] = g
      buf[o + 2] = b
      buf[o + 3] = a
    }
  }
  return buf
}

const sizes = [32, 128, 256, 512]
const pngs = {}
for (const size of sizes) {
  const png = encodePng(size, size, renderSize(size))
  pngs[size] = png
  fs.writeFileSync(path.join(OUT_DIR, `${size}x${size}.png`), png)
  if (size === 512) fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png)
  if (size === 256) fs.writeFileSync(path.join(OUT_DIR, '128x128@2x.png'), png)
}
// 128x128@1x
fs.writeFileSync(path.join(OUT_DIR, '128x128.png'), pngs[128])

/* ------------------------------------------------------------------ .ico */
// ICO with PNG-compressed images (valid on Vista+).
const icoSizes = [32, 128, 256]
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(icoSizes.length, 4)
const entries = []
let offset = 6 + icoSizes.length * 16
const images = []
for (const size of icoSizes) {
  const png = pngs[size]
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(offset, 12)
  entries.push(entry)
  images.push(png)
  offset += png.length
}
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), Buffer.concat([header, ...entries, ...images]))

console.log('icons written to', OUT_DIR)

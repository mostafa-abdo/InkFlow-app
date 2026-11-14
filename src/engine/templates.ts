import type { PaperSpec } from '../types'

/**
 * Page template renderer. Draws ruled/grid/dotted/cornell/planner patterns
 * into a ctx that is already in page coordinates, clipped to the paper rect.
 * Line color is derived from the paper background's luminance so templates
 * work on both light and custom/dark paper colors.
 */

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const m = hex.replace('#', '')
  const v = m.length === 3 ? m.split('').map((c) => parseInt(c + c, 16)) : [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ]
  return { r: v[0] ?? 255, g: v[1] ?? 255, b: v[2] ?? 255 }
}

const luminance = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex)
  const f = (c: number): number => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const lineColor = (bg: string, alpha: number): string =>
  luminance(bg) > 0.45
    ? `rgba(60, 66, 110, ${alpha})`
    : `rgba(220, 224, 255, ${alpha})`

export const renderTemplate = (
  ctx: CanvasRenderingContext2D,
  paper: PaperSpec,
  width: number,
  height: number,
): void => {
  const s = Math.max(8, paper.spacing)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()

  const minor = lineColor(paper.background, 0.32)
  const major = lineColor(paper.background, 0.5)
  const accent = lineColor(paper.background, 0.62)

  switch (paper.template) {
    case 'blank':
    case 'custom':
      break

    case 'ruled': {
      ctx.strokeStyle = minor
      ctx.lineWidth = 1
      // Baseline first line offset so writing sits nicely under the page top.
      for (let y = s; y < height; y += s) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      // Classic margin line
      ctx.strokeStyle = accent
      ctx.beginPath()
      ctx.moveTo(s * 2, 0)
      ctx.lineTo(s * 2, height)
      ctx.stroke()
      break
    }

    case 'grid': {
      ctx.strokeStyle = minor
      ctx.lineWidth = 1
      for (let x = s; x < width; x += s) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = s; y < height; y += s) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      // Bolder line every 5 cells
      ctx.strokeStyle = major
      for (let x = s * 5; x < width; x += s * 5) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke()
      }
      for (let y = s * 5; y < height; y += s * 5) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      }
      break
    }

    case 'dotted': {
      ctx.fillStyle = minor
      for (let x = s / 2; x < width; x += s) {
        for (let y = s / 2; y < height; y += s) {
          ctx.beginPath()
          ctx.arc(x, y, 1.35, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }

    case 'cornell': {
      // Left cue column ~30% with divider; summary area at the bottom ~18% with divider.
      const cueX = Math.round(width * 0.32)
      const summaryY = Math.round(height * 0.82)
      ctx.strokeStyle = accent
      ctx.lineWidth = 1.4
      ctx.beginPath(); ctx.moveTo(cueX, 0); ctx.lineTo(cueX, summaryY); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, summaryY); ctx.lineTo(width, summaryY); ctx.stroke()
      // Ruled lines in the notes area
      ctx.strokeStyle = minor
      ctx.lineWidth = 1
      for (let y = s; y < summaryY; y += s) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      }
      // A faint summary hint band
      ctx.fillStyle = lineColor(paper.background, 0.06)
      ctx.fillRect(0, summaryY, width, height - summaryY)
      break
    }

    case 'planner': {
      // Header band for the day/title
      const headerH = s * 1.6
      ctx.fillStyle = lineColor(paper.background, 0.09)
      ctx.fillRect(0, 0, width, headerH)
      ctx.strokeStyle = major
      ctx.lineWidth = 1.4
      ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(width, headerH); ctx.stroke()

      // Two columns: schedule | notes
      const colX = Math.round(width * 0.42)
      ctx.beginPath(); ctx.moveTo(colX, headerH); ctx.lineTo(colX, height); ctx.stroke()

      // Hourly rows with labels
      const firstHourY = headerH + s
      ctx.strokeStyle = minor
      ctx.lineWidth = 1
      ctx.font = `10px Inter, system-ui, sans-serif`
      ctx.fillStyle = lineColor(paper.background, 0.55)
      let hour = 6
      for (let y = firstHourY; y < height; y += s, hour++) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(colX, y); ctx.stroke()
        const label = hour % 12 === 0 ? `${12} ${hour >= 12 ? 'PM' : ''}` : `${hour % 12}`
        ctx.fillText(label, 6, y - s / 2 + 3)
      }
      // Right column: dotted notes grid
      ctx.fillStyle = minor
      for (let x = colX + s / 2; x < width; x += s) {
        for (let y = headerH + s / 2; y < height; y += s) {
          ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill()
        }
      }
      break
    }
  }

  ctx.restore()
}

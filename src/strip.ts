/*
 * Strip renderer — turns captured frames into an authentic photobooth strip,
 * modelled on real printed strips: photos set close with thin gaps, an elegant
 * script caption + date, and cute decorations (hearts, disco balls, silver
 * sequin top, stars/sparkles, or polaroid frames) for the romantic templates.
 *
 * A strip is a vertical sequence of ROWS. Each row holds one photo (solo /
 * "alternating" couple strip) or two side by side (a couple posing together).
 */

export type TemplateId = 'classic' | 'romantic' | 'cutesy' | 'sparkle' | 'polaroid' | 'film' | 'neon'
export type Row = HTMLCanvasElement[] // 1 or 2 photos

export interface StripOptions {
  template: TemplateId
  background?: string
  caption: string
  showDate: boolean
  double: boolean
  aspect?: number // photo width / height. Smaller = narrower strip. Default 4/3.
}

interface TemplateDef {
  label: string
  bg: string
  swatches: string[]
  photoBorder?: { color: string; w: number }
  keyline?: string
  polaroid?: boolean
  captionInk: string
  captionFont: string
  metaFont: string
  glow?: string
  deco: 'hearts' | 'disco' | 'sprockets' | 'cute' | 'none' | 'neon'
  topDeco?: 'sequin'
}

// Photo HEIGHT is fixed; width is derived from the chosen aspect, so a
// narrower aspect produces a narrower strip (like a real photobooth strip).
const CELL_H = 440

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  classic: {
    label: 'Classic', bg: '#ffffff', swatches: ['#ffffff', '#f5f1e8', '#111318', '#eef1ee', '#f6e7d8'],
    keyline: 'rgba(0,0,0,0.06)', captionInk: '#20242b',
    captionFont: '"Space Grotesk", sans-serif', metaFont: '"Space Grotesk", sans-serif', deco: 'none',
  },
  romantic: {
    label: 'Romantic', bg: '#fbeff0', swatches: ['#fbeff0', '#fff6f0', '#f3e1ea', '#f7ede2', '#ffffff'],
    keyline: 'rgba(150,90,110,0.18)', captionInk: '#b04a63',
    captionFont: '"Dancing Script", cursive', metaFont: '"Space Grotesk", sans-serif', deco: 'hearts',
  },
  cutesy: {
    label: 'Cutesy', bg: '#ffe6f0', swatches: ['#ffe6f0', '#f1e6ff', '#e6fff2', '#fff3e0', '#ffffff'],
    keyline: 'rgba(230,120,170,0.20)', captionInk: '#ff5fa2',
    captionFont: '"Dancing Script", cursive', metaFont: '"Space Grotesk", sans-serif', deco: 'cute',
  },
  sparkle: {
    label: 'Sparkle', bg: '#ffffff', swatches: ['#ffffff', '#faf7ff', '#0e0e14', '#fdeef4', '#f4f0e6'],
    keyline: 'rgba(0,0,0,0.06)', captionInk: '#2a2440',
    captionFont: '"Dancing Script", cursive', metaFont: '"Space Grotesk", sans-serif',
    deco: 'disco', topDeco: 'sequin',
  },
  polaroid: {
    label: 'Polaroid', bg: '#d8c6a8', swatches: ['#d8c6a8', '#e9e4da', '#111318', '#f3dfe6', '#c9d7cf'],
    polaroid: true, captionInk: '#3a342c',
    captionFont: '"Dancing Script", cursive', metaFont: '"Space Grotesk", sans-serif', deco: 'none',
  },
  film: {
    label: 'Film', bg: '#0e0e10', swatches: ['#0e0e10', '#141414', '#1a1712', '#0d1412'],
    photoBorder: { color: '#0e0e10', w: 6 }, keyline: 'rgba(255,255,255,0.14)', captionInk: '#f2f2f2',
    captionFont: '"Courier New", monospace', metaFont: '"Courier New", monospace', deco: 'sprockets',
  },
  neon: {
    label: 'Neon', bg: '#14142a', swatches: ['#14142a', '#0a0a1a', '#1c1030', '#0b1a24'],
    photoBorder: { color: '#ff2e97', w: 8 }, captionInk: '#22e0ff', glow: '#ff2e97',
    captionFont: '"Press Start 2P", monospace', metaFont: '"Space Grotesk", sans-serif', deco: 'neon',
  },
}

export const TEMPLATE_ORDER: TemplateId[] = ['classic', 'romantic', 'cutesy', 'sparkle', 'polaroid', 'film', 'neon']
const SCRIPT_FOOTER: TemplateId[] = ['romantic', 'cutesy', 'sparkle']

export function getFilterCss(key: string): string {
  switch (key) {
    case 'bw': return 'grayscale(1)'
    case 'noir': return 'grayscale(1) contrast(1.5) brightness(0.95)'
    case 'sepia': return 'sepia(0.85)'
    case 'vintage': return 'sepia(0.4) saturate(1.35) contrast(1.03) brightness(1.06)'
    case 'cool': return 'saturate(1.15) hue-rotate(-12deg) brightness(1.03)'
    default: return 'none'
  }
}

function dateStamp(): string {
  const d = new Date()
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function coverDraw(g: CanvasRenderingContext2D, src: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const sr = src.width / src.height, cr = w / h
  let sx = 0, sy = 0, sw = src.width, sh = src.height
  if (sr > cr) { sw = src.height * cr; sx = (src.width - sw) / 2 }
  else { sh = src.width / cr; sy = (src.height - sh) / 2 }
  g.drawImage(src, sx, sy, sw, sh, x, y, w, h)
}

function heart(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, fill: string) {
  g.save(); g.beginPath()
  g.moveTo(cx, cy + s * 0.35)
  g.bezierCurveTo(cx, cy + s * 0.05, cx - s, cy - s * 0.1, cx - s, cy - s * 0.55)
  g.bezierCurveTo(cx - s, cy - s * 1.05, cx - s * 0.35, cy - s * 1.1, cx, cy - s * 0.62)
  g.bezierCurveTo(cx + s * 0.35, cy - s * 1.1, cx + s, cy - s * 1.05, cx + s, cy - s * 0.55)
  g.bezierCurveTo(cx + s, cy - s * 0.1, cx, cy + s * 0.05, cx, cy + s * 0.35)
  g.closePath(); g.fillStyle = fill; g.fill(); g.restore()
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string) {
  g.save(); g.beginPath()
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
    const a2 = a + Math.PI / 5
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    g.lineTo(cx + Math.cos(a2) * r * 0.44, cy + Math.sin(a2) * r * 0.44)
  }
  g.closePath(); g.fillStyle = fill; g.fill(); g.restore()
}

function sparkle4(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string) {
  g.save(); g.beginPath()
  g.moveTo(cx, cy - r); g.quadraticCurveTo(cx, cy, cx + r, cy)
  g.quadraticCurveTo(cx, cy, cx, cy + r); g.quadraticCurveTo(cx, cy, cx - r, cy)
  g.quadraticCurveTo(cx, cy, cx, cy - r); g.closePath()
  g.fillStyle = fill; g.fill(); g.restore()
}

function discoBall(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.strokeStyle = '#9aa6b3'; g.lineWidth = Math.max(1, r * 0.08)
  g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx, cy - r * 1.7); g.stroke()
  const grd = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r)
  grd.addColorStop(0, '#eef6ff'); grd.addColorStop(0.55, '#9fb4c6'); grd.addColorStop(1, '#5b6c7b')
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = grd; g.fill()
  g.save(); g.beginPath(); g.arc(cx, cy, r * 0.98, 0, Math.PI * 2); g.clip()
  const n = 7, s = (r * 2) / n
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 150 + ((i * 7 + j * 13 + i * j) % 9) * 12
    g.fillStyle = `rgba(${Math.min(255, v + 30)},${Math.min(255, v + 45)},${Math.min(255, v + 60)},0.55)`
    g.fillRect(cx - r + i * s + 1, cy - r + j * s + 1, s - 2, s - 2)
  }
  g.restore()
  g.beginPath(); g.arc(cx - r * 0.32, cy - r * 0.32, r * 0.16, 0, Math.PI * 2)
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill()
}

function sequinBand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cols = Math.round(w / (h * 0.7)), s = w / cols
  for (let i = 0; i < cols; i++) {
    const v = 170 + ((i * 17) % 8) * 10
    const grd = g.createLinearGradient(x + i * s, y, x + i * s, y + h)
    grd.addColorStop(0, `rgb(${v + 40},${v + 45},${v + 55})`)
    grd.addColorStop(1, `rgb(${v - 40},${v - 35},${v - 25})`)
    g.fillStyle = grd; g.fillRect(x + i * s + 0.5, y, s - 1, h)
  }
}

function renderSingle(rows: Row[], opts: StripOptions): HTMLCanvasElement {
  const t = TEMPLATES[opts.template]
  const aspect = opts.aspect || 4 / 3
  const CELL_W = Math.round(CELL_H * aspect)
  const bg = opts.background || t.bg
  const pad = Math.round(CELL_H * 0.058)
  const gap = Math.round(CELL_H * 0.04)            // vertical gap between rows
  const coupleGap = Math.round(CELL_H * 0.012)     // thin center seam so a couple reads as "together"
  const twoWide = rows.some((r) => r.length === 2)
  const contentW = twoWide ? CELL_W * 2 + coupleGap : CELL_W
  const topDecoH = t.topDeco === 'sequin' ? Math.round(CELL_H * 0.058) : 0
  const scriptFooter = SCRIPT_FOOTER.includes(opts.template)
  const footerH = Math.round(CELL_H * (scriptFooter ? 0.52 : 0.26))

  // polaroid: each photo sits in a white card with a thick bottom lip
  const pol = !!t.polaroid
  const polSide = pol ? Math.round(CELL_H * 0.05) : 0
  const polInnerW = pol ? CELL_W - polSide * 2 : CELL_W
  const polInnerH = pol ? Math.round(polInnerW / aspect) : CELL_H
  const polLip = pol ? Math.round(CELL_H * 0.16) : 0
  const rowH = pol ? polSide + polInnerH + polLip : CELL_H

  const W = contentW + pad * 2
  const H = pad + topDecoH + rows.length * rowH + (rows.length - 1) * gap + footerH

  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = bg; g.fillRect(0, 0, W, H)

  if (t.topDeco === 'sequin') sequinBand(g, pad, pad, contentW, topDecoH)
  if (opts.template === 'film') {
    const holeW = pad * 0.42, holeH = holeW * 1.5, step = holeH * 1.9
    g.fillStyle = 'rgba(236,236,240,0.92)'
    for (let y = holeH; y < H - holeH; y += step) {
      roundRect(g, (pad - holeW) / 2, y, holeW, holeH, 3); g.fill()
      roundRect(g, W - pad + (pad - holeW) / 2, y, holeW, holeH, 3); g.fill()
    }
  }

  let y = pad + topDecoH
  for (const row of rows) {
    const rowW = row.length === 2 ? CELL_W * 2 + gap : CELL_W
    let x = pad + Math.round((contentW - rowW) / 2)
    for (const photo of row) {
      if (pol) {
        g.save(); g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 10; g.shadowOffsetY = 4
        g.fillStyle = '#fdfdfb'; g.fillRect(x, y, CELL_W, rowH); g.restore()
        coverDraw(g, photo, x + polSide, y + polSide, polInnerW, polInnerH)
        if (t.keyline) { g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1; g.strokeRect(x + polSide, y + polSide, polInnerW, polInnerH) }
      } else if (t.photoBorder) {
        if (t.glow) { g.save(); g.shadowColor = t.glow; g.shadowBlur = 20 }
        const b = t.photoBorder.w
        g.fillStyle = t.photoBorder.color
        g.fillRect(x - b, y - b, CELL_W + b * 2, CELL_H + b * 2)
        if (t.glow) g.restore()
        coverDraw(g, photo, x, y, CELL_W, CELL_H)
        if (t.keyline) { g.strokeStyle = t.keyline; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, CELL_W - 1.5, CELL_H - 1.5) }
      } else {
        coverDraw(g, photo, x, y, CELL_W, CELL_H)
        if (t.keyline) { g.strokeStyle = t.keyline; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, CELL_W - 1.5, CELL_H - 1.5) }
      }
      x += CELL_W + coupleGap
    }
    y += rowH + gap
  }

  // ---- footer ----
  const fTop = H - footerH
  const cx = W / 2
  const caption = (opts.caption || '').trim()
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'

  if (caption) {
    const capSize = Math.round(footerH * (opts.template === 'neon' ? 0.18 : scriptFooter ? 0.42 : 0.34))
    g.font = `${opts.template === 'classic' ? 600 : opts.template === 'neon' ? 400 : 700} ${capSize}px ${t.captionFont}`
    g.fillStyle = t.captionInk
    if (t.glow) { g.save(); g.shadowColor = t.captionInk; g.shadowBlur = 12 }
    g.fillText(caption, cx, fTop + footerH * (scriptFooter ? 0.42 : 0.5))
    if (t.glow) g.restore()
    const cw = g.measureText(caption).width
    if (opts.template === 'romantic') {
      heart(g, cx - cw / 2 - footerH * 0.14, fTop + footerH * 0.34, footerH * 0.09, t.captionInk)
      heart(g, cx + cw / 2 + footerH * 0.14, fTop + footerH * 0.34, footerH * 0.09, t.captionInk)
    } else if (opts.template === 'cutesy') {
      star(g, cx - cw / 2 - footerH * 0.15, fTop + footerH * 0.32, footerH * 0.1, '#ffb63d')
      heart(g, cx + cw / 2 + footerH * 0.15, fTop + footerH * 0.34, footerH * 0.09, t.captionInk)
    }
  }
  if (opts.showDate) {
    const metaSize = Math.round(footerH * (opts.template === 'neon' ? 0.12 : scriptFooter ? 0.14 : 0.2))
    g.font = `500 ${metaSize}px ${t.metaFont}`
    g.fillStyle = t.captionInk
    g.globalAlpha = opts.template === 'neon' ? 1 : 0.72
    const dy = caption ? (scriptFooter ? 0.58 : 0.78) : 0.5
    g.fillText(dateStamp(), cx, fTop + footerH * dy)
    g.globalAlpha = 1
  }
  if (t.deco === 'disco') {
    const r = footerH * 0.11, by = H - footerH * 0.2
    discoBall(g, cx - r * 3.2, by, r * 0.85); discoBall(g, cx, by + r * 0.2, r); discoBall(g, cx + r * 3.2, by, r * 0.85)
  }
  if (t.deco === 'cute') {
    // scattered hearts / stars / sparkles round the caption
    const b = H - footerH * 0.16
    sparkle4(g, cx - footerH * 0.85, b, footerH * 0.09, '#ff8fc4')
    star(g, cx - footerH * 0.35, b + footerH * 0.04, footerH * 0.07, '#ffb63d')
    heart(g, cx + footerH * 0.05, b, footerH * 0.07, '#ff5fa2')
    star(g, cx + footerH * 0.45, b + footerH * 0.02, footerH * 0.06, '#9b6cff')
    sparkle4(g, cx + footerH * 0.85, b, footerH * 0.09, '#ff8fc4')
    // a couple of corner sparkles up top
    sparkle4(g, pad + topDecoH * 0.6 + 8, pad + 10, footerH * 0.07, 'rgba(255,140,196,0.85)')
    star(g, W - pad - 12, pad + 16, footerH * 0.06, 'rgba(255,182,61,0.85)')
  }
  return c
}

export function renderStrip(rows: Row[], opts: StripOptions): HTMLCanvasElement {
  const single = renderSingle(rows, opts)
  if (!opts.double) return single
  const t = TEMPLATES[opts.template]
  const gap = Math.round(single.width * 0.05)
  const c = document.createElement('canvas')
  c.width = single.width * 2 + gap; c.height = single.height
  const g = c.getContext('2d')!
  g.fillStyle = opts.background || t.bg; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(single, 0, 0); g.drawImage(single, single.width + gap, 0)
  g.strokeStyle = t.captionInk; g.globalAlpha = 0.35; g.lineWidth = 2; g.setLineDash([9, 9])
  g.beginPath(); g.moveTo(single.width + gap / 2, 8); g.lineTo(single.width + gap / 2, c.height - 8); g.stroke()
  g.setLineDash([]); g.globalAlpha = 1
  return c
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

export async function ensureFonts(): Promise<void> {
  const fonts = ['600 40px "Dancing Script"', '400 20px "Press Start 2P"', '600 20px "Space Grotesk"', '400 20px "Courier New"']
  try { await Promise.all(fonts.map((f) => (document as any).fonts.load(f))); await (document as any).fonts.ready } catch { /* fallback */ }
}

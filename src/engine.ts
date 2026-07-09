/*
 * Capture engine — ported 1:1 from the verified concepts/_shared/engine.js,
 * typed for the production app and extended with:
 *   - snap(): grab one filtered frame on demand (used by the couple/together mode)
 *   - composeCoupleStrip(): combine two people's frames into one shared strip
 *
 * Safari-safe: filters are baked in via pixel manipulation, NOT ctx.filter
 * (disabled-by-default in Safari through 2026).
 */

export type BoothStatus =
  | 'idle' | 'requesting' | 'ready' | 'denied' | 'error' | 'countdown' | 'capturing' | 'done'

export type CaptureMode = 'strip' | 'single'
export type CoupleLayout = 'sidebyside' | 'alternating'

export interface FilterDef {
  label: string
  apply: ((d: Uint8ClampedArray) => void) | null
  vignette?: number
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const FILTERS: Record<string, FilterDef> = {
  none: { label: 'None', apply: null },
  bw: {
    label: 'B&W',
    apply(d) {
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        d[i] = d[i + 1] = d[i + 2] = y
      }
    },
  },
  noir: {
    label: 'Noir',
    apply(d) {
      for (let i = 0; i < d.length; i += 4) {
        let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        y = 255 / (1 + Math.exp(-0.045 * (y - 128)))
        d[i] = d[i + 1] = d[i + 2] = y
      }
    },
  },
  sepia: {
    label: 'Sepia',
    apply(d) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2]
        d[i] = clamp(0.393 * r + 0.769 * g + 0.189 * b)
        d[i + 1] = clamp(0.349 * r + 0.686 * g + 0.168 * b)
        d[i + 2] = clamp(0.272 * r + 0.534 * g + 0.131 * b)
      }
    },
  },
  vintage: {
    label: 'Vintage',
    apply(d) {
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2]
        r = clamp(r * 1.1 + 18); g = clamp(g * 1.02 + 12); b = clamp(b * 0.88 + 8)
        d[i] = clamp(r * 0.92 + 20); d[i + 1] = clamp(g * 0.92 + 16); d[i + 2] = clamp(b * 0.92 + 12)
      }
    },
    vignette: 0.55,
  },
  cool: {
    label: 'Cool',
    apply(d) {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp(d[i] * 0.9 + 4); d[i + 1] = clamp(d[i + 1] * 0.98 + 6); d[i + 2] = clamp(d[i + 2] * 1.12 + 10)
      }
    },
  },
}

const FILTER_ORDER = ['none', 'bw', 'noir', 'sepia', 'vintage', 'cool']

export const FILTERS_LIST = FILTER_ORDER.map((k) => ({ key: k, label: FILTERS[k].label }))

export interface BoothConfig {
  video: HTMLVideoElement
  mirror?: boolean
  frameAspect?: number
  stripShots?: number
  gapMs?: number
  countFrom?: number
  bg?: string
  accent?: string
  footer?: string
  format?: string
  onStatus?: (s: BoothStatus, detail?: string) => void
  onCountdown?: (n: number) => void
  onFlash?: () => void
  onFrame?: (c: HTMLCanvasElement, i: number, total: number) => void
  onResult?: (c: HTMLCanvasElement, mode: CaptureMode) => void
}

function dateStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

function drawVignette(g: CanvasRenderingContext2D, w: number, h: number, strength: number) {
  const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72)
  grd.addColorStop(0, 'rgba(0,0,0,0)')
  grd.addColorStop(1, `rgba(20,12,4,${strength})`)
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)
}

export function createPhotobooth(cfg: BoothConfig) {
  const opts = {
    mirror: true, frameAspect: 4 / 3, stripShots: 3, gapMs: 900, countFrom: 3,
    bg: '#f3ede2', accent: '#c8783c', footer: 'PHOTOBOOTH', format: 'image/png',
    onStatus: () => {}, onCountdown: () => {}, onFlash: () => {}, onFrame: () => {}, onResult: () => {},
    ...cfg,
  }
  const video = opts.video
  let stream: MediaStream | null = null
  let filterKey = 'none'
  let lastResult: { canvas: HTMLCanvasElement; mode: CaptureMode } | null = null
  let busy = false

  if (opts.mirror) video.style.transform = 'scaleX(-1)'

  function humanError(err: any): string {
    if (!err) return 'Camera unavailable.'
    switch (err.name) {
      case 'NotAllowedError': return 'Camera permission was blocked. Allow it and retry.'
      case 'NotFoundError': return 'No camera found on this device.'
      case 'NotReadableError': return 'The camera is busy in another app.'
      case 'SecurityError': return 'Camera blocked — the page must be served over HTTPS.'
      default: return 'Could not start the camera.'
    }
  }

  async function attach(s: MediaStream) {
    video.srcObject = s
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    try { await video.play() } catch { /* autoplay policy — plays on gesture */ }
    if (!video.videoWidth) {
      await new Promise<void>((res) => {
        const done = () => { video.removeEventListener('loadedmetadata', done); res() }
        video.addEventListener('loadedmetadata', done)
        setTimeout(res, 1500)
      })
    }
  }

  async function start(): Promise<MediaStream> {
    opts.onStatus('requesting')
    const host = location.hostname
    if (!window.isSecureContext && host !== 'localhost' && host !== '127.0.0.1') {
      opts.onStatus('error', 'Camera needs HTTPS (or localhost).')
      throw new Error('insecure-context')
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      opts.onStatus('error', 'This browser has no camera API.')
      throw new Error('no-getusermedia')
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      await attach(stream)
      opts.onStatus('ready')
      return stream
    } catch (err: any) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      opts.onStatus(denied ? 'denied' : 'error', humanError(err))
      throw err
    }
  }

  async function startSelfTest(): Promise<MediaStream> {
    opts.onStatus('requesting')
    const c = document.createElement('canvas')
    c.width = 1280; c.height = 720
    const g = c.getContext('2d')!
    let t = 0
    const paint = () => {
      t += 0.03
      const hue = (t * 40) % 360
      g.fillStyle = `hsl(${hue},45%,22%)`
      g.fillRect(0, 0, c.width, c.height)
      for (let i = 0; i < 6; i++) {
        g.beginPath()
        g.arc(640 + Math.sin(t + i) * 300, 360 + Math.cos(t * 1.3 + i) * 180, 60 + i * 12, 0, Math.PI * 2)
        g.fillStyle = `hsla(${(hue + i * 40) % 360},70%,60%,0.55)`
        g.fill()
      }
      g.fillStyle = '#fff'; g.font = 'bold 64px system-ui'; g.textAlign = 'center'
      g.fillText('SELF-TEST', 640, 380)
      if (stream) requestAnimationFrame(paint)
    }
    stream = c.captureStream(30)
    paint()
    await attach(stream)
    opts.onStatus('ready')
    return stream
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop())
    stream = null
    video.srcObject = null
    opts.onStatus('idle')
  }

  // Grab the current video frame, cover-cropped to frameAspect, mirrored to
  // match the preview, with the active filter baked in.
  function grabFrame(targetW: number): HTMLCanvasElement {
    const vw = video.videoWidth || 1280
    const vh = video.videoHeight || 720
    const outW = targetW
    const outH = Math.round(targetW / opts.frameAspect)

    const srcAspect = vw / vh
    let sx: number, sy: number, sw: number, sh: number
    if (srcAspect > opts.frameAspect) {
      sh = vh; sw = vh * opts.frameAspect; sx = (vw - sw) / 2; sy = 0
    } else {
      sw = vw; sh = vw / opts.frameAspect; sx = 0; sy = (vh - sh) / 2
    }

    const c = document.createElement('canvas')
    c.width = outW; c.height = outH
    const g = c.getContext('2d')!
    if (opts.mirror) { g.translate(outW, 0); g.scale(-1, 1) }
    g.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH)
    if (opts.mirror) g.setTransform(1, 0, 0, 1, 0, 0)

    const f = FILTERS[filterKey]
    if (f && f.apply) {
      const img = g.getImageData(0, 0, outW, outH)
      f.apply(img.data)
      g.putImageData(img, 0, 0)
    }
    if (f && f.vignette) drawVignette(g, outW, outH, f.vignette)
    return c
  }

  function composeStrip(frames: HTMLCanvasElement[]): HTMLCanvasElement {
    const fw = frames[0].width
    const fh = frames[0].height
    const pad = Math.round(fw * 0.055)
    const gap = Math.round(fw * 0.05)
    const footer = Math.round(fw * 0.16)
    const W = fw + pad * 2
    const H = pad + frames.length * fh + (frames.length - 1) * gap + footer

    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = opts.bg; g.fillRect(0, 0, W, H)

    let y = pad
    for (const f of frames) {
      g.fillStyle = opts.accent; g.fillRect(pad - 3, y - 3, fw + 6, fh + 6)
      g.drawImage(f, pad, y)
      y += fh + gap
    }
    g.fillStyle = opts.accent; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = `700 ${Math.round(footer * 0.3)}px "Courier New", ui-monospace, monospace`
    g.fillText(opts.footer, W / 2, H - footer * 0.62)
    g.font = `400 ${Math.round(footer * 0.2)}px "Courier New", ui-monospace, monospace`
    g.fillText(dateStamp(), W / 2, H - footer * 0.3)
    return c
  }

  function composeSingle(frame: HTMLCanvasElement): HTMLCanvasElement {
    const fw = frame.width
    const fh = frame.height
    const pad = Math.round(fw * 0.045)
    const footer = Math.round(fw * 0.11)
    const W = fw + pad * 2
    const H = fh + pad + footer

    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = opts.bg; g.fillRect(0, 0, W, H)
    g.fillStyle = opts.accent; g.fillRect(pad - 3, pad - 3, fw + 6, fh + 6)
    g.drawImage(frame, pad, pad)
    g.fillStyle = opts.accent; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = `700 ${Math.round(footer * 0.34)}px "Courier New", ui-monospace, monospace`
    g.fillText(opts.footer, W / 2, H - footer * 0.55)
    g.font = `400 ${Math.round(footer * 0.24)}px "Courier New", ui-monospace, monospace`
    g.fillText(dateStamp(), W / 2, H - footer * 0.26)
    return c
  }

  async function capture(mode: CaptureMode): Promise<HTMLCanvasElement | null> {
    if (busy || !stream) return null
    busy = true
    const shots = mode === 'strip' ? opts.stripShots : 1
    const frames: HTMLCanvasElement[] = []
    try {
      for (let i = 0; i < shots; i++) {
        for (let n = opts.countFrom; n >= 1; n--) {
          opts.onStatus('countdown'); opts.onCountdown(n); await delay(700)
        }
        opts.onFlash(); opts.onStatus('capturing'); await delay(90)
        const frame = grabFrame(900)
        frames.push(frame)
        opts.onFrame(frame, i, shots)
        if (i < shots - 1) await delay(opts.gapMs)
      }
      const composed = mode === 'strip' ? composeStrip(frames) : composeSingle(frames[0])
      lastResult = { canvas: composed, mode }
      opts.onStatus('done'); opts.onResult(composed, mode)
      return composed
    } finally {
      busy = false
    }
  }

  function download(name?: string) {
    if (!lastResult) return
    const ext = opts.format === 'image/jpeg' ? 'jpg' : 'png'
    const fname = name || `photobooth-${Date.now()}.${ext}`
    lastResult.canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fname
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, opts.format, 0.95)
  }

  return {
    start, startSelfTest, stop, capture, download,
    snap: (targetW = 700) => grabFrame(targetW),
    setFilter: (k: string) => { if (FILTERS[k]) filterKey = k },
    getFilter: () => filterKey,
    setShots: (n: number) => { opts.stripShots = Math.max(1, Math.min(6, n | 0)) },
    getShots: () => opts.stripShots,
    setAspect: (a: number) => { opts.frameAspect = a },
    getAspect: () => opts.frameAspect,
    setResult: (c: HTMLCanvasElement, mode: CaptureMode) => { lastResult = { canvas: c, mode } },
    getResultCanvas: () => lastResult?.canvas ?? null,
    isRunning: () => !!stream,
    filters: FILTERS_LIST,
  }
}

export type Photobooth = ReturnType<typeof createPhotobooth>

/* -------------------------------------------------------------------------
 * Multi-contributor compositing — combine two people's frames into one strip.
 * `pairs[i]` = { you, partner } for pose i. Both peers run this with the SAME
 * inputs (each swaps its own vs the partner's frames) so both download an
 * identically-laid-out strip.
 * ------------------------------------------------------------------------- */
export interface CoupleTheme { bg: string; accent: string; footer: string }

export function composeCoupleStrip(
  pairs: { a: HTMLCanvasElement; b: HTMLCanvasElement }[],
  layout: CoupleLayout,
  theme: CoupleTheme,
): HTMLCanvasElement {
  const cellW = 420
  const cellH = Math.round(cellW * 3 / 4) // 4:3
  const pad = Math.round(cellW * 0.06)
  const innerGap = Math.round(cellW * 0.04)
  const rowGap = Math.round(cellW * 0.05)
  const footer = Math.round(cellW * 0.17)

  const drawCell = (g: CanvasRenderingContext2D, src: HTMLCanvasElement, x: number, y: number) => {
    g.fillStyle = theme.accent
    g.fillRect(x - 3, y - 3, cellW + 6, cellH + 6)
    // cover-fit the source into the cell
    const sr = src.width / src.height
    const cr = cellW / cellH
    let sx = 0, sy = 0, sw = src.width, sh = src.height
    if (sr > cr) { sw = src.height * cr; sx = (src.width - sw) / 2 }
    else { sh = src.width / cr; sy = (src.height - sh) / 2 }
    g.drawImage(src, sx, sy, sw, sh, x, y, cellW, cellH)
  }

  let W: number, H: number
  const c = document.createElement('canvas')

  if (layout === 'sidebyside') {
    // each row shows both people together
    W = pad * 2 + cellW * 2 + innerGap
    H = pad + pairs.length * cellH + (pairs.length - 1) * rowGap + footer
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = theme.bg; g.fillRect(0, 0, W, H)
    let y = pad
    for (const p of pairs) {
      drawCell(g, p.a, pad, y)
      drawCell(g, p.b, pad + cellW + innerGap, y)
      y += cellH + rowGap
    }
    footerText(g, theme, W, H, footer)
  } else {
    // alternating single column: a, b, a, b...
    const seq: HTMLCanvasElement[] = []
    for (const p of pairs) { seq.push(p.a); seq.push(p.b) }
    W = pad * 2 + cellW
    H = pad + seq.length * cellH + (seq.length - 1) * rowGap + footer
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = theme.bg; g.fillRect(0, 0, W, H)
    let y = pad
    for (const f of seq) { drawCell(g, f, pad, y); y += cellH + rowGap }
    footerText(g, theme, W, H, footer)
  }
  return c
}

function footerText(g: CanvasRenderingContext2D, theme: CoupleTheme, W: number, H: number, footer: number) {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
  g.fillStyle = theme.accent; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = `700 ${Math.round(footer * 0.28)}px "Courier New", ui-monospace, monospace`
  g.fillText(theme.footer, W / 2, H - footer * 0.62)
  g.font = `400 ${Math.round(footer * 0.19)}px "Courier New", ui-monospace, monospace`
  g.fillText('TOGETHER · ' + stamp, W / 2, H - footer * 0.3)
}

// Utility: PNG bytes <-> canvas, for sending frames over the P2P data channel.
export function canvasToBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve) => {
    c.toBlob(async (b) => resolve(new Uint8Array(b ? await b.arrayBuffer() : [])), 'image/jpeg', 0.9)
  })
}

export function bytesToImage(bytes: Uint8Array | ArrayBuffer): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const blob = new Blob([ab], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      resolve(c)
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

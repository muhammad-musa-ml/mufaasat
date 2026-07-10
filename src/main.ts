import './styles.css'
import { createPhotobooth, canvasToBytes } from './engine'
import {
  renderStrip, getFilterCss, TEMPLATES, TEMPLATE_ORDER, ensureFonts,
  type TemplateId, type Row, type StripOptions,
} from './strip'
import { createCollab, newRoomCode, normalizeCode } from './collab'

const params = new URLSearchParams(location.search)
const SELFTEST = params.has('selftest')
const SIM = params.has('duosim')

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const pulse = (el: HTMLElement, cls: string) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls) }
const cloneCanvas = (src: HTMLCanvasElement) => {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height
  c.getContext('2d')!.drawImage(src, 0, 0); return c
}
ensureFonts()

// -------- shared camera + booth (one local camera, moved between slots) -----
const camYou = $('camYou'), camPartner = $('camPartner')
const video = $('video') as HTMLVideoElement
const flashEl = $('flash'), countEl = $('count')

const booth = createPhotobooth({ video, mirror: true, onStatus: onCamStatus })

let liveFilter = 'none'
function applyLiveFilter() { video.style.filter = getFilterCss(liveFilter) }
function setFilter(key: string) { liveFilter = key; booth.setFilter(key); applyLiveFilter() }

function onCamStatus(state: string, detail?: string) {
  if (state === 'denied' || state === 'error') {
    const err = session === 'solo' ? $('soloError') : null
    if (err) { $('soloErrMsg').textContent = detail || 'Camera unavailable.'; err.classList.remove('hidden'); $('soloHint').classList.add('hidden') }
    else setDuoStatus('bad', detail || 'Camera blocked — allow it and rejoin.')
  }
}

// -------- customization state (drives the saved render) ---------------------
let template: TemplateId = 'neon'
let background = ''         // '' → template default
let caption = ''
let showDate = true
let doubleStrip = false
let duoLayoutAlt = false    // save-time arrangement for together strips

// photo width (aspect = width/height). Narrower = a slimmer strip; for couples
// it also tightens the center seam so they read as "together".
const WIDTH_OPTIONS = [
  { key: 'wide', label: 'Wide', aspect: 4 / 3 },
  { key: 'square', label: 'Square', aspect: 1 },
  { key: 'tall', label: 'Slim', aspect: 3 / 4 },
]
let photoAspect = 4 / 3
let savedAspect = 4 / 3

// -------- chip/swatch builders --------------------------------------------
function chipRow(container: HTMLElement, items: { key: string; label: string }[], active: string,
                 onPick: (key: string) => void) {
  container.innerHTML = ''
  for (const it of items) {
    const b = document.createElement('button')
    b.className = 'chip'; b.textContent = it.label
    b.setAttribute('aria-pressed', String(it.key === active))
    b.onclick = () => {
      Array.from(container.children).forEach((c) => c.setAttribute('aria-pressed', 'false'))
      b.setAttribute('aria-pressed', 'true'); onPick(it.key)
    }
    container.appendChild(b)
  }
}
const filterItems = booth.filters
const templateItems = TEMPLATE_ORDER.map((t) => ({ key: t, label: TEMPLATES[t].label }))

function applyStripSkin(el: HTMLElement) {
  el.classList.remove('strip--romantic', 'strip--classic', 'strip--film', 'strip--neon')
  el.classList.add('strip--' + template)
}

// build the filter + template chip rows in both panels
chipRow($('filters'), filterItems, 'none', setFilter)
chipRow($('duoFilters'), filterItems, 'none', setFilter)
chipRow($('soloTemplates'), templateItems, template, (k) => pickTemplate(k as TemplateId))
chipRow($('duoTemplates'), templateItems, template, (k) => pickTemplate(k as TemplateId))

const widthItems = WIDTH_OPTIONS.map((w) => ({ key: w.key, label: w.label }))
chipRow($('soloWidths'), widthItems, 'wide', setWidth)
chipRow($('duoWidths'), widthItems, 'wide', setWidth)
function setWidth(key: string) {
  const w = WIDTH_OPTIONS.find((o) => o.key === key) || WIDTH_OPTIONS[0]
  photoAspect = w.aspect
  booth.setAspect(photoAspect)
  applyAspectVar()
  for (const id of ['soloWidths', 'duoWidths']) {
    const c = document.getElementById(id); if (!c) continue
    Array.from(c.children).forEach((ch) => ch.setAttribute('aria-pressed', String(ch.textContent === w.label)))
  }
}
function applyAspectVar() {
  ;($('soloStrip')).style.setProperty('--aspect', String(photoAspect))
  ;($('duoStrip')).style.setProperty('--aspect', String(photoAspect))
}
booth.setAspect(photoAspect); applyAspectVar()
function pickTemplate(t: TemplateId) {
  template = t; background = ''
  applyStripSkin($('soloStrip')); applyStripSkin($('duoStrip'))
  syncTemplateChips()
  if (!$('saveView').classList.contains('hidden')) { buildSwatches(); renderSave() }
}
function syncTemplateChips() {
  for (const id of ['soloTemplates', 'duoTemplates', 'saveTemplates']) {
    const c = document.getElementById(id); if (!c) continue
    Array.from(c.children).forEach((ch) => ch.setAttribute('aria-pressed', String(ch.textContent === TEMPLATES[template].label)))
  }
}

// =====================================================================
// strip-booth building blocks
// =====================================================================
interface Slot { el: HTMLElement; kind: 'you' | 'partner' }
function buildStrip(container: HTMLElement, rowCount: number, duo: boolean, youOnLeft = true): Slot[][] {
  container.innerHTML = ''
  applyStripSkin(container)
  container.style.setProperty('--aspect', String(photoAspect))
  const rows: Slot[][] = []
  for (let r = 0; r < rowCount; r++) {
    const rowEl = document.createElement('div'); rowEl.className = 'strip-row'
    const slots: Slot[] = []
    const kinds: ('you' | 'partner')[] = duo ? (youOnLeft ? ['you', 'partner'] : ['partner', 'you']) : ['you']
    for (const kind of kinds) {
      const s = document.createElement('div'); s.className = 'slot'
      const ph = document.createElement('div'); ph.className = 'ph'
      ph.textContent = duo ? (kind === 'you' ? 'YOU' : 'THEM') : 'POSE ' + (r + 1)
      s.appendChild(ph)
      rowEl.appendChild(s); slots.push({ el: s, kind })
    }
    container.appendChild(rowEl); rows.push(slots)
  }
  return rows
}
function placeCam(slot: HTMLElement, cam: HTMLElement) {
  cam.hidden = false
  slot.querySelectorAll('.ph,.shot,.retake').forEach((n) => n.remove())
  slot.appendChild(cam); slot.classList.add('slot--active')
  slot.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
function detachCam(cam: HTMLElement) {
  const p = cam.parentElement
  if (p) { p.classList.remove('slot--active') }
  cam.hidden = true; document.body.appendChild(cam)
}
function freezeSlot(slot: HTMLElement, photo: HTMLCanvasElement, onRetake?: () => void) {
  slot.classList.remove('slot--active')
  slot.querySelectorAll('.shot,.ph,.retake').forEach((n) => n.remove())
  const img = cloneCanvas(photo); img.className = 'shot'
  // the photo canvas is already selfie-mirrored by the engine, so no CSS flip here
  slot.appendChild(img)
  if (onRetake) {
    const rb = document.createElement('button'); rb.className = 'retake'; rb.textContent = '↻'; rb.title = 'retake this pose'
    rb.onclick = onRetake; slot.appendChild(rb)
  }
}
async function countdownAt(cam: HTMLElement, slot: HTMLElement) {
  placeCam(slot, cam)
  for (let n = 5; n >= 1; n--) { countEl.textContent = String(n); pulse(countEl, 'go'); await delay(1000) }
  pulse(flashEl, 'go'); await delay(90)
}

// =====================================================================
// SOLO
// =====================================================================
let soloMode: 'strip' | 'single' = 'strip'
let soloShots = 3
let soloSlots: Slot[][] = []
let soloFrames: (HTMLCanvasElement | null)[] = []
let soloBusy = false

function soloRows() { return soloMode === 'single' ? 1 : soloShots }
function renderSoloStrip() {
  soloSlots = buildStrip($('soloStrip'), soloRows(), false)
  soloFrames = new Array(soloRows()).fill(null)
}
renderSoloStrip()

function setSoloMode(m: 'strip' | 'single') {
  soloMode = m
  $('modeStrip').setAttribute('aria-pressed', String(m === 'strip'))
  $('modeSingle').setAttribute('aria-pressed', String(m === 'single'))
  $('shotsRow').style.display = m === 'strip' ? '' : 'none'
  renderSoloStrip()
}
$('modeStrip').onclick = () => setSoloMode('strip')
$('modeSingle').onclick = () => setSoloMode('single')
$('shotsMinus').onclick = () => { soloShots = Math.max(2, soloShots - 1); $('shotsVal').textContent = String(soloShots); renderSoloStrip() }
$('shotsPlus').onclick = () => { soloShots = Math.min(6, soloShots + 1); $('shotsVal').textContent = String(soloShots); renderSoloStrip() }

async function startSoloCamera() {
  $('soloError').classList.add('hidden')
  try {
    if (SELFTEST) await booth.startSelfTest(); else await booth.start()
    applyLiveFilter()
    $('soloHint').classList.add('hidden')
    $('startBtn').classList.add('hidden')
    $('shootBtn').classList.remove('hidden')
    $('stopBtn').classList.remove('hidden')
    // park the camera in the first empty slot so you can frame up
    if (soloSlots[0]) placeCam(soloSlots[0][0].el, camYou)
  } catch { /* onCamStatus shows the error */ }
}
$('startBtn').onclick = startSoloCamera
$('stopBtn').onclick = () => {
  booth.stop(); detachCam(camYou)
  $('startBtn').classList.remove('hidden'); $('shootBtn').classList.add('hidden')
  $('saveOpenBtn').classList.add('hidden'); $('stopBtn').classList.add('hidden')
  $('soloHint').classList.remove('hidden'); renderSoloStrip()
}

$('shootBtn').onclick = () => runSoloSequence()
async function runSoloSequence() {
  if (soloBusy || !booth.isRunning()) return
  soloBusy = true
  savedAspect = photoAspect
  ;($('shootBtn') as HTMLButtonElement).disabled = true
  $('saveOpenBtn').classList.add('hidden')
  renderSoloStrip()
  for (let i = 0; i < soloRows(); i++) {
    await captureSoloSlot(i)
    if (i < soloRows() - 1) await delay(650)
  }
  detachCam(camYou)
  soloBusy = false
  ;($('shootBtn') as HTMLButtonElement).disabled = false
  $('shootBtn').textContent = '↻ Retake all'
  $('saveOpenBtn').classList.remove('hidden')
}
async function captureSoloSlot(i: number) {
  const slot = soloSlots[i][0].el
  await countdownAt(camYou, slot)
  const frame = booth.snap(700)
  soloFrames[i] = frame
  freezeSlot(slot, frame, () => retakeSoloSlot(i))
}
async function retakeSoloSlot(i: number) {
  if (soloBusy || !booth.isRunning()) return
  soloBusy = true
  await captureSoloSlot(i)
  detachCam(camYou)
  soloBusy = false
}
$('saveOpenBtn').onclick = () => {
  const rows: Row[] = soloFrames.filter(Boolean).map((f) => [f as HTMLCanvasElement])
  openSave(rows, false)
}

// =====================================================================
// TOGETHER
// =====================================================================
let duoShots = 3
let duoSlots: Slot[][] = []
let duoLocal: (HTMLCanvasElement | null)[] = []
const duoPartnerByRound: Record<number, HTMLCanvasElement[]> = {}
let duoBusy = false
let duoRound = -1
let youOnLeft = true
let shareCode = ''

function duoRenderStrip() {
  youOnLeft = SIM ? true : collab.amFirst()
  duoSlots = buildStrip($('duoStrip'), duoShots, true, youOnLeft)
  duoLocal = new Array(duoShots).fill(null)
}

const collab = createCollab({
  onPeerJoin: () => {
    setDuoStatus('ok', 'Partner connected! Strike a pose.')
    ;($('duoShootBtn') as HTMLButtonElement).disabled = false
    duoRenderStrip()
  },
  onPeerLeave: () => {
    setDuoStatus('bad', 'Your partner left the room.')
    ;($('duoShootBtn') as HTMLButtonElement).disabled = true
    camPartner.hidden = true; ;(camPartner.querySelector('#partnerVideo') as HTMLVideoElement).srcObject = null
  },
  onPeerStream: (stream) => {
    ;($('partnerVideo') as HTMLVideoElement).srcObject = stream
    $('partnerWaiting').classList.add('hidden')
  },
  onShoot: (p) => runDuoSequence(p),
  onFrame: (meta, canvas) => {
    ;(duoPartnerByRound[meta.round] ||= [])[meta.index] = canvas
    if (meta.round === duoRound) fillDuoPartnerSlot(meta.index)
  },
})
function setDuoStatus(kind: 'ok' | 'wait' | 'bad', msg: string) {
  const el = $('duoStatus'); el.className = 'status ' + kind; el.textContent = msg; el.classList.remove('hidden')
}
function hasPartnerNow() { return SIM || collab.hasPartner() }

async function startDuoCamera() {
  try {
    const stream = SELFTEST ? await booth.startSelfTest() : await booth.start()
    applyLiveFilter()
    if (!SIM) collab.setLocalStream(stream)
  } catch { /* status set by onCamStatus */ }
}
function enterRoom(code: string, isCreator: boolean) {
  $('createBox').classList.add('hidden'); $('joinBox').classList.add('hidden'); $('orDivider').classList.add('hidden')
  if (isCreator) { $('myCodeBox').classList.remove('hidden'); $('myCode').textContent = code; shareCode = code }
  $('duoBoothWrap').classList.remove('hidden'); $('duoControls').classList.remove('hidden')
  duoRenderStrip()
  if (SIM) { setDuoStatus('ok', 'SIM MODE · fake partner ready.'); ($('duoShootBtn') as HTMLButtonElement).disabled = false }
  else { collab.connect(code); collab.setName('Player'); setDuoStatus('wait', 'Room ' + code + ' · waiting for your partner…') }
  startDuoCamera()
}
$('createBtn').onclick = () => enterRoom(newRoomCode(), true)
$('joinBtn').onclick = () => {
  const code = normalizeCode(($('joinInput') as HTMLInputElement).value)
  if (code.length < 4) { setDuoStatus('bad', 'Enter the room code first.'); return }
  enterRoom(code, false)
}
// Clean base URL (no query/hash) + the room code as a hash. On GitHub Pages
// this yields https://<user>.github.io/<repo>/#CODE, which the recipient's app
// reads on load to prefill the room. Falls back to showing the text if the
// clipboard API is blocked.
function inviteLink() { return location.origin + location.pathname + '#' + shareCode }
function copyText(text: string, okMsg: string) {
  const show = (ok: boolean) => setDuoStatus('ok', ok ? okMsg : (okMsg + ' — copy it: ' + text))
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => show(true)).catch(() => show(false))
    else show(false)
  } catch { show(false) }
}
$('copyCodeBtn').onclick = () => copyText(shareCode, 'Code copied — send it to your partner.')
$('copyLinkBtn').onclick = () => copyText(inviteLink(), 'Invite link copied!')
$('duoShotsMinus').onclick = () => { duoShots = Math.max(2, duoShots - 1); $('duoShotsVal').textContent = String(duoShots); duoRenderStrip() }
$('duoShotsPlus').onclick = () => { duoShots = Math.min(6, duoShots + 1); $('duoShotsVal').textContent = String(duoShots); duoRenderStrip() }

$('duoShootBtn').onclick = () => {
  if (duoBusy || !hasPartnerNow()) return
  const p = { round: Date.now(), shots: duoShots, layout: 'sidebyside' as const }
  if (!SIM) collab.sendShoot(p)
  runDuoSequence(p)
}
$('duoLeaveBtn').onclick = () => resetDuoLobby()

function partnerSlotEl(rowIndex: number): HTMLElement {
  const slots = duoSlots[rowIndex]
  return (slots.find((s) => s.kind === 'partner') as Slot).el
}
function youSlotEl(rowIndex: number): HTMLElement {
  const slots = duoSlots[rowIndex]
  return (slots.find((s) => s.kind === 'you') as Slot).el
}
function fillDuoPartnerSlot(i: number) {
  const arr = duoPartnerByRound[duoRound]; if (!arr || !arr[i]) return
  freezeSlot(partnerSlotEl(i), arr[i])
}

async function runDuoSequence(p: { round: number; shots: number }) {
  if (duoBusy) return
  duoBusy = true
  savedAspect = photoAspect
  ;($('duoShootBtn') as HTMLButtonElement).disabled = true
  $('duoSaveOpenBtn').classList.add('hidden')
  duoRound = p.round; duoShots = p.shots
  $('duoShotsVal').textContent = String(duoShots)
  duoRenderStrip()
  duoPartnerByRound[p.round] ||= []
  // show partner's live video in each active row's partner slot as we go
  for (let i = 0; i < p.shots; i++) {
    // partner cam into the partner slot (live) for this row
    placePartnerCam(i)
    await countdownAt(camYou, youSlotEl(i))
    const frame = booth.snap(700)
    duoLocal[i] = frame
    freezeSlot(youSlotEl(i), frame)
    if (SIM) { (duoPartnerByRound[p.round][i] = cloneCanvas(frame)); fillDuoPartnerSlot(i) }
    else { canvasToBytes(frame).then((b) => collab.sendFrame(b, { round: p.round, index: i, total: p.shots })); fillDuoPartnerSlot(i) }
    if (i < p.shots - 1) await delay(650)
  }
  detachCam(camYou); detachCam(camPartner)
  duoBusy = false
  ;($('duoShootBtn') as HTMLButtonElement).disabled = !hasPartnerNow()
  $('duoShootBtn').textContent = '↻ Reshoot'
  $('duoSaveOpenBtn').classList.remove('hidden')
}
function placePartnerCam(i: number) {
  if (SIM) return
  const slot = partnerSlotEl(i)
  camPartner.hidden = false
  slot.querySelector('.ph')?.remove()
  slot.appendChild(camPartner)
}
$('duoSaveOpenBtn').onclick = () => {
  const rows: Row[] = []
  for (let i = 0; i < duoShots; i++) {
    const you = duoLocal[i]; const them = (duoPartnerByRound[duoRound] || [])[i]
    if (!you || !them) continue
    rows.push(youOnLeft ? [you, them] : [them, you])
  }
  openSave(rows, true)
}

function resetDuoLobby() {
  void collab.leave(); booth.stop(); detachCam(camYou); detachCam(camPartner)
  duoBusy = false; duoRound = -1
  for (const k of Object.keys(duoPartnerByRound)) delete duoPartnerByRound[Number(k)]
  $('duoBoothWrap').classList.add('hidden'); $('duoControls').classList.add('hidden')
  $('myCodeBox').classList.add('hidden'); $('createBox').classList.remove('hidden')
  $('joinBox').classList.remove('hidden'); $('orDivider').classList.remove('hidden'); $('duoStatus').classList.add('hidden')
  $('partnerWaiting').classList.remove('hidden'); ($('partnerVideo') as HTMLVideoElement).srcObject = null
  ;($('duoShootBtn') as HTMLButtonElement).disabled = true; $('duoShootBtn').textContent = '◉ Shoot together'
  $('duoSaveOpenBtn').classList.add('hidden')
}

// =====================================================================
// SAVE / CUSTOMIZE
// =====================================================================
let saveRows: Row[] = []
let saveIsDuo = false
let lastRendered: HTMLCanvasElement | null = null

function stripOptions(): StripOptions {
  return { template, background: background || undefined, caption, showDate, double: doubleStrip, aspect: savedAspect }
}
function rowsForRender(): Row[] {
  if (saveIsDuo && duoLayoutAlt) return saveRows.flatMap((r) => r.map((c) => [c]))
  return saveRows
}
function renderSave() {
  const canvas = renderStrip(rowsForRender(), stripOptions())
  lastRendered = canvas
  const sc = $('saveCanvas') as HTMLCanvasElement
  sc.width = canvas.width; sc.height = canvas.height
  sc.getContext('2d')!.drawImage(canvas, 0, 0)
  $('saveNote').textContent = `${canvas.width}×${canvas.height}${doubleStrip ? ' · double' : ''} · made in your browser`
}
function buildSwatches() {
  const box = $('saveSwatches'); box.innerHTML = ''
  const chosen = background || TEMPLATES[template].bg
  for (const sw of TEMPLATES[template].swatches) {
    const b = document.createElement('button'); b.className = 'swatch'; b.style.background = sw
    b.setAttribute('aria-pressed', String(sw === chosen))
    b.onclick = () => {
      background = sw
      Array.from(box.children).forEach((c) => c.setAttribute('aria-pressed', 'false'))
      b.setAttribute('aria-pressed', 'true'); renderSave()
    }
    box.appendChild(b)
  }
}
function openSave(rows: Row[], isDuo: boolean) {
  saveRows = rows; saveIsDuo = isDuo
  chipRow($('saveTemplates'), templateItems, template, (k) => pickTemplate(k as TemplateId))
  buildSwatches()
  ;($('captionInput') as HTMLInputElement).value = caption
  ;($('dateToggle') as HTMLInputElement).checked = showDate
  ;($('doubleToggle') as HTMLInputElement).checked = doubleStrip
  $('saveView').classList.remove('hidden')
  renderSave()
}
$('captionInput').oninput = (e) => { caption = (e.target as HTMLInputElement).value; renderSave() }
;($('dateToggle') as HTMLInputElement).onchange = (e) => { showDate = (e.target as HTMLInputElement).checked; renderSave() }
;($('doubleToggle') as HTMLInputElement).onchange = (e) => { doubleStrip = (e.target as HTMLInputElement).checked; renderSave() }
$('downloadBtn').onclick = () => {
  if (!lastRendered) return
  lastRendered.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = (saveIsDuo ? 'together-strip' : 'photostrip') + '.png'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}
$('saveClose').onclick = () => $('saveView').classList.add('hidden')
$('saveRetake').onclick = () => {
  $('saveView').classList.add('hidden')
  if (saveIsDuo) { if (!duoBusy) $('duoShootBtn').click() } else { if (!soloBusy) runSoloSequence() }
}

// =====================================================================
// session toggle + invite link
// =====================================================================
let session: 'solo' | 'duo' = 'solo'
function setSession(solo: boolean) {
  session = solo ? 'solo' : 'duo'
  $('sessSolo').setAttribute('aria-pressed', String(solo))
  $('sessDuo').setAttribute('aria-pressed', String(!solo))
  $('soloPanel').classList.toggle('hidden', !solo)
  $('duoPanel').classList.toggle('hidden', solo)
  $('saveView').classList.add('hidden')
  if (solo) { resetDuoLobby() } else { booth.stop(); detachCam(camYou) }
}
$('sessSolo').onclick = () => setSession(true)
$('sessDuo').onclick = () => setSession(false)

const hash = normalizeCode(location.hash.replace('#', ''))
if (hash.length >= 4) {
  setSession(false)
  ;($('joinInput') as HTMLInputElement).value = hash
  setDuoStatus('wait', 'Tap “Join →” to enter room ' + hash + '.')
}

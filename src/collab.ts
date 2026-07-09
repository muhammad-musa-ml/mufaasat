/*
 * Collaboration transport — a thin wrapper over Trystero (serverless WebRTC P2P).
 *
 * Verified in a spike: two peers discover each other over the public Nostr
 * signaling network (keyless, no backend) and exchange data from a static page.
 * Trystero v0.25.2 uses ASSIGNMENT-style handlers (room.onPeerJoin = fn) and
 * makeAction returns { send(data, {target, metadata}), onMessage }.
 *
 * This module only moves bytes/messages. The shoot choreography (synced
 * countdown, capturing, compositing) lives in main.ts.
 */
import { joinRoom, selfId } from 'trystero/nostr'
import type { Room } from 'trystero'
import { bytesToImage, type CoupleLayout } from './engine'

const APP_ID = 'duobooth-v1-9f3a2c'
// friendly room codes: no ambiguous characters (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export interface ShootParams { round: number; shots: number; layout: CoupleLayout }
export interface FrameMeta { round: number; index: number; total: number }

export interface CollabHandlers {
  onPeerJoin?: (id: string) => void
  onPeerLeave?: (id: string) => void
  onPeerStream?: (stream: MediaStream, id: string) => void
  onShoot?: (params: ShootParams, fromId: string) => void
  onFrame?: (meta: FrameMeta, canvas: HTMLCanvasElement, fromId: string) => void
  onName?: (id: string, name: string) => void
}

export function newRoomCode(len = 6): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function createCollab(h: CollabHandlers) {
  let room: Room | null = null
  let partnerId: string | null = null
  let localStream: MediaStream | null = null

  let sendShootAction: ((p: ShootParams) => void) | null = null
  let sendFrameAction: ((bytes: Uint8Array, meta: FrameMeta) => void) | null = null
  let sendNameAction: ((name: string) => void) | null = null
  let myName = ''

  function connect(rawCode: string): string {
    const code = normalizeCode(rawCode)
    // password = code → room contents are E2E encrypted to holders of the code
    room = joinRoom({ appId: APP_ID, password: code }, code)

    const shoot = room.makeAction('shoot')
    sendShootAction = (p) => { shoot.send(p as any) }
    shoot.onMessage = (data, ctx) => h.onShoot?.(data as any as ShootParams, ctx.peerId)

    const frame = room.makeAction('frame')
    sendFrameAction = (bytes, meta) => { frame.send(bytes as any, { metadata: meta as any }) }
    frame.onMessage = (data, ctx) => {
      const meta = ctx.metadata as any as FrameMeta
      bytesToImage(data as any).then((cv) => h.onFrame?.(meta, cv, ctx.peerId)).catch(() => {})
    }

    const name = room.makeAction('name')
    sendNameAction = (n) => { name.send(n) }
    name.onMessage = (data, ctx) => h.onName?.(ctx.peerId, String(data))

    room.onPeerJoin = (id) => {
      partnerId = id
      if (localStream) room!.addStream(localStream, { target: id })
      if (myName) sendNameAction?.(myName)
      h.onPeerJoin?.(id)
    }
    room.onPeerLeave = (id) => {
      if (partnerId === id) partnerId = null
      h.onPeerLeave?.(id)
    }
    room.onPeerStream = (stream, id) => h.onPeerStream?.(stream, id)

    return code
  }

  function setLocalStream(stream: MediaStream) {
    localStream = stream
    if (room) {
      // add to any peers already present
      const peers = Object.keys(room.getPeers())
      if (peers.length) room.addStream(stream)
    }
  }

  function setName(n: string) {
    myName = n
    if (partnerId) sendNameAction?.(n)
  }

  function sendShoot(p: ShootParams) { sendShootAction?.(p) }
  function sendFrame(bytes: Uint8Array, meta: FrameMeta) { sendFrameAction?.(bytes, meta) }

  async function leave() {
    if (room) { try { await room.leave() } catch { /* ignore */ } }
    room = null; partnerId = null
  }

  return {
    connect, setLocalStream, setName, sendShoot, sendFrame, leave,
    getSelfId: () => selfId,
    getPartnerId: () => partnerId,
    hasPartner: () => !!partnerId,
    // deterministic ordering so BOTH peers compose an identical strip:
    // the peer with the lexicographically-smaller id owns the left/first slot.
    amFirst: () => (partnerId ? selfId < partnerId : true),
  }
}

export type Collab = ReturnType<typeof createCollab>

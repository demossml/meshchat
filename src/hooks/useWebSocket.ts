/**
 * useWebSocket
 * Wi-Fi: прямой JSON WebSocket к Meshtastic устройству.
 * Bluetooth: Meshtastic SDK через @meshtastic/transport-web-bluetooth.
 */

import { useCallback, useEffect, useRef } from 'react'
import { MeshDevice, Types } from '@meshtastic/core'
import { TransportWebBluetooth } from '@meshtastic/transport-web-bluetooth'
import { useStore } from '@/store'
import { BROADCAST, CHANNEL_PRESETS, numToId } from '@/lib/types'
import { DEMO_NODES } from '@/lib/demo'
import { decryptE2E, isEncryptedPayload } from '@/lib/crypto'
import { NoiseDmManager } from '@/lib/noiseDm'

const MAX_RETRIES = 20
const BASE_DELAY = 1500
const OUTBOX_MAX_ATTEMPTS = 999
const OUTBOX_BASE_DELAY = 1500
const OUTBOX_MAX_DELAY = 120000
const OUTBOX_POLL_MS = 1000
const OUTBOX_TTL_MS = 45 * 60 * 1000
const MAX_TEXT_PAYLOAD_BYTES = 228
const FRAG_PREFIX = 'mcf1'
const FRAG_CHUNK_BYTES = 170
const FRAG_MAX_PARTS = 24
const FRAG_TTL_MS = 2 * 60 * 1000
const RECEIPT_PREFIX = 'mcr1'
const DEMO_MIN_ACTIVITY_MS = 2800
const DEMO_MAX_ACTIVITY_MS = 5400
const utf8 = new TextEncoder()

type OutgoingLike = {
  type?: unknown
  text?: unknown
  to?: unknown
  channel?: unknown
  secure?: unknown
  clientMsgId?: unknown
}

type SubLike = { unsubscribe?: () => void; unsub?: () => void }
type PacketLike = Record<string, unknown>
type DeliveryError = Error & { retryable?: boolean }
type FragmentAccumulator = {
  createdAt: number
  updatedAt: number
  total: number
  parts: Map<number, string>
}

type ParsedFragment = {
  messageId: string
  partIndex: number
  total: number
  chunk: string
}

type ParsedReceipt = {
  kind: 'delivered' | 'read'
  messageId: string
}

function channelNameFromIndex(index: number | undefined): string {
  if (index === undefined || !Number.isFinite(index)) return 'LongFast'
  return CHANNEL_PRESETS[index]?.name ?? `ch-${index}`
}

function channelIndexFromValue(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw))
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return Math.max(0, n)
    const byName = CHANNEL_PRESETS.findIndex(ch => ch.name.toLowerCase() === raw.toLowerCase())
    if (byName >= 0) return byName
  }
  return 0
}

function toDeviceChannel(index: number): Types.ChannelNumber {
  return Math.min(Types.ChannelNumber.Admin, Math.max(0, index)) as Types.ChannelNumber
}

function closeSubscription(sub: SubLike) {
  if (typeof sub.unsubscribe === 'function') sub.unsubscribe()
  else if (typeof sub.unsub === 'function') sub.unsub()
}

function parseNodeNum(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase()
    if (!v) return null
    if (v.startsWith('!')) {
      const n = parseInt(v.slice(1), 16)
      return Number.isFinite(n) ? n : null
    }
    if (v.startsWith('0x')) {
      const n = parseInt(v.slice(2), 16)
      return Number.isFinite(n) ? n : null
    }
    if (/^[0-9a-f]{8}$/i.test(v)) {
      const n = parseInt(v, 16)
      return Number.isFinite(n) ? n : null
    }
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function makeDeliveryError(message: string, retryable = true): DeliveryError {
  const err = new Error(message) as DeliveryError
  err.retryable = retryable
  return err
}

function utf8Length(text: string): number {
  return utf8.encode(text).byteLength
}

function splitUtf8ByBytes(input: string, maxBytes: number): string[] {
  const out: string[] = []
  let current = ''

  for (const ch of input) {
    const next = current + ch
    if (utf8Length(next) <= maxBytes) {
      current = next
      continue
    }
    if (current) out.push(current)
    current = ch
    if (utf8Length(current) > maxBytes) {
      // fallback: даже один символ слишком большой (крайне редкий случай)
      out.push(current)
      current = ''
    }
  }

  if (current) out.push(current)
  return out
}

function makeFragmentFrames(text: string): string[] {
  if (utf8Length(text) <= MAX_TEXT_PAYLOAD_BYTES) return [text]

  const messageId = Math.random().toString(36).slice(2, 10)
  const chunks = splitUtf8ByBytes(text, FRAG_CHUNK_BYTES)
  if (chunks.length > FRAG_MAX_PARTS) {
    throw makeDeliveryError('Сообщение слишком длинное, сократите текст', false)
  }

  const total = chunks.length
  const frames = chunks.map((chunk, idx) => `${FRAG_PREFIX}:${messageId}:${idx + 1}:${total}:${chunk}`)
  for (const frame of frames) {
    if (utf8Length(frame) > MAX_TEXT_PAYLOAD_BYTES) {
      throw makeDeliveryError('Сообщение слишком длинное, сократите текст', false)
    }
  }
  return frames
}

function parseFragmentFrame(text: string): ParsedFragment | null {
  if (!text.startsWith(`${FRAG_PREFIX}:`)) return null
  const match = /^mcf1:([a-z0-9]+):(\d+):(\d+):(.*)$/s.exec(text)
  if (!match) return null

  const messageId = match[1]
  const partIndex = parseInt(match[2], 10)
  const total = parseInt(match[3], 10)
  const chunk = match[4] ?? ''

  if (!Number.isFinite(partIndex) || !Number.isFinite(total)) return null
  if (partIndex < 1 || total < 1 || partIndex > total || total > FRAG_MAX_PARTS) return null
  return { messageId, partIndex, total, chunk }
}

function makeReceiptFrame(kind: 'delivered' | 'read', messageId: string): string {
  return `${RECEIPT_PREFIX}:${kind}:${messageId}`
}

function parseReceiptFrame(text: string): ParsedReceipt | null {
  if (!text.startsWith(`${RECEIPT_PREFIX}:`)) return null
  const match = /^mcr1:(delivered|read):(.+)$/s.exec(text)
  if (!match) return null
  const kind = match[1] === 'read' ? 'read' : 'delivered'
  const messageId = match[2]?.trim()
  if (!messageId) return null
  return { kind, messageId }
}

function isNetworkMessageId(value: string): boolean {
  return /^\d+-\d+$/.test(value)
}

function randomInRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null
  return items[Math.floor(Math.random() * items.length)] ?? null
}

function demoReplyText(outbound: string, isDm: boolean): string {
  const dmTemplates = [
    'Принял. Ответ через 5 мин.',
    'На связи. Продолжаю движение.',
    'Вижу сообщение, работаю по задаче.',
    'Ок, подтверждаю прием.',
  ]
  const groupTemplates = [
    'Принято всем узлам.',
    'Сигнал стабилен, продолжаем.',
    'Принял, двигаюсь к точке.',
    'Есть контакт, канал чистый.',
  ]
  const base = isDm ? pickRandom(dmTemplates) : pickRandom(groupTemplates)
  if (!base) return isDm ? 'Принял.' : 'Принято.'
  if (outbound.length > 48) return base
  return `${base} (${outbound.slice(0, 24)})`
}

function calcAdaptiveOutboxDelay(nextAttempt: number): number {
  const state = useStore.getState()
  const now = Date.now()
  const recentWindowMs = 20 * 60 * 1000
  const ownRecent = Object.values(state.messages)
    .flat()
    .filter(msg => msg.isOwn && now - msg.ts <= recentWindowMs)
  const completed = ownRecent.filter(msg => ['ack', 'delivered', 'read', 'failed'].includes(msg.status ?? ''))
  const failed = completed.filter(msg => msg.status === 'failed').length
  const loss = completed.length > 0 ? failed / completed.length : 0
  const queueDepth = state.outbox.length

  const expFactor = Math.min(nextAttempt - 1, 7)
  let delay = OUTBOX_BASE_DELAY * Math.pow(2, Math.max(0, expFactor))
  let multiplier = 1

  if (!state.connected) multiplier += 0.7
  if (queueDepth >= 5) multiplier += 0.35
  if (queueDepth >= 10) multiplier += 0.45
  if (loss >= 0.25) multiplier += 0.4
  if (loss >= 0.45) multiplier += 0.4

  const jitter = 0.85 + Math.random() * 0.3
  delay = Math.round(delay * multiplier * jitter)
  return Math.max(OUTBOX_BASE_DELAY, Math.min(OUTBOX_MAX_DELAY, delay))
}

export function useWebSocket(wsUrl: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const meshRef = useRef<MeshDevice | null>(null)
  const bleSubsRef = useRef<SubLike[]>([])
  const noiseRef = useRef<NoiseDmManager | null>(null)
  const fragmentBuffersRef = useRef<Map<string, FragmentAccumulator>>(new Map())
  const deliveredSentRef = useRef<Set<string>>(new Set())
  const readSentRef = useRef<Set<string>>(new Set())
  const demoTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const demoActivityRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demoPacketIdRef = useRef<number>(1_000_000)
  const dead = useRef(false)

  const {
    config,
    isDemo,
    setConnected,
    setConnecting,
    setError,
    setMyNodeId,
    setOwnMessageStatus,
    setOwnMessageStatusByNetworkId,
    enqueueOutbox,
    markOutboxInFlight,
    scheduleOutboxRetry,
    removeOutbox,
    upsertNoisePeerFingerprint,
    onPacket,
    refreshPresence,
  } = useStore()

  const clearDemoTimers = useCallback(() => {
    demoTimersRef.current.forEach(id => clearTimeout(id))
    demoTimersRef.current.clear()
    if (demoActivityRef.current) {
      clearTimeout(demoActivityRef.current)
      demoActivityRef.current = null
    }
  }, [])

  const queueDemoTimer = useCallback((fn: () => void, delayMs: number) => {
    const timerId = setTimeout(() => {
      demoTimersRef.current.delete(timerId)
      fn()
    }, delayMs)
    demoTimersRef.current.add(timerId)
  }, [])

  useEffect(() => {
    const manager = new NoiseDmManager({
      onPeerFingerprint: (peerId, fingerprint) => {
        useStore.getState().upsertNoisePeerFingerprint(peerId, fingerprint)
      },
    })
    noiseRef.current = manager
    void manager.init().catch(() => {
      // no-op
    })
    return () => {
      noiseRef.current = null
    }
  }, [upsertNoisePeerFingerprint])

  const sendRawText = useCallback(async (
    to: number,
    text: string,
    channelIndex: number,
    opts?: { allowFragment?: boolean },
  ): Promise<boolean> => {
    const allowFragment = opts?.allowFragment !== false
    const frames = allowFragment ? makeFragmentFrames(text) : [text]

    for (const frame of frames) {
    if (config?.mode === 'bluetooth') {
      const mesh = meshRef.current
      if (!mesh) return false
      try {
          await mesh.sendText(frame, to, true, toDeviceChannel(channelIndex))
          continue
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        throw makeDeliveryError(message)
      }
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'sendText',
            text: frame,
          to,
          channel: CHANNEL_PRESETS[channelIndex]?.name ?? String(channelIndex),
        }))
          continue
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        throw makeDeliveryError(message)
      }
    }

    return false
    }
    return true
  }, [config])

  const consumeFragmentFrame = useCallback((pkt: PacketLike, text: string): { pending: boolean; text?: string } | null => {
    const parsed = parseFragmentFrame(text)
    if (!parsed) return null

    const now = Date.now()
    const buffers = fragmentBuffersRef.current
    for (const [key, value] of buffers.entries()) {
      if (now - value.updatedAt > FRAG_TTL_MS) buffers.delete(key)
    }

    const fromKey = String(pkt.from ?? pkt.fromId ?? 'unknown')
    const toKey = String(pkt.to ?? 'unknown')
    const channelKey = String(pkt.channel ?? pkt.channelId ?? pkt.channelIndex ?? 'LongFast')
    const streamKey = `${fromKey}|${toKey}|${channelKey}|${parsed.messageId}`

    const prev = buffers.get(streamKey)
    const state: FragmentAccumulator = prev
      ? { ...prev, parts: new Map(prev.parts), total: parsed.total, updatedAt: now }
      : { createdAt: now, updatedAt: now, total: parsed.total, parts: new Map() }

    if (state.total !== parsed.total) {
      buffers.delete(streamKey)
      return { pending: true }
    }

    state.parts.set(parsed.partIndex, parsed.chunk)
    buffers.set(streamKey, state)

    if (state.parts.size < state.total) return { pending: true }

    const ordered: string[] = []
    for (let i = 1; i <= state.total; i += 1) {
      const chunk = state.parts.get(i)
      if (chunk === undefined) return { pending: true }
      ordered.push(chunk)
    }

    buffers.delete(streamKey)
    return { pending: false, text: ordered.join('') }
  }, [])

  const handleReceiptFrame = useCallback((text: string): boolean => {
    const parsed = parseReceiptFrame(text)
    if (!parsed) return false
    setOwnMessageStatusByNetworkId(parsed.messageId, parsed.kind === 'read' ? 'read' : 'delivered')
    return true
  }, [setOwnMessageStatusByNetworkId])

  const maybeSendDeliveryReceipts = useCallback((pkt: PacketLike, text: string) => {
    if (parseReceiptFrame(text)) return

    const fromNum = parseNodeNum(pkt.from ?? pkt.fromId)
    const toNum = parseNodeNum(pkt.to)
    const packetId = typeof pkt.id === 'number' && Number.isFinite(pkt.id) ? pkt.id : null
    const myNum = parseNodeNum(useStore.getState().myNodeId)
    if (fromNum === null || toNum === null || packetId === null || myNum === null) return
    if (toNum === BROADCAST || toNum !== myNum || fromNum === myNum) return

    const messageId = `${fromNum}-${packetId}`
    const channelIndex = channelIndexFromValue(pkt.channel ?? pkt.channelId ?? pkt.channelIndex ?? 0)
    const receiptKey = `${fromNum}|${messageId}`

    if (!deliveredSentRef.current.has(receiptKey)) {
      deliveredSentRef.current.add(receiptKey)
      if (deliveredSentRef.current.size > 4000) deliveredSentRef.current.clear()
      void sendRawText(fromNum, makeReceiptFrame('delivered', messageId), channelIndex, { allowFragment: false })
    }

    const state = useStore.getState()
    const channelRaw = pkt.channel ?? pkt.channelId ?? pkt.channelIndex ?? 'LongFast'
    const channelName = typeof channelRaw === 'string' ? channelRaw : String(channelRaw)
    const fromId = numToId(fromNum)
    const readNow = state.tab === 'chat'
      && state.activeChannel === channelName
      && state.dmTarget?.id === fromId

    if (readNow && !readSentRef.current.has(receiptKey)) {
      readSentRef.current.add(receiptKey)
      if (readSentRef.current.size > 4000) readSentRef.current.clear()
      void sendRawText(fromNum, makeReceiptFrame('read', messageId), channelIndex, { allowFragment: false })
    }
  }, [sendRawText])

  const maybeSendCatchupReadReceipts = useCallback(async () => {
    const state = useStore.getState()
    if (state.tab !== 'chat') return
    if (!state.dmTarget) return

    const peerNum = state.dmTarget.num
    const channelName = state.activeChannel
    const list = state.messages[channelName] ?? []
    if (list.length === 0) return

    const channelIndex = channelIndexFromValue(channelName)
    for (const msg of list) {
      if (msg.isOwn) continue
      if (!Number.isFinite(msg.from) || msg.from !== peerNum) continue

      const messageId = typeof msg.networkMsgId === 'string' && msg.networkMsgId.trim()
        ? msg.networkMsgId
        : msg.id
      if (!isNetworkMessageId(messageId)) continue

      const receiptKey = `${peerNum}|${messageId}`
      if (readSentRef.current.has(receiptKey)) continue
      readSentRef.current.add(receiptKey)
      if (readSentRef.current.size > 4000) readSentRef.current.clear()
      await sendRawText(peerNum, makeReceiptFrame('read', messageId), channelIndex, { allowFragment: false })
    }
  }, [sendRawText])

  const dispatchPacket = useCallback(async (raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      onPacket(raw)
      return
    }

    let pkt = raw as PacketLike
    let text = typeof pkt.text === 'string' ? pkt.text : null

    if (text) {
      const fragmented = consumeFragmentFrame(pkt, text)
      if (fragmented?.pending) return
      if (fragmented?.text !== undefined) {
        text = fragmented.text
        pkt = { ...pkt, text }
      }
    }

    if (text && text.startsWith('nx1:')) {
      const fromNum = parseNodeNum(pkt.from ?? pkt.fromId)
      if (fromNum === null) return
      const fromId = numToId(fromNum)
      const channelIndex = channelIndexFromValue(pkt.channel ?? pkt.channelId ?? pkt.channelIndex ?? 0)
      const manager = noiseRef.current
      if (!manager) return

      try {
        const result = await manager.handleIncoming(fromId, fromNum, channelIndex, text, (to, payload, ch) =>
          sendRawText(to, payload, ch, { allowFragment: false }))
        if (result.type === 'consume') return
        if (result.type === 'plaintext') {
          if (handleReceiptFrame(result.text)) return
          onPacket({ ...pkt, text: result.text, encrypted: true, rawText: text })
          maybeSendDeliveryReceipts(pkt, result.text)
          return
        }
        onPacket({
          ...pkt,
          text: result.text,
          encrypted: true,
          decryptError: 'NOISE_FAIL',
          rawText: text,
        })
      } catch {
        onPacket({
          ...pkt,
          text: '🔐 Noise DM: некорректный пакет',
          encrypted: true,
          decryptError: 'NOISE_FAIL',
          rawText: text,
        })
      }
      return
    }

    if (!text || !isEncryptedPayload(text)) {
      if (text && handleReceiptFrame(text)) return
      onPacket(pkt)
      if (text) maybeSendDeliveryReceipts(pkt, text)
      return
    }

    const { e2eePassphrase } = useStore.getState()
    if (!e2eePassphrase.trim()) {
      onPacket({
        ...pkt,
        text: '🔒 Зашифровано (задайте E2E ключ)',
        encrypted: true,
        decryptError: 'NO_KEY',
        rawText: text,
      })
      return
    }

    try {
      const clearText = await decryptE2E(text, e2eePassphrase)
      if (handleReceiptFrame(clearText)) return
      onPacket({ ...pkt, text: clearText, encrypted: true, rawText: text })
      maybeSendDeliveryReceipts(pkt, clearText)
    } catch {
      onPacket({
        ...pkt,
        text: '🔒 Зашифровано (ключ не подходит)',
        encrypted: true,
        decryptError: 'BAD_KEY',
        rawText: text,
      })
    }
  }, [consumeFragmentFrame, handleReceiptFrame, maybeSendDeliveryReceipts, onPacket, sendRawText])

  const cleanupWifi = useCallback(() => {
    clearTimeout(retryTimerRef.current)
    wsRef.current?.close(1000, 'cleanup')
    wsRef.current = null
    retriesRef.current = 0
  }, [])

  const cleanupBluetooth = useCallback(() => {
    bleSubsRef.current.forEach(closeSubscription)
    bleSubsRef.current = []

    const mesh = meshRef.current
    meshRef.current = null
    if (!mesh) return

    void mesh.disconnect().catch(() => {
      // noop
    })
  }, [])

  const attemptOutboxDelivery = useCallback(async (clientMsgId: string) => {
    const initial = useStore.getState().outbox.find(entry => entry.clientMsgId === clientMsgId)
    if (!initial || initial.inFlight) return false
    if (Date.now() - initial.createdAt > OUTBOX_TTL_MS) {
      setOwnMessageStatus(clientMsgId, 'failed', 'Истек TTL очереди (45 мин)')
      removeOutbox(clientMsgId)
      return false
    }

    markOutboxInFlight(clientMsgId, true)
    let finalizeInFlight = true

    try {
      if (initial.secure === 'noise-dm') {
        if (initial.to === BROADCAST) {
          throw makeDeliveryError('noise dm requires direct message', false)
        }
        const manager = noiseRef.current
        if (!manager) throw makeDeliveryError('noise manager unavailable')

        const peerId = numToId(initial.to)
        const verification = useStore.getState().noisePeers[peerId]
        if (verification && !verification.verified) {
          throw makeDeliveryError('Noise fingerprint не подтвержден', false)
        }
        const ok = await manager.sendDm(peerId, initial.to, initial.channelIndex, initial.text, (to, payload, ch) =>
          sendRawText(to, payload, ch, { allowFragment: false }))
        if (!ok) throw makeDeliveryError('noise dm transport unavailable')
      } else {
        const ok = await sendRawText(initial.to, initial.text, initial.channelIndex, { allowFragment: true })
        if (!ok) throw makeDeliveryError('transport unavailable')
      }

      if (useStore.getState().outbox.some(entry => entry.clientMsgId === clientMsgId)) {
        setOwnMessageStatus(clientMsgId, 'sent')
        removeOutbox(clientMsgId)
        finalizeInFlight = false
      }
      return true
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      const retryable = typeof err === 'object' && err !== null && 'retryable' in err
        ? Boolean((err as DeliveryError).retryable)
        : true

      const current = useStore.getState().outbox.find(entry => entry.clientMsgId === clientMsgId)
      if (!current) return false

      const nextAttempt = current.attempts + 1
      const expired = Date.now() - current.createdAt > OUTBOX_TTL_MS
      if (!retryable || nextAttempt >= OUTBOX_MAX_ATTEMPTS || expired) {
        setOwnMessageStatus(clientMsgId, 'failed', message)
        removeOutbox(clientMsgId)
        if (!retryable || expired) {
          setError(`Не удалось отправить сообщение: ${expired ? 'истек TTL очереди' : message}`)
        }
        finalizeInFlight = false
        return false
      }

      const delay = calcAdaptiveOutboxDelay(nextAttempt)
      setOwnMessageStatus(clientMsgId, 'queued', `Дойдет позже · retry через ~${Math.ceil(delay / 1000)}с`)
      scheduleOutboxRetry(clientMsgId, Date.now() + delay, message)
      finalizeInFlight = false
      return false
    } finally {
      if (finalizeInFlight) markOutboxInFlight(clientMsgId, false)
    }
  }, [markOutboxInFlight, removeOutbox, scheduleOutboxRetry, sendRawText, setError, setOwnMessageStatus])

  const send = useCallback((data: object) => {
    const payload = data as OutgoingLike
    if (payload.type !== 'sendText') return false

    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!text) return false

    const destination = typeof payload.to === 'number' && Number.isFinite(payload.to)
      ? payload.to
      : BROADCAST
    const channelIndex = channelIndexFromValue(payload.channel)
    const secureMode = payload.secure === 'noise-dm' ? 'noise-dm' : undefined
    const clientMsgId = typeof payload.clientMsgId === 'string' && payload.clientMsgId.trim()
      ? payload.clientMsgId
      : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const state = useStore.getState()

    if (secureMode === 'noise-dm' && destination === BROADCAST) {
      setOwnMessageStatus(clientMsgId, 'failed', 'noise dm requires direct message')
      setError('Noise DM поддерживается только для личных сообщений')
      return false
    }

    if (secureMode === 'noise-dm') {
      const peerId = numToId(destination)
      const verification = state.noisePeers[peerId]
      if (verification && !verification.verified) {
        setOwnMessageStatus(clientMsgId, 'failed', 'noise fingerprint not verified')
        setError('Noise fingerprint узла не подтвержден. Подтвердите fingerprint и повторите отправку.')
        return false
      }
    }

    if (state.isDemo) {
      setOwnMessageStatus(clientMsgId, 'queued')
      queueDemoTimer(() => {
        if (!useStore.getState().isDemo) return
        setOwnMessageStatus(clientMsgId, 'sent')
      }, 140)
      queueDemoTimer(() => {
        if (!useStore.getState().isDemo) return
        setOwnMessageStatus(clientMsgId, 'ack')
      }, 380)

      if (destination !== BROADCAST) {
        queueDemoTimer(() => {
          if (!useStore.getState().isDemo) return
          setOwnMessageStatus(clientMsgId, 'delivered')
        }, 900)
        queueDemoTimer(() => {
          if (!useStore.getState().isDemo) return
          setOwnMessageStatus(clientMsgId, 'read')
        }, 1500)
      }

      const myNodeNum = parseNodeNum(state.myNodeId) ?? DEMO_NODES[0].num
      const dmNode = destination !== BROADCAST ? state.nodes[numToId(destination)] : null
      const peers = Object.values(state.nodes).filter(node => node.num !== myNodeNum)
      const sender = dmNode ?? pickRandom(peers)
      const channelName = CHANNEL_PRESETS[channelIndex]?.name ?? String(payload.channel ?? 'LongFast')

      if (sender) {
        const replyDelay = destination === BROADCAST ? randomInRange(1700, 4200) : randomInRange(900, 2300)
        queueDemoTimer(() => {
          const current = useStore.getState()
          if (!current.isDemo) return

          demoPacketIdRef.current += 1
          onPacket({
            type: 'text',
            id: demoPacketIdRef.current,
            from: sender.num,
            to: destination === BROADCAST ? BROADCAST : myNodeNum,
            channel: channelName,
            text: demoReplyText(text, destination !== BROADCAST),
            rxRssi: sender.rssi ?? -88,
            rxSnr: sender.snr ?? 7,
            hopsAway: sender.hopsAway ?? 1,
          })
        }, replyDelay)
      }
      return true
    }

    enqueueOutbox({
      clientMsgId,
      text,
      to: destination,
      channelIndex,
      secure: secureMode,
    })
    setOwnMessageStatus(clientMsgId, 'queued')
    void attemptOutboxDelivery(clientMsgId)
    return true
  }, [attemptOutboxDelivery, enqueueOutbox, onPacket, queueDemoTimer, setError, setOwnMessageStatus])

  const connectWifi = useCallback((url: string) => {
    if (dead.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return

    const socket = new WebSocket(url)
    wsRef.current = socket
    setConnecting(true)

    socket.onopen = () => {
      if (dead.current) return
      retriesRef.current = 0
      setConnected(true)
    }

    socket.onmessage = (e) => {
      if (dead.current) return
      try {
        const data = JSON.parse(e.data)
        void dispatchPacket(data)
      } catch {
        if (e.data instanceof ArrayBuffer || e.data instanceof Blob) return
      }
    }

    socket.onerror = () => {
      if (dead.current) return
      if (retriesRef.current === 0) setError(`Не удалось подключиться к ${url}`)
    }

    socket.onclose = () => {
      if (dead.current) return
      wsRef.current = null
      setConnected(false)

      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current += 1
        const delay = Math.min(BASE_DELAY * Math.pow(1.5, retriesRef.current - 1), 30000)
        setConnecting(true)
        retryTimerRef.current = setTimeout(() => connectWifi(url), delay)
      } else {
        setConnecting(false)
        setError(`Потеряно соединение с ${url}`)
      }
    }
  }, [dispatchPacket, onPacket, setConnected, setConnecting, setError])

  const connectBluetooth = useCallback(async () => {
    if (dead.current) return
    if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
      setConnecting(false)
      setConnected(false)
      setError('Web Bluetooth не поддерживается в этом браузере')
      return
    }

    try {
      setConnecting(true)
      setError(null)
      setConnected(false)

      const transport = await TransportWebBluetooth.create()
      if (dead.current) {
        await transport.disconnect().catch(() => {})
        return
      }

      const mesh = new MeshDevice(transport)
      meshRef.current = mesh

      const subscribe = <T,>(dispatcher: { asEvent: () => { subscribe: (cb: (value: T) => void) => SubLike } }, cb: (value: T) => void) => {
        const sub = dispatcher.asEvent().subscribe(cb)
        bleSubsRef.current.push(sub)
      }

      subscribe(mesh.events.onDeviceStatus, (status) => {
        if (dead.current || meshRef.current !== mesh) return

        switch (status) {
          case Types.DeviceStatusEnum.DeviceConnected:
          case Types.DeviceStatusEnum.DeviceConfigured:
            setConnected(true)
            setConnecting(false)
            break
          case Types.DeviceStatusEnum.DeviceConnecting:
          case Types.DeviceStatusEnum.DeviceConfiguring:
          case Types.DeviceStatusEnum.DeviceReconnecting:
          case Types.DeviceStatusEnum.DeviceRestarting:
            setConnected(false)
            setConnecting(true)
            break
          case Types.DeviceStatusEnum.DeviceDisconnected:
          default:
            setConnected(false)
            setConnecting(false)
            break
        }
      })

      subscribe(mesh.events.onMyNodeInfo, (myInfo: { myNodeNum: number }) => {
        if (dead.current || meshRef.current !== mesh) return
        if (typeof myInfo?.myNodeNum === 'number' && Number.isFinite(myInfo.myNodeNum)) {
          setMyNodeId(numToId(myInfo.myNodeNum))
        }
      })

      subscribe(mesh.events.onMessagePacket, (meta: {
        id: number
        from: number
        to: number
        channel: number
        data: string
      }) => {
        if (dead.current || meshRef.current !== mesh) return
        void dispatchPacket({
          type: 'text',
          id: meta.id,
          from: meta.from,
          to: meta.to,
          channel: channelNameFromIndex(meta.channel),
          text: meta.data,
        })
      })

      subscribe(mesh.events.onUserPacket, (meta: {
        from: number
        data: { longName?: string; shortName?: string; hwModel?: unknown; role?: unknown }
      }) => {
        if (dead.current || meshRef.current !== mesh) return
        onPacket({
          type: 'nodeinfo',
          from: meta.from,
          longName: meta.data?.longName ?? '',
          shortName: meta.data?.shortName ?? '',
          hwModel: String(meta.data?.hwModel ?? ''),
          role: String(meta.data?.role ?? 'CLIENT'),
        })
      })

      subscribe(mesh.events.onPositionPacket, (meta: {
        from: number
        data: { latitudeI?: number; longitudeI?: number; altitude?: number }
      }) => {
        if (dead.current || meshRef.current !== mesh) return
        onPacket({
          type: 'position',
          from: meta.from,
          latitudeI: meta.data?.latitudeI ?? 0,
          longitudeI: meta.data?.longitudeI ?? 0,
          altitude: meta.data?.altitude ?? 0,
        })
      })

      subscribe(mesh.events.onTelemetryPacket, (meta: {
        from: number
        data?: { variant?: { case?: string; value?: { batteryLevel?: number; voltage?: number } } }
      }) => {
        if (dead.current || meshRef.current !== mesh) return
        const variant = meta.data?.variant
        if (variant?.case !== 'deviceMetrics') return
        onPacket({
          type: 'telemetry',
          from: meta.from,
          deviceMetrics: {
            batteryLevel: variant.value?.batteryLevel,
            voltage: variant.value?.voltage,
          },
        })
      })

      subscribe(mesh.events.onNodeInfoPacket, (info: {
        num: number
        user?: { longName?: string; shortName?: string; hwModel?: unknown; role?: unknown }
        position?: { latitudeI?: number; longitudeI?: number; altitude?: number }
        deviceMetrics?: { batteryLevel?: number; voltage?: number }
      }) => {
        if (dead.current || meshRef.current !== mesh) return

        onPacket({
          type: 'nodeinfo',
          from: info.num,
          longName: info.user?.longName ?? '',
          shortName: info.user?.shortName ?? '',
          hwModel: String(info.user?.hwModel ?? ''),
          role: String(info.user?.role ?? 'CLIENT'),
        })

        if (info.position) {
          onPacket({
            type: 'position',
            from: info.num,
            latitudeI: info.position.latitudeI ?? 0,
            longitudeI: info.position.longitudeI ?? 0,
            altitude: info.position.altitude ?? 0,
          })
        }

        if (info.deviceMetrics) {
          onPacket({
            type: 'telemetry',
            from: info.num,
            deviceMetrics: {
              batteryLevel: info.deviceMetrics.batteryLevel,
              voltage: info.deviceMetrics.voltage,
            },
          })
        }
      })

      await mesh.configure()
    } catch (err: unknown) {
      if (dead.current) return
      const message = err instanceof Error ? err.message : 'unknown error'
      setConnected(false)
      setConnecting(false)
      setError(`Bluetooth подключение не удалось: ${message}`)
      cleanupBluetooth()
    }
  }, [cleanupBluetooth, dispatchPacket, onPacket, setConnected, setConnecting, setError, setMyNodeId])

  useEffect(() => {
    dead.current = false
    cleanupWifi()
    cleanupBluetooth()

    if (isDemo && config) {
      setConnected(true)
      setConnecting(false)
      return () => {
        dead.current = true
        cleanupWifi()
        cleanupBluetooth()
      }
    }

    if (!wsUrl || !config) {
      setConnected(false)
      setConnecting(false)
      return () => {
        dead.current = true
        cleanupWifi()
        cleanupBluetooth()
      }
    }

    if (config.mode === 'bluetooth') {
      void connectBluetooth()
    } else {
      connectWifi(wsUrl)
    }

    return () => {
      dead.current = true
      cleanupWifi()
      cleanupBluetooth()
    }
  }, [config, isDemo, wsUrl, connectWifi, connectBluetooth, cleanupBluetooth, cleanupWifi, setConnected, setConnecting])

  useEffect(() => {
    clearDemoTimers()
    if (!isDemo) return

    const spawnDemoTraffic = () => {
      const state = useStore.getState()
      if (!state.isDemo) return

      const myNodeNum = parseNodeNum(state.myNodeId) ?? DEMO_NODES[0].num
      const peers = Object.values(state.nodes).filter(node => node.num !== myNodeNum)
      const sender = pickRandom(peers)
      const channel = pickRandom(state.channels) ?? 'LongFast'
      if (!sender) return

      demoPacketIdRef.current += 1
      onPacket({
        type: 'text',
        id: demoPacketIdRef.current,
        from: sender.num,
        to: BROADCAST,
        channel,
        text: pickRandom([
          'Проверка канала, прием.',
          'Сетка стабильна, двигаюсь по маршруту.',
          'Есть обновление по периметру.',
          'Слышимость нормальная, продолжаю.',
        ]) ?? 'Проверка связи.',
        rxRssi: (sender.rssi ?? -90) + randomInRange(-2, 2),
        rxSnr: (sender.snr ?? 6) + randomInRange(-1, 1),
        hopsAway: sender.hopsAway ?? 1,
      })

      if (Math.random() > 0.55) {
        onPacket({
          type: 'telemetry',
          from: sender.num,
          deviceMetrics: {
            batteryLevel: Math.max(5, Math.min(100, (sender.batteryLevel ?? 45) - randomInRange(0, 1))),
            voltage: Number((3.6 + Math.random() * 0.5).toFixed(2)),
          },
        })
      }

      if (Math.random() > 0.65 && Number.isFinite(sender.lat) && Number.isFinite(sender.lon)) {
        const lat = sender.lat + (Math.random() - 0.5) * 0.001
        const lon = sender.lon + (Math.random() - 0.5) * 0.001
        onPacket({
          type: 'position',
          from: sender.num,
          latitudeI: Math.round(lat * 1e7),
          longitudeI: Math.round(lon * 1e7),
          altitude: Math.round((sender.alt || 150) + randomInRange(-3, 3)),
        })
      }

      demoActivityRef.current = setTimeout(spawnDemoTraffic, randomInRange(DEMO_MIN_ACTIVITY_MS, DEMO_MAX_ACTIVITY_MS))
    }

    demoActivityRef.current = setTimeout(spawnDemoTraffic, randomInRange(1200, 2200))
    return () => clearDemoTimers()
  }, [clearDemoTimers, isDemo, onPacket])

  useEffect(() => () => clearDemoTimers(), [clearDemoTimers])

  useEffect(() => {
    const id = setInterval(() => refreshPresence(), 15000)
    return () => clearInterval(id)
  }, [refreshPresence])

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      const snapshot = useStore.getState().outbox
      snapshot.forEach(entry => {
        if (entry.inFlight) return
        if (entry.nextRetryAt > now) return
        void attemptOutboxDelivery(entry.clientMsgId)
      })
    }, OUTBOX_POLL_MS)
    return () => clearInterval(id)
  }, [attemptOutboxDelivery])

  useEffect(() => {
    const id = setInterval(() => {
      void maybeSendCatchupReadReceipts()
    }, 1200)
    return () => clearInterval(id)
  }, [maybeSendCatchupReadReceipts])

  return { send }
}

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools, persist } from 'zustand/middleware'
import type { MeshNode, ChatMessage, ConnectConfig, Tab, MessageDeliveryStatus } from '@/lib/types'
import { numToId, calcHops, BROADCAST } from '@/lib/types'
import { DEMO_NODES, DEMO_MESSAGES } from '@/lib/demo'

const MAX_MESSAGES = 500
const OFFLINE_MS   = 30 * 60 * 1000  // 30 мин без пакетов = офлайн
const MAX_DIAG_SAMPLES = 180

// ── Типы ─────────────────────────────────────────────────────────

interface AppState {
  // Соединение
  connected:   boolean
  connecting:  boolean
  error:       string | null
  config:      ConnectConfig | null
  wsUrl:       string | null
  myNodeId:    string | null
  isDemo:      boolean

  // Данные
  nodes:    Record<string, MeshNode>
  messages: Record<string, ChatMessage[]>
  unread:   Record<string, number>
  channels: string[]
  outbox:   OutboxEntry[]
  diagHistory: Record<string, NodeDiagSample[]>
  noisePeers: Record<string, NoisePeerVerification>
  groupProfiles: GroupProfile[]
  channelPrefs: Record<string, ChannelPrefs>
  historyJump: HistoryJumpTarget | null

  // UI
  tab:          Tab
  activeChannel: string
  dmTarget:     MeshNode | null
  sidebarOpen:  boolean
  inputText:    string
  mapCenter:    [number, number] | null
  e2eeEnabled:  boolean
  e2eePassphrase: string
  noiseDmEnabled: boolean
  onboardingCompleted: boolean
  securityEnabled: boolean
  securityUnlocked: boolean
  securityPinHash: string | null
  securityPinSalt: string | null
  securityBiometricEnabled: boolean
  securityCredentialId: string | null

  // ── Actions ──
  connect:    (cfg: ConnectConfig) => void
  disconnect: () => void
  setConnected:  (v: boolean) => void
  setConnecting: (v: boolean) => void
  setError:      (e: string | null) => void
  setMyNodeId:   (id: string) => void

  onPacket:       (raw: unknown) => void
  addOwnMessage:  (text: string, opts?: { encrypted?: boolean; clientMsgId?: string; secureMode?: 'noise-dm' | 'e2ee' }) => ChatMessage
  setOwnMessageStatus: (clientMsgId: string, status: MessageDeliveryStatus, sendError?: string | null) => void
  setOwnMessageStatusByNetworkId: (networkMsgId: string, status: MessageDeliveryStatus) => void
  enqueueOutbox: (entry: Omit<OutboxEntry, 'attempts' | 'nextRetryAt' | 'createdAt' | 'inFlight' | 'lastError'>) => void
  markOutboxInFlight: (clientMsgId: string, inFlight: boolean) => void
  scheduleOutboxRetry: (clientMsgId: string, nextRetryAt: number, lastError?: string) => void
  removeOutbox: (clientMsgId: string) => void
  upsertNoisePeerFingerprint: (peerId: string, fingerprint: string) => void
  setNoisePeerVerified: (peerId: string, verified: boolean) => void
  upsertGroupProfile: (profile: Omit<GroupProfile, 'updatedAt' | 'createdAt' | 'lastUsedAt'>) => void
  removeGroupProfile: (profileId: string) => void
  touchGroupProfile: (profileId: string) => void
  setChannelPinned: (ch: string, pinned: boolean) => void
  setChannelMuted: (ch: string, muted: boolean) => void
  jumpToMessage: (channel: string, messageId: string) => void
  clearHistoryJump: () => void
  markNodeOnline: (nodeId: string) => void
  refreshPresence: () => void

  setTab:           (t: Tab) => void
  setActiveChannel: (ch: string) => void
  setDmTarget:      (n: MeshNode | null) => void
  toggleSidebar:    () => void
  setSidebarOpen:   (v: boolean) => void
  setInputText:     (t: string) => void
  setMapCenter:     (p: [number, number]) => void
  markRead:         (ch: string) => void
  setE2EEEnabled:   (v: boolean) => void
  setE2EEPassphrase:(v: string) => void
  setNoiseDmEnabled:(v: boolean) => void
  completeOnboarding: () => void
  setSecurityPin: (hash: string, salt: string) => void
  disableSecurity: () => void
  lockSecurity: () => void
  unlockSecurity: () => void
  setSecurityBiometric: (enabled: boolean, credentialId?: string | null) => void
  loadDemo:         () => void
}

export interface OutboxEntry {
  clientMsgId: string
  text: string
  to: number
  channelIndex: number
  secure?: 'noise-dm'
  attempts: number
  nextRetryAt: number
  createdAt: number
  inFlight: boolean
  lastError?: string
}

export interface NodeDiagSample {
  ts: number
  rssi?: number
  snr?: number
  hops?: number
}

export interface NoisePeerVerification {
  peerId: string
  fingerprint: string
  verified: boolean
  firstSeenAt: number
  updatedAt: number
}

export interface ChannelPrefs {
  pinned: boolean
  muted: boolean
}

export interface GroupProfile {
  id: string
  name: string
  channel: string
  key: string
  createdAt: number
  updatedAt: number
  lastUsedAt: number
}

export interface HistoryJumpTarget {
  channel: string
  messageId: string
  nonce: number
}

// ── Helpers ───────────────────────────────────────────────────────

function ensureChannel(s: AppState, ch: string) {
  if (!s.messages[ch]) s.messages[ch] = []
  if (!s.unread[ch])   s.unread[ch]   = 0
  if (!s.channelPrefs[ch]) s.channelPrefs[ch] = { pinned: false, muted: false }
  if (!s.channels.includes(ch)) s.channels.push(ch)
}

function pushDiagSample(s: AppState, nodeId: string, sample: NodeDiagSample) {
  if (sample.rssi === undefined && sample.snr === undefined && sample.hops === undefined) return
  const list = s.diagHistory[nodeId] ?? []
  list.push(sample)
  if (list.length > MAX_DIAG_SAMPLES) {
    list.splice(0, list.length - MAX_DIAG_SAMPLES)
  }
  s.diagHistory[nodeId] = list
}

function statusRank(status: MessageDeliveryStatus | undefined): number {
  switch (status) {
    case 'queued': return 1
    case 'sent': return 2
    case 'ack': return 3
    case 'delivered': return 4
    case 'read': return 5
    case 'failed': return 0
    default: return 0
  }
}

// ── Store ─────────────────────────────────────────────────────────

export const useStore = create<AppState>()(
  devtools(
    immer(
      persist(
        (set, get) => ({
          connected:    false,
          connecting:   false,
          error:        null,
          config:       null,
          wsUrl:        null,
          myNodeId:     null,
          isDemo:       false,
          nodes:        {},
          messages:     { LongFast: [] },
          unread:       { LongFast: 0 },
          channels:     ['LongFast'],
          outbox:       [],
          diagHistory:  {},
          noisePeers:   {},
          groupProfiles: [],
          channelPrefs: { LongFast: { pinned: true, muted: false } },
          historyJump:  null,
          tab:          'chat',
          activeChannel: 'LongFast',
          dmTarget:     null,
          sidebarOpen:  false,
          inputText:    '',
          mapCenter:    null,
          e2eeEnabled:  false,
          e2eePassphrase: '',
          noiseDmEnabled: false,
          onboardingCompleted: false,
          securityEnabled: false,
          securityUnlocked: false,
          securityPinHash: null,
          securityPinSalt: null,
          securityBiometricEnabled: false,
          securityCredentialId: null,

          // ── Connection ──────────────────────────────────────────

          connect: (cfg) => set(s => {
            s.config     = cfg
            s.wsUrl      = cfg.mode === 'wifi'
              ? `ws://${cfg.host}:${cfg.port}${cfg.path}`
              : 'ble://meshtastic'
            s.myNodeId   = null
            s.isDemo     = false
            s.connecting = true
            s.error      = null
          }),

          disconnect: () => set(s => {
            s.connected  = false
            s.connecting = false
            s.wsUrl      = null
            s.config     = null
            s.myNodeId   = null
            s.isDemo     = false
            s.nodes      = {}
            s.messages   = { LongFast: [] }
            s.unread     = { LongFast: 0 }
            s.channels   = ['LongFast']
            s.outbox     = []
            s.diagHistory = {}
            s.noisePeers = {}
            s.channelPrefs = { LongFast: { pinned: true, muted: false } }
            s.historyJump = null
            s.error      = null
          }),

          setConnected:  (v) => set(s => {
            s.connected = v
            if (v) {
              s.connecting = false
              s.error = null
            } else {
              Object.values(s.nodes).forEach(n => { n.isOnline = false })
            }
          }),
          setConnecting: (v) => set(s => { s.connecting = v }),
          setError:      (e) => set(s => { s.error = e; s.connecting = false }),
          setMyNodeId:   (id) => set(s => { s.myNodeId = id }),

          // ── Входящие пакеты ─────────────────────────────────────

          onPacket: (raw) => set(s => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pkt = raw as any
            if (!pkt || typeof pkt !== 'object') return

            const rawFrom = pkt.from ?? pkt.fromId ?? 0
            const fromNum = (() => {
              if (typeof rawFrom === 'number' && Number.isFinite(rawFrom)) return rawFrom
              if (typeof rawFrom === 'string') {
                const v = rawFrom.trim().toLowerCase()
                if (v.startsWith('!')) return parseInt(v.slice(1), 16)
                if (v.startsWith('0x')) return parseInt(v.slice(2), 16)
                if (/^[0-9a-f]{8}$/i.test(v)) return parseInt(v, 16)
                return parseInt(v, 10)
              }
              return 0
            })()
            const safeFromNum = Number.isFinite(fromNum) ? fromNum : 0
            const fromId = typeof rawFrom === 'string' && rawFrom.startsWith('!')
              ? rawFrom.toLowerCase()
              : numToId(safeFromNum)
            const rssi = typeof pkt.rxRssi === 'number' && Number.isFinite(pkt.rxRssi) ? pkt.rxRssi : undefined
            const snr = typeof pkt.rxSnr === 'number' && Number.isFinite(pkt.rxSnr) ? pkt.rxSnr : undefined
            const hops = (() => {
              if (typeof pkt.hopsAway === 'number' && Number.isFinite(pkt.hopsAway)) return pkt.hopsAway
              if (typeof pkt.hops === 'number' && Number.isFinite(pkt.hops)) return pkt.hops
              if (typeof pkt.hopStart === 'number' && Number.isFinite(pkt.hopStart) &&
                  typeof pkt.hopLimit === 'number' && Number.isFinite(pkt.hopLimit)) {
                return calcHops(pkt)
              }
              return undefined
            })()
            const now     = Date.now()
            pushDiagSample(s, fromId, { ts: now, rssi, snr, hops })

            // Пытаемся вычислить ID текущего устройства из служебных полей пакета
            if (!s.myNodeId) {
              const hintedNum = pkt.myNodeNum ?? pkt.myNodeNumber ?? pkt.localNodeNum
              if (typeof hintedNum === 'number' && Number.isFinite(hintedNum)) {
                s.myNodeId = numToId(hintedNum)
              }

              const hintedId = pkt.myNodeId ?? pkt.localNodeId
              if (!s.myNodeId && typeof hintedId === 'string') {
                if (hintedId.startsWith('!')) s.myNodeId = hintedId.toLowerCase()
                else if (/^[0-9a-f]{8}$/i.test(hintedId)) s.myNodeId = `!${hintedId.toLowerCase()}`
              }

              if (!s.myNodeId && (pkt.isLocal === true || pkt.local === true) && safeFromNum) {
                s.myNodeId = fromId
              }
            }

            // Обновляем lastHeard для любого пакета
            if (s.nodes[fromId]) {
              s.nodes[fromId].lastHeard = now
              s.nodes[fromId].isOnline  = true
              if (rssi !== undefined) s.nodes[fromId].rssi = rssi
              if (snr  !== undefined) s.nodes[fromId].snr  = snr
              if (hops !== undefined)        s.nodes[fromId].hopsAway = hops
            }

            const type = (pkt.type ?? '').toLowerCase()

            // ── TEXT ──
            if (type === 'text' || pkt.text) {
              const text = pkt.text ?? pkt.payload?.text ?? ''
              if (!text) return

              // Определяем канал из пакета (Meshtastic отдаёт channelId или channelIndex)
              const rawChannel = pkt.channel ?? pkt.channelId ?? pkt.channelIndex ?? 'LongFast'
              const ch = typeof rawChannel === 'string' ? rawChannel : String(rawChannel)
              ensureChannel(s, ch)
              const to = typeof pkt.to === 'number' && Number.isFinite(pkt.to) ? pkt.to : BROADCAST
              const isOwn = fromId === s.myNodeId
              const msgId = `${safeFromNum}-${pkt.id ?? now}`

              // Если это эхо нашего исходящего сообщения, апдейтим существующий optimistic bubble до ACK и не дублируем
              if (isOwn) {
                for (let i = s.messages[ch].length - 1; i >= 0; i -= 1) {
                  const own = s.messages[ch][i]
                  if (!own.isOwn) continue
                  if (own.status === 'ack' || own.status === 'delivered' || own.status === 'read') continue
                  if (now - own.ts > 10 * 60_000) continue
                  if (own.text !== text) continue
                  if (own.to !== to) continue

                  own.status = 'ack'
                  own.ack = true
                  own.sentAt = own.sentAt ?? own.ts
                  own.ackAt = own.ackAt ?? now
                  own.networkMsgId = msgId
                  own.deliveredAt = undefined
                  own.readAt = undefined
                  own.sendError = undefined
                  if (rssi !== undefined) own.rssi = rssi
                  if (snr !== undefined) own.snr = snr
                  if (hops !== undefined) own.hops = hops
                  if (pkt.encrypted === true) own.encrypted = true
                  if (typeof pkt.rawText === 'string') own.rawText = pkt.rawText
                  if (own.clientMsgId) {
                    s.outbox = s.outbox.filter(entry => entry.clientMsgId !== own.clientMsgId)
                  }
                  return
                }
              }

              if (s.messages[ch].some(m => m.id === msgId)) return  // дедупликация

              const node = s.nodes[fromId]
              const msg: ChatMessage = {
                id:       msgId,
                from:     safeFromNum,
                fromId,
                fromName: node?.longName || node?.shortName || fromId,
                to,
                channel:  ch,
                text,
                ts:       now,
                rssi,
                snr,
                hops,
                isOwn,
                status:   isOwn ? 'ack' : undefined,
                ack:      isOwn ? true : undefined,
                encrypted: pkt.encrypted === true,
                decryptError: typeof pkt.decryptError === 'string' ? pkt.decryptError : undefined,
                rawText: typeof pkt.rawText === 'string' ? pkt.rawText : undefined,
              }

              s.messages[ch].push(msg)
              if (s.messages[ch].length > MAX_MESSAGES) {
                s.messages[ch] = s.messages[ch].slice(-MAX_MESSAGES)
              }

              if (s.activeChannel !== ch && !msg.isOwn && !s.channelPrefs[ch]?.muted) {
                s.unread[ch] = (s.unread[ch] || 0) + 1
              }
            }

            // ── NODEINFO ──
            if (type === 'nodeinfo' || pkt.longName || pkt.shortName) {
              const n: Partial<MeshNode> & { num: number; id: string } = {
                num:      safeFromNum,
                id:       fromId,
                longName:  pkt.longName  ?? pkt.payload?.longname  ?? '',
                shortName: pkt.shortName ?? pkt.payload?.shortname ?? '',
                hwModel:   pkt.hwModel   ?? pkt.payload?.hwModel   ?? '',
                role:      pkt.role      ?? pkt.payload?.role       ?? 'CLIENT',
                lastHeard: now,
                isOnline:  true,
                hopsAway:  hops,
              }
              const prevNode = s.nodes[fromId]
              s.nodes[fromId] = {
                ...(prevNode ?? { lat: 0, lon: 0, alt: 0, rssi: undefined, snr: undefined, batteryLevel: undefined, voltage: undefined }),
                ...n,
              }

              // Fallback: если узел назван так же, как owner, считаем его "своим"
              if (!s.myNodeId && s.config?.name) {
                const ownerName = s.config.name.trim().toLowerCase()
                const ownerShort = s.config.name.slice(0, 4).toUpperCase()
                const longName = (n.longName ?? '').toLowerCase()
                const shortName = (n.shortName ?? '').toUpperCase()
                if (longName === ownerName || shortName === ownerShort) {
                  s.myNodeId = fromId
                }
              }

              // Обновляем имена в истории
              const displayName = n.longName || n.shortName || fromId
              Object.values(s.messages).forEach(arr => {
                arr.forEach(m => { if (m.fromId === fromId) m.fromName = displayName })
              })
            }

            // ── POSITION ──
            if (type === 'position' || pkt.latitudeI !== undefined) {
              const lat = (pkt.latitudeI  ?? pkt.payload?.latitudeI  ?? 0) * 1e-7
              const lon = (pkt.longitudeI ?? pkt.payload?.longitudeI ?? 0) * 1e-7
              const alt =  pkt.altitude   ?? pkt.payload?.altitude   ?? 0
              if (!s.nodes[fromId]) {
                s.nodes[fromId] = { num: safeFromNum, id: fromId, longName: fromId, shortName: '', hwModel: '', role: 'CLIENT', lat, lon, alt, lastHeard: now, isOnline: true }
              } else {
                s.nodes[fromId].lat = lat
                s.nodes[fromId].lon = lon
                s.nodes[fromId].alt = alt
              }
              if (lat && lon && !s.mapCenter) s.mapCenter = [lat, lon]
            }

            // ── TELEMETRY ──
            if (type === 'telemetry' || pkt.deviceMetrics) {
              const dm = pkt.deviceMetrics ?? pkt.payload?.deviceMetrics
              if (dm && s.nodes[fromId]) {
                if (dm.batteryLevel !== undefined) s.nodes[fromId].batteryLevel = dm.batteryLevel
                if (dm.voltage      !== undefined) s.nodes[fromId].voltage      = dm.voltage
              }
            }
          }),

          // ── Исходящее сообщение (оптимистичный UI) ─────────────

          addOwnMessage: (text, opts) => {
            const { config, myNodeId, activeChannel, dmTarget } = get()
            const ch = activeChannel
            const to = dmTarget ? dmTarget.num : BROADCAST
            const clientMsgId = opts?.clientMsgId ?? `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            const msg: ChatMessage = {
              id:       `own-${clientMsgId}`,
              from:     myNodeId ? parseInt(myNodeId.replace('!', ''), 16) : 0,
              fromId:   myNodeId ?? '!00000000',
              fromName: config?.name ?? 'Me',
              to,
              channel:  ch,
              text,
              ts:       Date.now(),
              isOwn:    true,
              status:   'queued',
              ack:      false,
              clientMsgId,
              sendAttempts: 0,
              secureMode: opts?.secureMode,
              encrypted: opts?.encrypted === true,
            }
            set(s => {
              ensureChannel(s, ch)
              s.messages[ch].push(msg)
            })
            return msg
          },

          setOwnMessageStatus: (clientMsgId, status, sendError = null) => set(s => {
            const now = Date.now()
            for (const list of Object.values(s.messages)) {
              const msg = list.find(m => m.clientMsgId === clientMsgId)
              if (!msg) continue
              msg.status = status
              msg.ack = status === 'ack' || status === 'delivered' || status === 'read'
              if (status === 'queued') {
                msg.sendAttempts = Math.max(1, msg.sendAttempts ?? 0)
              } else if (status === 'sent') {
                msg.sentAt = msg.sentAt ?? now
                msg.sendAttempts = Math.max(1, msg.sendAttempts ?? 0)
              } else if (status === 'ack') {
                msg.sentAt = msg.sentAt ?? msg.ts
                msg.ackAt = msg.ackAt ?? now
              }
              if (status === 'delivered') {
                msg.sentAt = msg.sentAt ?? msg.ts
                msg.ackAt = msg.ackAt ?? now
                msg.deliveredAt = msg.deliveredAt ?? now
              } else if (status === 'read') {
                msg.sentAt = msg.sentAt ?? msg.ts
                msg.ackAt = msg.ackAt ?? now
                msg.deliveredAt = msg.deliveredAt ?? now
                msg.readAt = msg.readAt ?? now
              } else if (status === 'queued' || status === 'sent' || status === 'ack') {
                msg.deliveredAt = undefined
                msg.readAt = undefined
              }
              if (status === 'failed') msg.sendError = sendError ?? 'send failed'
              else if (status === 'queued' && sendError) msg.sendError = sendError
              else msg.sendError = undefined
              return
            }
          }),

          setOwnMessageStatusByNetworkId: (networkMsgId, status) => set(s => {
            const targetRank = statusRank(status)
            const now = Date.now()
            for (const list of Object.values(s.messages)) {
              const msg = list.find(m => m.isOwn && (m.networkMsgId === networkMsgId || m.id === networkMsgId))
              if (!msg) continue
              const currentRank = statusRank(msg.status)
              if (targetRank >= currentRank) {
                msg.status = status
                msg.ack = status === 'ack' || status === 'delivered' || status === 'read'
                if (status === 'delivered') {
                  msg.sentAt = msg.sentAt ?? msg.ts
                  msg.ackAt = msg.ackAt ?? now
                  msg.deliveredAt = msg.deliveredAt ?? now
                } else if (status === 'read') {
                  msg.sentAt = msg.sentAt ?? msg.ts
                  msg.ackAt = msg.ackAt ?? now
                  msg.deliveredAt = msg.deliveredAt ?? now
                  msg.readAt = msg.readAt ?? now
                }
                if (status !== 'failed') msg.sendError = undefined
              }
              return
            }
          }),

          enqueueOutbox: (entry) => set(s => {
            if (s.outbox.some(item => item.clientMsgId === entry.clientMsgId)) return
            const now = Date.now()
            s.outbox.push({
              ...entry,
              attempts: 0,
              nextRetryAt: now,
              createdAt: now,
              inFlight: false,
              lastError: undefined,
            })
            for (const list of Object.values(s.messages)) {
              const msg = list.find(item => item.clientMsgId === entry.clientMsgId)
              if (!msg) continue
              msg.sendAttempts = Math.max(1, msg.sendAttempts ?? 0)
              break
            }
          }),

          markOutboxInFlight: (clientMsgId, inFlight) => set(s => {
            const item = s.outbox.find(entry => entry.clientMsgId === clientMsgId)
            if (!item) return
            item.inFlight = inFlight
          }),

          scheduleOutboxRetry: (clientMsgId, nextRetryAt, lastError) => set(s => {
            const item = s.outbox.find(entry => entry.clientMsgId === clientMsgId)
            if (!item) return
            item.attempts += 1
            item.nextRetryAt = nextRetryAt
            item.inFlight = false
            item.lastError = lastError
            for (const list of Object.values(s.messages)) {
              const msg = list.find(entry => entry.clientMsgId === clientMsgId)
              if (!msg) continue
              msg.sendAttempts = Math.max(msg.sendAttempts ?? 1, item.attempts + 1)
              break
            }
          }),

          removeOutbox: (clientMsgId) => set(s => {
            s.outbox = s.outbox.filter(entry => entry.clientMsgId !== clientMsgId)
          }),

          upsertNoisePeerFingerprint: (peerId, fingerprint) => set(s => {
            const now = Date.now()
            const prev = s.noisePeers[peerId]
            if (prev && prev.fingerprint === fingerprint) {
              prev.updatedAt = now
              return
            }

            s.noisePeers[peerId] = {
              peerId,
              fingerprint,
              verified: false,
              firstSeenAt: prev?.firstSeenAt ?? now,
              updatedAt: now,
            }
          }),

          setNoisePeerVerified: (peerId, verified) => set(s => {
            const peer = s.noisePeers[peerId]
            if (!peer) return
            peer.verified = verified
            peer.updatedAt = Date.now()
          }),

          upsertGroupProfile: (profile) => set(s => {
            const now = Date.now()
            const id = profile.id.trim()
            if (!id) return
            const existing = s.groupProfiles.find(item => item.id === id)
            if (!existing) {
              s.groupProfiles.unshift({
                id,
                name: profile.name.trim(),
                channel: profile.channel.trim(),
                key: profile.key.trim(),
                createdAt: now,
                updatedAt: now,
                lastUsedAt: now,
              })
              return
            }
            existing.name = profile.name.trim()
            existing.channel = profile.channel.trim()
            existing.key = profile.key.trim()
            existing.updatedAt = now
          }),

          removeGroupProfile: (profileId) => set(s => {
            s.groupProfiles = s.groupProfiles.filter(item => item.id !== profileId)
          }),

          touchGroupProfile: (profileId) => set(s => {
            const target = s.groupProfiles.find(item => item.id === profileId)
            if (!target) return
            target.lastUsedAt = Date.now()
            target.updatedAt = Date.now()
          }),

          setChannelPinned: (ch, pinned) => set(s => {
            ensureChannel(s, ch)
            s.channelPrefs[ch].pinned = pinned
          }),

          setChannelMuted: (ch, muted) => set(s => {
            ensureChannel(s, ch)
            s.channelPrefs[ch].muted = muted
            if (muted) s.unread[ch] = 0
          }),

          jumpToMessage: (channel, messageId) => set(s => {
            ensureChannel(s, channel)
            s.activeChannel = channel
            s.tab = 'chat'
            s.dmTarget = null
            s.unread[channel] = 0
            s.historyJump = { channel, messageId, nonce: Date.now() }
          }),

          clearHistoryJump: () => set(s => {
            s.historyJump = null
          }),

          markNodeOnline: (nodeId) => set(s => {
            if (s.nodes[nodeId]) { s.nodes[nodeId].isOnline = true; s.nodes[nodeId].lastHeard = Date.now() }
          }),

          refreshPresence: () => set(s => {
            const now = Date.now()
            Object.values(s.nodes).forEach(node => {
              node.isOnline = now - node.lastHeard <= OFFLINE_MS
            })
          }),

          // ── UI Actions ──────────────────────────────────────────

          setTab:    (t)  => set(s => { s.tab = t }),
          setDmTarget: (n) => set(s => { s.dmTarget = n }),
          toggleSidebar:   () => set(s => { s.sidebarOpen = !s.sidebarOpen }),
          setSidebarOpen:  (v) => set(s => { s.sidebarOpen = v }),
          setInputText:    (t) => set(s => { s.inputText = t }),
          setMapCenter:    (p) => set(s => { s.mapCenter = p }),
          markRead: (ch) => set(s => { s.unread[ch] = 0 }),
          setE2EEEnabled: (v) => set(s => { s.e2eeEnabled = v }),
          setE2EEPassphrase: (v) => set(s => { s.e2eePassphrase = v }),
          setNoiseDmEnabled: (v) => set(s => { s.noiseDmEnabled = v }),
          completeOnboarding: () => set(s => { s.onboardingCompleted = true }),
          setSecurityPin: (hash, salt) => set(s => {
            s.securityEnabled = true
            s.securityUnlocked = true
            s.securityPinHash = hash
            s.securityPinSalt = salt
          }),
          disableSecurity: () => set(s => {
            s.securityEnabled = false
            s.securityUnlocked = false
            s.securityPinHash = null
            s.securityPinSalt = null
            s.securityBiometricEnabled = false
            s.securityCredentialId = null
          }),
          lockSecurity: () => set(s => {
            if (!s.securityEnabled) return
            s.securityUnlocked = false
          }),
          unlockSecurity: () => set(s => {
            if (!s.securityEnabled) return
            s.securityUnlocked = true
          }),
          setSecurityBiometric: (enabled, credentialId = null) => set(s => {
            s.securityBiometricEnabled = enabled
            s.securityCredentialId = enabled ? credentialId ?? s.securityCredentialId : null
          }),

          setActiveChannel: (ch) => set(s => {
            s.activeChannel = ch
            s.tab     = 'chat'
            s.dmTarget = null
            s.unread[ch] = 0
            ensureChannel(s, ch)
          }),

          // ── Demo ────────────────────────────────────────────────

          loadDemo: () => set(s => {
            s.connected  = true
            s.connecting = false
            s.config     = { mode: 'wifi', name: 'Base-Station (Demo)', host: '192.168.0.1', port: 80, path: '/ws' }
            s.wsUrl      = null
            s.myNodeId   = '!abcd1234'
            s.isDemo     = true
            s.nodes      = {}
            DEMO_NODES.forEach(n => { s.nodes[n.id] = n })
            s.messages   = { LongFast: [], MediumSlow: [], ShortFast: [] }
            s.unread     = { LongFast: 0, MediumSlow: 0, ShortFast: 1 }
            s.channels   = ['LongFast', 'MediumSlow', 'ShortFast']
            s.outbox     = []
            s.diagHistory = {}
            s.noisePeers = {}
            s.channelPrefs = {
              LongFast: { pinned: true, muted: false },
              MediumSlow: { pinned: false, muted: false },
              ShortFast: { pinned: false, muted: false },
            }
            s.historyJump = null
            DEMO_MESSAGES.forEach(m => { s.messages[m.channel]?.push(m) })
            s.activeChannel = 'LongFast'
            s.mapCenter  = [55.7558, 37.6173]
          }),
        }),
        {
          name: 'meshchat-v2',
          partialize: (s) => ({
            config: s.config,
            isDemo: s.isDemo,
            activeChannel: s.activeChannel,
            noisePeers: s.noisePeers,
            groupProfiles: s.groupProfiles,
            channelPrefs: s.channelPrefs,
            onboardingCompleted: s.onboardingCompleted,
            securityEnabled: s.securityEnabled,
            securityPinHash: s.securityPinHash,
            securityPinSalt: s.securityPinSalt,
            securityBiometricEnabled: s.securityBiometricEnabled,
            securityCredentialId: s.securityCredentialId,
          }),
        }
      )
    ),
    { name: 'MeshChat' }
  )
)

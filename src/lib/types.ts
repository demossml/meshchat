// ─── Meshtastic протокол ─────────────────────────────────────────

/** Узел в mesh-сети */
export interface MeshNode {
  num:         number    // uint32 nodeNum
  id:          string    // '!abcd1234'
  longName:    string
  shortName:   string
  hwModel:     string
  role:        string    // CLIENT | ROUTER | ROUTER_CLIENT | REPEATER | ...
  lat:         number    // decimal degrees (0 если нет GPS)
  lon:         number
  alt:         number
  lastHeard:   number    // Date.now()
  snr?:        number
  rssi?:       number
  hopsAway?:   number
  batteryLevel?: number  // 0–100
  voltage?:    number
  isOnline:    boolean
}

/** Сообщение в чате */
export type MessageDeliveryStatus = 'queued' | 'sent' | 'ack' | 'delivered' | 'read' | 'failed'

export interface ChatMessage {
  id:       string    // уникальный ID
  from:     number    // nodeNum
  fromId:   string    // '!abcd1234'
  fromName: string
  to:       number    // 0xffffffff = broadcast
  channel:  string    // 'LongFast' | 'MediumSlow' | ...
  text:     string
  ts:       number    // Date.now()
  rssi?:    number
  snr?:     number
  hops?:    number
  isOwn?:   boolean
  ack?:     boolean   // подтверждено устройством
  status?:  MessageDeliveryStatus
  clientMsgId?: string
  networkMsgId?: string
  deliveredAt?: number
  readAt?: number
  sendError?: string
  secureMode?: 'noise-dm' | 'e2ee'
  encrypted?: boolean
  decryptError?: string
  rawText?: string
}

/** Входящий пакет от Meshtastic устройства по WebSocket */
export interface MeshtasticPacket {
  type: 'nodeinfo' | 'text' | 'position' | 'telemetry' | 'routing' | 'rangetest' | string
  from?: number
  to?:   number
  id?:   number
  rxSnr?: number
  rxRssi?: number
  hopLimit?: number
  hopStart?: number
  channel?: number
  // Зависит от type:
  text?:     string
  payload?:  Record<string, unknown>
}

// ─── UI State ─────────────────────────────────────────────────────

export type Tab = 'chat' | 'map' | 'nodes'

export type ConnectMode = 'wifi' | 'bluetooth'

export type ConnectConfig =
  | {
      mode: 'wifi'
      name: string   // отображаемое имя пользователя
      host: string   // IP Meshtastic устройства
      port: number   // порт WebSocket (обычно 80)
      path: string   // путь WS (обычно /ws)
    }
  | {
      mode: 'bluetooth'
      name: string   // отображаемое имя пользователя
    }

export const BROADCAST = 0xffffffff

export const CHANNEL_PRESETS = [
  { name: 'LongFast',   color: '#fafafa' },
  { name: 'MediumSlow', color: '#e4e4e7' },
  { name: 'ShortFast',  color: '#d4d4d8' },
  { name: 'LongSlow',   color: '#a1a1aa' },
  { name: 'MediumFast', color: '#71717a' },
]

export function numToId(n: number): string {
  return `!${n.toString(16).padStart(8, '0')}`
}

export function idToNum(id: string): number {
  return parseInt(id.replace('!', ''), 16)
}

export function calcHops(p: { hopStart?: number; hopLimit?: number }): number {
  if (p.hopStart !== undefined && p.hopLimit !== undefined) return p.hopStart - p.hopLimit
  return 0
}

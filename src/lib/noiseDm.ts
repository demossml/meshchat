const PROTOCOL_NAME = 'Noise_XX_P256_AESGCM_SHA256_MESHCHAT_V1'
const NONCE_ZERO = new Uint8Array(12)
const MAX_DM_PAYLOAD = 220

const enc = new TextEncoder()
const dec = new TextDecoder()

type Role = 'initiator' | 'responder'

type KeyPair = {
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicRaw: Uint8Array
}

type InitHandshake = {
  kind: 'init'
  ePriv: CryptoKey
  channelIndex: number
  pending: string[]
}

type RespHandshake = {
  kind: 'resp'
  ePriv: CryptoKey
  ck: Uint8Array
  msg3Key: CryptoKey
  channelIndex: number
}

type Session = {
  sendKey: CryptoKey
  recvKey: CryptoKey
  sendPrefix: Uint8Array
  sendCounter: number
  seenNonces: Set<string>
  channelIndex: number
}

export type NoiseIncomingResult =
  | { type: 'consume' }
  | { type: 'plaintext'; text: string }
  | { type: 'error'; text: string }

type SendRaw = (to: number, text: string, channelIndex: number) => boolean | Promise<boolean>
type NoiseCallbacks = {
  onPeerFingerprint?: (peerId: string, fingerprint: string) => void
}

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64url(input: string): Uint8Array {
  const norm = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const part of parts) {
    out.set(part, off)
    off += part.length
  }
  return out
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data))
  return new Uint8Array(digest)
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function hkdfExpand(ikm: Uint8Array, salt: Uint8Array, lenBits: number): Promise<Uint8Array> {
  const ikmKey = await crypto.subtle.importKey('raw', toArrayBuffer(ikm), 'HKDF', false, ['deriveBits'])
  const outBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: new ArrayBuffer(0),
    },
    ikmKey,
    lenBits,
  )
  return new Uint8Array(outBits)
}

async function mixKey(ck: Uint8Array, input: Uint8Array): Promise<{ ck: Uint8Array; key: CryptoKey; keyBytes: Uint8Array }> {
  const out = await hkdfExpand(input, ck, 512)
  const nextCk = out.slice(0, 32)
  const keyBytes = out.slice(32, 64)
  const key = await importAesKey(keyBytes)
  return { ck: nextCk, key, keyBytes }
}

async function splitKeys(ck: Uint8Array): Promise<{ k1: CryptoKey; k2: CryptoKey }> {
  const out = await hkdfExpand(new Uint8Array(32), ck, 512)
  return {
    k1: await importAesKey(out.slice(0, 32)),
    k2: await importAesKey(out.slice(32, 64)),
  }
}

async function aeadEncrypt(key: CryptoKey, nonce: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(plain),
  )
  return new Uint8Array(buf)
}

async function aeadDecrypt(key: CryptoKey, nonce: Uint8Array, cipher: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(cipher),
  )
  return new Uint8Array(buf)
}

async function generateEcdhKeyPair(): Promise<KeyPair> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { privateKey: kp.privateKey, publicKey: kp.publicKey, publicRaw }
}

async function importRawPublic(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )
}

async function dh(priv: CryptoKey, peerRaw: Uint8Array): Promise<Uint8Array> {
  const peer = await importRawPublic(peerRaw)
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peer },
    priv,
    256,
  )
  return new Uint8Array(bits)
}

function makeDataNonce(prefix: Uint8Array, counter: number): Uint8Array {
  const out = new Uint8Array(12)
  out.set(prefix, 0)
  const view = new DataView(out.buffer)
  const hi = Math.floor(counter / 2 ** 32)
  const lo = counter >>> 0
  view.setUint32(4, hi, false)
  view.setUint32(8, lo, false)
  return out
}

function protocolCkInit(): Promise<Uint8Array> {
  return sha256(enc.encode(PROTOCOL_NAME))
}

async function noiseFingerprint(rawStaticKey: Uint8Array): Promise<string> {
  const digest = await sha256(rawStaticKey)
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const groups = hex.match(/.{1,4}/g)
  return groups ? groups.join(':') : hex
}

export class NoiseDmManager {
  private localStatic: KeyPair | null = null
  private initPromise: Promise<void> | null = null
  private sessions = new Map<string, Session>()
  private handshakes = new Map<string, InitHandshake | RespHandshake>()
  private callbacks: NoiseCallbacks

  constructor(callbacks: NoiseCallbacks = {}) {
    this.callbacks = callbacks
  }

  async init(): Promise<void> {
    if (this.localStatic) return
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.localStatic = await generateEcdhKeyPair()
      })()
    }
    await this.initPromise
  }

  async sendDm(
    peerId: string,
    peerNum: number,
    channelIndex: number,
    plainText: string,
    sendRaw: SendRaw,
  ): Promise<boolean> {
    await this.init()
    const existing = this.sessions.get(peerId)
    if (existing) {
      return this.sendData(peerNum, plainText, existing, sendRaw)
    }

    const hs = this.handshakes.get(peerId)
    if (hs && hs.kind === 'init') {
      hs.pending.push(plainText)
      return true
    }

    const eph = await generateEcdhKeyPair()
    this.handshakes.set(peerId, {
      kind: 'init',
      ePriv: eph.privateKey,
      channelIndex,
      pending: [plainText],
    })
    return await sendRaw(peerNum, `nx1:m1:${b64url(eph.publicRaw)}`, channelIndex)
  }

  async handleIncoming(
    peerId: string,
    peerNum: number,
    channelIndex: number,
    text: string,
    sendRaw: SendRaw,
  ): Promise<NoiseIncomingResult> {
    await this.init()
    const parts = text.split(':')
    if (parts.length < 3 || parts[0] !== 'nx1') return { type: 'error', text: 'Invalid Noise frame' }
    const stage = parts[1]

    if (stage === 'm1') {
      const reRaw = fromB64url(parts[2] ?? '')
      const ck0 = await protocolCkInit()
      const eph = await generateEcdhKeyPair()

      const ee = await dh(eph.privateKey, reRaw)
      const m1 = await mixKey(ck0, ee)

      const localStatic = this.localStatic!
      const cStatic = await aeadEncrypt(m1.key, NONCE_ZERO, localStatic.publicRaw)
      const es = await dh(localStatic.privateKey, reRaw)
      const m2 = await mixKey(m1.ck, es)

      this.handshakes.set(peerId, {
        kind: 'resp',
        ePriv: eph.privateKey,
        ck: m2.ck,
        msg3Key: m2.key,
        channelIndex,
      })

      const out = `nx1:m2:${b64url(eph.publicRaw)}:${b64url(cStatic)}`
      await sendRaw(peerNum, out, channelIndex)
      return { type: 'consume' }
    }

    if (stage === 'm2') {
      const state = this.handshakes.get(peerId)
      if (!state || state.kind !== 'init') return { type: 'consume' }
      const reRaw = fromB64url(parts[2] ?? '')
      const cStatic = fromB64url(parts[3] ?? '')

      const ck0 = await protocolCkInit()
      const ee = await dh(state.ePriv, reRaw)
      const m1 = await mixKey(ck0, ee)
      const rsRaw = await aeadDecrypt(m1.key, NONCE_ZERO, cStatic)
      await this.onPeerStatic(peerId, rsRaw)

      const es = await dh(state.ePriv, rsRaw)
      const m2 = await mixKey(m1.ck, es)

      const localStatic = this.localStatic!
      const cMyStatic = await aeadEncrypt(m2.key, NONCE_ZERO, localStatic.publicRaw)
      const se = await dh(localStatic.privateKey, reRaw)
      const m3 = await mixKey(m2.ck, se)

      const session = await this.createSession('initiator', m3.ck, state.channelIndex)
      this.sessions.set(peerId, session)
      this.handshakes.delete(peerId)

      await sendRaw(peerNum, `nx1:m3:${b64url(cMyStatic)}`, state.channelIndex)

      const pending = [...state.pending]
      for (const msg of pending) {
        await this.sendData(peerNum, msg, session, sendRaw)
      }
      return { type: 'consume' }
    }

    if (stage === 'm3') {
      const state = this.handshakes.get(peerId)
      if (!state || state.kind !== 'resp') return { type: 'consume' }
      const cStatic = fromB64url(parts[2] ?? '')
      const isRaw = await aeadDecrypt(state.msg3Key, NONCE_ZERO, cStatic)
      await this.onPeerStatic(peerId, isRaw)
      const se = await dh(state.ePriv, isRaw)
      const m3 = await mixKey(state.ck, se)
      const session = await this.createSession('responder', m3.ck, state.channelIndex)
      this.sessions.set(peerId, session)
      this.handshakes.delete(peerId)
      return { type: 'consume' }
    }

    if (stage === 'd') {
      const session = this.sessions.get(peerId)
      if (!session) return { type: 'error', text: '🔐 Noise DM: нет активной сессии' }
      const nonceRaw = fromB64url(parts[2] ?? '')
      const cipherRaw = fromB64url(parts[3] ?? '')
      const nonceTag = b64url(nonceRaw)
      if (session.seenNonces.has(nonceTag)) return { type: 'consume' }
      session.seenNonces.add(nonceTag)
      if (session.seenNonces.size > 512) {
        const first = session.seenNonces.values().next().value
        if (first) session.seenNonces.delete(first)
      }
      try {
        const plainRaw = await aeadDecrypt(session.recvKey, nonceRaw, cipherRaw)
        return { type: 'plaintext', text: dec.decode(plainRaw) }
      } catch {
        return { type: 'error', text: '🔐 Noise DM: ошибка расшифровки' }
      }
    }

    return { type: 'consume' }
  }

  private async createSession(role: Role, ck: Uint8Array, channelIndex: number): Promise<Session> {
    const split = await splitKeys(ck)
    const sendPrefix = crypto.getRandomValues(new Uint8Array(4))
    return {
      sendKey: role === 'initiator' ? split.k1 : split.k2,
      recvKey: role === 'initiator' ? split.k2 : split.k1,
      sendPrefix,
      sendCounter: 0,
      seenNonces: new Set<string>(),
      channelIndex,
    }
  }

  private async sendData(peerNum: number, plainText: string, session: Session, sendRaw: SendRaw): Promise<boolean> {
    const nonce = makeDataNonce(session.sendPrefix, session.sendCounter)
    session.sendCounter += 1
    const cipher = await aeadEncrypt(session.sendKey, nonce, enc.encode(plainText))
    const payload = `nx1:d:${b64url(nonce)}:${b64url(cipher)}`
    if (payload.length > MAX_DM_PAYLOAD) return false
    return await sendRaw(peerNum, payload, session.channelIndex)
  }

  private async onPeerStatic(peerId: string, rawStaticKey: Uint8Array): Promise<void> {
    if (!this.callbacks.onPeerFingerprint) return
    try {
      const fingerprint = await noiseFingerprint(rawStaticKey)
      this.callbacks.onPeerFingerprint(peerId, fingerprint)
    } catch {
      // ignore fingerprint failures, they must not break transport
    }
  }
}

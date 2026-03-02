const enc = new TextEncoder()

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin.trim())
}

export function randomSaltB64(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToB64(bytes)
}

export async function hashPin(pin: string, saltB64: string): Promise<string> {
  const material = `${saltB64}:${pin.trim()}`
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(material))
  return bytesToB64(new Uint8Array(digest))
}

export async function createPinMaterial(pin: string): Promise<{ salt: string; hash: string }> {
  const salt = randomSaltB64()
  const hash = await hashPin(pin, salt)
  return { salt, hash }
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  const hash = await hashPin(pin, salt)
  return hash === expectedHash
}

function randomChallenge(size = 32): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out.buffer
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const norm = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4)
  return b64ToBytes(padded)
}

export function supportsBiometricAuth(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials
}

export async function registerBiometricCredential(): Promise<string | null> {
  if (!supportsBiometricAuth()) return null
  const userId = new Uint8Array(16)
  crypto.getRandomValues(userId)

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: toArrayBuffer(randomChallenge()),
      rp: { name: 'MeshChat' },
      user: {
        id: toArrayBuffer(userId),
        name: 'meshchat-local-user',
        displayName: 'MeshChat User',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null

  if (!credential) return null
  return toBase64Url(new Uint8Array(credential.rawId))
}

export async function authenticateWithBiometric(credentialId: string): Promise<boolean> {
  if (!supportsBiometricAuth()) return false
  if (!credentialId.trim()) return false

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(randomChallenge()),
      allowCredentials: [
        {
          type: 'public-key',
          id: toArrayBuffer(fromBase64Url(credentialId)),
          transports: ['internal'],
        },
      ],
      userVerification: 'preferred',
      timeout: 60_000,
    },
  })

  return Boolean(assertion)
}

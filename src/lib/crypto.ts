const E2E_PREFIX = 'mc1'
const SALT_BYTES = 16
const IV_BYTES = 12
const PBKDF2_ITERATIONS = 150_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i])
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): Uint8Array {
  const norm = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function isEncryptedPayload(text: string): boolean {
  return text.startsWith(`${E2E_PREFIX}:`)
}

export async function encryptE2E(plainText: string, passphrase: string): Promise<string> {
  if (!hasWebCrypto()) throw new Error('WebCrypto недоступен')
  if (!passphrase.trim()) throw new Error('Пустой ключ шифрования')

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoder.encode(plainText)),
  )

  const cipher = new Uint8Array(cipherBuf)
  return `${E2E_PREFIX}:${toBase64Url(salt)}:${toBase64Url(iv)}:${toBase64Url(cipher)}`
}

export async function decryptE2E(payload: string, passphrase: string): Promise<string> {
  if (!hasWebCrypto()) throw new Error('WebCrypto недоступен')
  if (!isEncryptedPayload(payload)) return payload
  if (!passphrase.trim()) throw new Error('Ключ не задан')

  const [prefix, saltPart, ivPart, cipherPart] = payload.split(':')
  if (prefix !== E2E_PREFIX || !saltPart || !ivPart || !cipherPart) {
    throw new Error('Некорректный формат шифротекста')
  }

  const salt = fromBase64Url(saltPart)
  const iv = fromBase64Url(ivPart)
  const cipher = fromBase64Url(cipherPart)
  const key = await deriveKey(passphrase, salt)

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(cipher),
  )

  return decoder.decode(plainBuf)
}

const VERIFY_PREFIX = 'meshchat-verify-v1'

export type VerifyQrPayload =
  | {
      kind: 'noise'
      fingerprint: string
      peerId: string
    }
  | {
      kind: 'e2ee'
      fingerprint: string
    }

function normalizeFingerprint(input: string): string {
  return input.trim().toUpperCase()
}

export function buildVerifyQrPayload(payload: VerifyQrPayload): string {
  if (payload.kind === 'noise') {
    return `${VERIFY_PREFIX}|noise|${payload.peerId}|${normalizeFingerprint(payload.fingerprint)}`
  }
  return `${VERIFY_PREFIX}|e2ee|${normalizeFingerprint(payload.fingerprint)}`
}

export function parseVerifyQrPayload(raw: string): VerifyQrPayload | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parts = trimmed.split('|')
  if (parts.length < 3) return null
  if (parts[0] !== VERIFY_PREFIX) return null

  const kind = parts[1]
  if (kind === 'noise') {
    if (parts.length < 4) return null
    const peerId = parts[2]?.trim().toLowerCase()
    const fingerprint = normalizeFingerprint(parts.slice(3).join('|'))
    if (!peerId || !fingerprint) return null
    return { kind: 'noise', peerId, fingerprint }
  }

  if (kind === 'e2ee') {
    const fingerprint = normalizeFingerprint(parts.slice(2).join('|'))
    if (!fingerprint) return null
    return { kind: 'e2ee', fingerprint }
  }

  return null
}

export async function e2eeFingerprintFromPassphrase(passphrase: string): Promise<string> {
  const source = passphrase.trim()
  if (!source) return ''
  const enc = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(source))
  const bytes = Array.from(new Uint8Array(hash)).slice(0, 16)
  const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const groups = hex.match(/.{1,4}/g)
  return groups ? groups.join(':') : hex
}

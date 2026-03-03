const GROUP_PREFIX_V1 = 'meshchat-group-v1'
const GROUP_PREFIX_V2 = 'mg2'

type GroupInvite = {
  name: string
  channel: string
  key: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64Url(text: string): string {
  const bytes = enc.encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64Url(value: string): string {
  const norm = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return dec.decode(bytes)
}

export function buildGroupInvite(payload: GroupInvite): string {
  const normalized: GroupInvite = {
    name: payload.name.trim(),
    channel: payload.channel.trim(),
    key: payload.key.trim(),
  }

  // Compact payload to fit offline QR capacity (v5-L) on mobile.
  const nameEnc = encodeURIComponent(normalized.name)
  const channelEnc = encodeURIComponent(normalized.channel)
  const keyEnc = encodeURIComponent(normalized.key)
  return `${GROUP_PREFIX_V2}|${nameEnc}|${channelEnc}|${keyEnc}`
}

export function parseGroupInvite(raw: string): GroupInvite | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parts = trimmed.split('|')
  const prefix = parts[0]

  if (prefix === GROUP_PREFIX_V2) {
    if (parts.length < 4) return null
    try {
      const name = decodeURIComponent(parts[1] ?? '').trim()
      const channel = decodeURIComponent(parts[2] ?? '').trim()
      const key = decodeURIComponent(parts.slice(3).join('|')).trim()
      if (!name || !channel || !key) return null
      return { name, channel, key }
    } catch {
      return null
    }
  }

  // Backward compatibility: old base64-json format.
  if (prefix !== GROUP_PREFIX_V1 || parts.length < 2) return null
  const body = parts.slice(1).join('|')
  if (!body) return null
  try {
    const parsed = JSON.parse(fromB64Url(body)) as Partial<GroupInvite>
    const name = parsed.name?.trim() ?? ''
    const channel = parsed.channel?.trim() ?? ''
    const key = parsed.key?.trim() ?? ''
    if (!name || !channel || !key) return null
    return { name, channel, key }
  } catch {
    return null
  }
}

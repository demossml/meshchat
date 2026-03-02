const GROUP_PREFIX = 'meshchat-group-v1'

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
  const json = JSON.stringify(normalized)
  return `${GROUP_PREFIX}|${toB64Url(json)}`
}

export function parseGroupInvite(raw: string): GroupInvite | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const [prefix, body] = trimmed.split('|')
  if (prefix !== GROUP_PREFIX || !body) return null

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

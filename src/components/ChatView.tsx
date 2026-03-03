import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { useSend } from '@/App'
import { BROADCAST, CHANNEL_PRESETS, numToId } from '@/lib/types'
import type { ChatMessage } from '@/lib/types'
import { format } from 'date-fns'
import clsx from 'clsx'
import { encryptE2E } from '@/lib/crypto'
import { QrVerifyModal } from '@/components/QrVerifyModal'
import { buildVerifyQrPayload, e2eeFingerprintFromPassphrase, parseVerifyQrPayload } from '@/lib/verifyQr'
import { buildGroupInvite, parseGroupInvite } from '@/lib/groupInvite'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'

export function ChatView() {
  const MAX_INPUT_LENGTH = 1200
  const send = useSend()
  const [showE2EE, setShowE2EE] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [showNoiseQr, setShowNoiseQr] = useState(false)
  const [scanNoiseQr, setScanNoiseQr] = useState(false)
  const [showE2eeQr, setShowE2eeQr] = useState(false)
  const [scanE2eeQr, setScanE2eeQr] = useState(false)
  const [e2eeFingerprint, setE2eeFingerprint] = useState('')
  const [verifyInfo, setVerifyInfo] = useState<string | null>(null)
  const [showGroupWizard, setShowGroupWizard] = useState(false)
  const [showGroupQr, setShowGroupQr] = useState(false)
  const [scanGroupQr, setScanGroupQr] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupChannel, setGroupChannel] = useState('')
  const [groupKey, setGroupKey] = useState('')
  const [profileQrPayload, setProfileQrPayload] = useState('')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editProfileName, setEditProfileName] = useState('')
  const [editProfileChannel, setEditProfileChannel] = useState('')
  const [editProfileKey, setEditProfileKey] = useState('')
  const {
    activeChannel, channels, unread, messages, dmTarget, groupProfiles,
    myNodeId, config, inputText, e2eeEnabled, e2eePassphrase, noiseDmEnabled,
    setInputText, setActiveChannel, setDmTarget, addOwnMessage,
    setE2EEEnabled, setE2EEPassphrase, setNoiseDmEnabled, setError,
    noisePeers, setNoisePeerVerified,
    upsertGroupProfile, removeGroupProfile, touchGroupProfile,
    historyJump, clearHistoryJump,
  } = useStore()

  const msgs    = messages[activeChannel] ?? []
  const endRef  = useRef<HTMLDivElement>(null)
  const inputRef= useRef<HTMLTextAreaElement>(null)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const dmNoisePeer = dmTarget ? noisePeers[dmTarget.id] : undefined
  const noiseQrPayload = useMemo(() => {
    if (!dmTarget || !dmNoisePeer?.fingerprint) return ''
    return buildVerifyQrPayload({ kind: 'noise', peerId: dmTarget.id, fingerprint: dmNoisePeer.fingerprint })
  }, [dmNoisePeer?.fingerprint, dmTarget])
  const e2eeQrPayload = useMemo(() => {
    if (!e2eeFingerprint) return ''
    return buildVerifyQrPayload({ kind: 'e2ee', fingerprint: e2eeFingerprint })
  }, [e2eeFingerprint])
  const sortedProfiles = useMemo(
    () => [...groupProfiles].sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    [groupProfiles],
  )
  const groupInvitePayload = useMemo(() => {
    const name = groupName.trim()
    const channel = groupChannel.trim()
    const key = groupKey.trim()
    if (!name || !channel || !key) return ''
    return buildGroupInvite({ name, channel, key })
  }, [groupChannel, groupKey, groupName])

  /* auto-scroll */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length])

  useEffect(() => {
    const update = () => setIsMobileViewport(window.matchMedia('(max-width: 767px)').matches)
    update()
    window.addEventListener('resize', update, { passive: true })
    return () => window.removeEventListener('resize', update)
  }, [])

  /* focus on channel change */
  useEffect(() => { inputRef.current?.focus() }, [activeChannel])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, 170)
    el.style.height = `${Math.max(40, next)}px`
    el.style.overflowY = el.scrollHeight > 170 ? 'auto' : 'hidden'
  }, [inputText])

  useEffect(() => {
    if (!dmTarget && noiseDmEnabled) setNoiseDmEnabled(false)
  }, [dmTarget, noiseDmEnabled, setNoiseDmEnabled])

  useEffect(() => {
    let cancelled = false
    const pass = e2eePassphrase.trim()
    if (!pass) {
      setE2eeFingerprint('')
      return
    }
    void e2eeFingerprintFromPassphrase(pass).then(fp => {
      if (!cancelled) setE2eeFingerprint(fp)
    }).catch(() => {
      if (!cancelled) setE2eeFingerprint('')
    })
    return () => { cancelled = true }
  }, [e2eePassphrase])

  useEffect(() => {
    if (!showGroupWizard) return
    setGroupName(prev => prev || `Group ${new Date().toLocaleDateString()}`)
    setGroupChannel(prev => prev || activeChannel || 'LongFast')
    setGroupKey(prev => prev || e2eePassphrase.trim())
  }, [activeChannel, e2eePassphrase, showGroupWizard])

  useEffect(() => {
    if (!historyJump) return
    if (historyJump.channel !== activeChannel) return

    const target = document.getElementById(messageDomId(historyJump.messageId))
    if (!target) return

    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMessageId(historyJump.messageId)
    clearHistoryJump()
    const timer = setTimeout(() => {
      setHighlightedMessageId(prev => (prev === historyJump.messageId ? null : prev))
    }, 2200)
    return () => clearTimeout(timer)
  }, [activeChannel, clearHistoryJump, historyJump])

  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (!text) return

    const to = dmTarget ? dmTarget.num : BROADCAST
    const clientMsgId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    if (noiseDmEnabled) {
      if (!dmTarget) {
        setError('Noise DM работает только в личных сообщениях (DM)')
        return
      }
      if (dmNoisePeer && !dmNoisePeer.verified) {
        setError('Noise fingerprint узла не подтвержден. Подтвердите fingerprint перед отправкой.')
        return
      }
      if (text.length > 120) {
        setError('Noise DM: сократите текст (рекомендовано до 120 символов)')
        return
      }
      addOwnMessage(text, { encrypted: true, clientMsgId, secureMode: 'noise-dm' })
      send({ type: 'sendText', text, to, channel: activeChannel, secure: 'noise-dm', clientMsgId })
      setInputText('')
      inputRef.current?.focus()
      return
    }

    let outbound = text

    if (e2eeEnabled) {
      if (!e2eePassphrase.trim()) {
        setError('E2E включено, но ключ пустой')
        return
      }
      try {
        outbound = await encryptE2E(text, e2eePassphrase)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        setError(`Ошибка E2E шифрования: ${message}`)
        return
      }

    }

    // Оптимистичный UI — добавляем сообщение сразу
    addOwnMessage(text, { encrypted: e2eeEnabled, clientMsgId, secureMode: e2eeEnabled ? 'e2ee' : undefined })

    // Шлём на Meshtastic устройство
    send({ type: 'sendText', text: outbound, to, channel: activeChannel, clientMsgId })

    setInputText('')
    inputRef.current?.focus()
  }, [inputText, dmTarget, dmNoisePeer, noiseDmEnabled, e2eeEnabled, e2eePassphrase, activeChannel, send, addOwnMessage, setError, setInputText])

  const handleRetry = useCallback(async (msg: ChatMessage) => {
    if (!msg.clientMsgId) {
      setError('Нельзя повторить отправку: отсутствует clientMsgId')
      return
    }

    if (msg.secureMode === 'noise-dm') {
      if (msg.to === BROADCAST) {
        setError('Noise DM поддерживается только для личных сообщений')
        return
      }
      const peer = noisePeers[numToId(msg.to)]
      if (peer && !peer.verified) {
        setError('Noise fingerprint узла не подтвержден. Подтвердите fingerprint перед отправкой.')
        return
      }
      send({
        type: 'sendText',
        text: msg.text,
        to: msg.to,
        channel: msg.channel,
        secure: 'noise-dm',
        clientMsgId: msg.clientMsgId,
      })
      return
    }

    if (msg.secureMode === 'e2ee') {
      if (!e2eePassphrase.trim()) {
        setError('Для retry E2E-сообщения задайте E2E ключ')
        return
      }
      let outbound: string
      try {
        outbound = await encryptE2E(msg.text, e2eePassphrase)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        setError(`Ошибка E2E шифрования: ${message}`)
        return
      }
      send({
        type: 'sendText',
        text: outbound,
        to: msg.to,
        channel: msg.channel,
        clientMsgId: msg.clientMsgId,
      })
      return
    }

    send({
      type: 'sendText',
      text: msg.text,
      to: msg.to,
      channel: msg.channel,
      clientMsgId: msg.clientMsgId,
    })
  }, [e2eePassphrase, noisePeers, send, setError])

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
  }

  const normalizeFingerprint = (value: string): string => value.trim().toUpperCase()

  const handleNoiseQrScan = useCallback((raw: string) => {
    if (!dmTarget || !dmNoisePeer?.fingerprint) {
      setError('Нет fingerprint для этого узла')
      return
    }
    const parsed = parseVerifyQrPayload(raw)
    if (!parsed || parsed.kind !== 'noise') {
      setError('QR не содержит Noise fingerprint')
      return
    }
    if (parsed.peerId !== dmTarget.id) {
      setError('QR относится к другому узлу')
      return
    }
    if (normalizeFingerprint(parsed.fingerprint) !== normalizeFingerprint(dmNoisePeer.fingerprint)) {
      setError('Fingerprint в QR не совпадает')
      return
    }
    setNoisePeerVerified(dmTarget.id, true)
    setVerifyInfo(`Noise fingerprint ${dmTarget.id} подтвержден по QR`)
    setScanNoiseQr(false)
  }, [dmNoisePeer?.fingerprint, dmTarget, setError, setNoisePeerVerified])

  const handleE2eeQrScan = useCallback((raw: string) => {
    if (!e2eeFingerprint) {
      setError('Сначала задайте E2E ключ, чтобы сравнить fingerprint')
      return
    }
    const parsed = parseVerifyQrPayload(raw)
    if (!parsed || parsed.kind !== 'e2ee') {
      setError('QR не содержит E2E fingerprint')
      return
    }
    if (normalizeFingerprint(parsed.fingerprint) !== normalizeFingerprint(e2eeFingerprint)) {
      setError('E2E fingerprint не совпадает')
      return
    }
    setVerifyInfo('E2E fingerprint подтвержден по QR')
    setScanE2eeQr(false)
  }, [e2eeFingerprint, setError])

  const handleApplyGroup = useCallback(() => {
    const name = groupName.trim()
    const channel = groupChannel.trim()
    const key = groupKey.trim()
    if (!name || !channel || !key) {
      setError('Для группы заполните название, канал и ключ')
      return
    }
    setActiveChannel(channel)
    setE2EEPassphrase(key)
    setE2EEEnabled(true)
    setNoiseDmEnabled(false)
    const profileId = `${channel.toLowerCase()}::${name.toLowerCase()}`
    upsertGroupProfile({ id: profileId, name, channel, key })
    setShowGroupWizard(false)
    setVerifyInfo(`Группа "${name}" настроена: канал ${channel}, E2EE включен`)
  }, [groupChannel, groupKey, groupName, setActiveChannel, setE2EEEnabled, setE2EEPassphrase, setError, setNoiseDmEnabled, upsertGroupProfile])

  const handleGroupQrScan = useCallback((raw: string) => {
    const parsed = parseGroupInvite(raw)
    if (!parsed) {
      setError('Некорректный QR приглашения группы')
      return
    }
    setGroupName(parsed.name)
    setGroupChannel(parsed.channel)
    setGroupKey(parsed.key)
    const profileId = `${parsed.channel.toLowerCase()}::${parsed.name.toLowerCase()}`
    upsertGroupProfile({ id: profileId, name: parsed.name, channel: parsed.channel, key: parsed.key })
    touchGroupProfile(profileId)
    setActiveChannel(parsed.channel)
    setE2EEPassphrase(parsed.key)
    setE2EEEnabled(true)
    setNoiseDmEnabled(false)
    setScanGroupQr(false)
    setShowGroupWizard(false)
    setVerifyInfo(`Вступили в группу "${parsed.name}" (${parsed.channel})`)
  }, [setActiveChannel, setE2EEEnabled, setE2EEPassphrase, setError, setNoiseDmEnabled, touchGroupProfile, upsertGroupProfile])

  const applyProfile = useCallback((profile: { id: string; name: string; channel: string; key: string }) => {
    if (!profile.key.trim()) {
      setError('У профиля пустой ключ')
      return
    }
    setActiveChannel(profile.channel)
    setE2EEPassphrase(profile.key)
    setE2EEEnabled(true)
    setNoiseDmEnabled(false)
    touchGroupProfile(profile.id)
    setVerifyInfo(`Профиль "${profile.name}" применен`)
  }, [setActiveChannel, setE2EEEnabled, setE2EEPassphrase, setError, setNoiseDmEnabled, touchGroupProfile])

  const startEditProfile = useCallback((profile: { id: string; name: string; channel: string; key: string }) => {
    setEditingProfileId(profile.id)
    setEditProfileName(profile.name)
    setEditProfileChannel(profile.channel)
    setEditProfileKey(profile.key)
  }, [])

  const cancelEditProfile = useCallback(() => {
    setEditingProfileId(null)
    setEditProfileName('')
    setEditProfileChannel('')
    setEditProfileKey('')
  }, [])

  const saveEditProfile = useCallback(() => {
    if (!editingProfileId) return
    const name = editProfileName.trim()
    const channel = editProfileChannel.trim()
    const key = editProfileKey.trim()
    if (!name || !channel || !key) {
      setError('Для профиля заполните название, канал и ключ')
      return
    }
    upsertGroupProfile({ id: editingProfileId, name, channel, key })
    setVerifyInfo(`Профиль "${name}" обновлен`)
    cancelEditProfile()
  }, [cancelEditProfile, editProfileChannel, editProfileKey, editProfileName, editingProfileId, setError, upsertGroupProfile])

  const duplicateProfile = useCallback((profile: { name: string; channel: string; key: string }) => {
    const baseName = profile.name.trim() || 'Group'
    const copyName = `${baseName} (copy)`
    const copyId = `${profile.channel.toLowerCase()}::${copyName.toLowerCase()}::${Date.now().toString(36)}`
    upsertGroupProfile({
      id: copyId,
      name: copyName,
      channel: profile.channel,
      key: profile.key,
    })
    setVerifyInfo(`Создана копия профиля "${copyName}"`)
  }, [upsertGroupProfile])

  const chColor = CHANNEL_PRESETS.find(p => p.name === activeChannel)?.color ?? 'var(--g3)'

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
      {/* Channel title bar */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 py-2 sm:px-4">
        <span className="truncate font-[var(--display)] text-[13px] font-semibold tracking-[0.04em] sm:text-[14px]" style={{ color: chColor }}>
          # {activeChannel}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
            onClick={() => setShowGroupWizard(true)}
            title="Создать или настроить группу"
          >
            GROUP
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="hidden h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800 min-[420px]:inline-flex"
            onClick={() => setScanGroupQr(true)}
            title="Сканировать QR-приглашение группы"
          >
            SCAN QR
          </Button>
          <Badge variant="outline" className="h-5 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.02em] text-zinc-500">
            {msgs.length} пакетов
          </Badge>
        </div>
      </div>
      <div className={clsx(
        'flex gap-1.5 overflow-x-auto border-b border-zinc-900 bg-zinc-950 px-2.5 py-1.5 md:hidden',
        isMobileViewport && inputFocused && 'hidden',
      )}>
        {channels.map(ch => {
          const isActive = ch === activeChannel
          const unreadCount = unread[ch] ?? 0
          return (
            <button
              key={ch}
              type="button"
              className={clsx(
                'relative shrink-0 rounded-md border px-2 py-1 text-[10px] tracking-[0.04em] transition',
                isActive
                  ? 'border-zinc-300/40 bg-zinc-100 text-zinc-900'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300',
              )}
              onClick={() => setActiveChannel(ch)}
            >
              {ch}
              {unreadCount > 0 && (
                <span className={clsx(
                  'ml-1 inline-flex min-w-4 items-center justify-center rounded-sm px-1 text-[9px]',
                  isActive ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-800 text-zinc-100',
                )}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Message list */}
      <div className="flex flex-1 flex-col gap-px overflow-y-auto bg-zinc-950 px-2.5 py-2.5 sm:px-3.5 sm:py-3">
        {msgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs tracking-[0.04em] text-zinc-500">
            <div className="mb-2 text-[34px] text-zinc-700">◈</div>
            <div>Нет пакетов в {activeChannel}</div>
            <div className="mt-1 text-[10px] text-zinc-600">Сообщения придут автоматически</div>
          </div>
        ) : (
          msgs.map((msg, i) => (
            <MsgBubble
              key={msg.id}
              bubbleId={messageDomId(msg.id)}
              msg={msg}
              prev={msgs[i - 1]}
              myId={myNodeId}
              highlighted={highlightedMessageId === msg.id}
              onAvatarClick={() => {
                const node = useStore.getState().nodes[msg.fromId]
                if (node && msg.fromId !== myNodeId) setDmTarget(node)
              }}
              onRetry={() => { void handleRetry(msg) }}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className={clsx(
        'chat-composer-wrap chat-composer-mobile flex-shrink-0 border-t border-zinc-800 bg-zinc-950 px-2.5 py-2 sm:px-3 sm:pb-2',
        isMobileViewport && inputFocused && 'pb-1.5 pt-1.5',
      )}>
        {verifyInfo && !(isMobileViewport && inputFocused) && (
          <div className="mb-2 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[10px] text-zinc-300">
            {verifyInfo}
          </div>
        )}
        <div className={clsx(
          'mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] tracking-[0.04em]',
          isMobileViewport && inputFocused && 'hidden',
        )}>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={clsx(
                'h-7 border-zinc-700 px-2 text-[10px]',
                e2eeEnabled && 'border-zinc-500 bg-zinc-800 text-zinc-100',
              )}
              onClick={() => setShowE2EE(v => !v)}
            >
              {e2eeEnabled ? '🔒 E2E ON' : '🔓 E2E OFF'}
            </Button>
            {dmTarget && (
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={noiseDmEnabled}
                  onCheckedChange={(checked) => {
                    setNoiseDmEnabled(checked)
                    if (checked) setE2EEEnabled(false)
                  }}
                />
                <span className="text-[10px] text-zinc-400">NOISE DM</span>
              </div>
            )}
          </div>
          {(e2eeEnabled || noiseDmEnabled) && (
            <span className="hidden text-zinc-400 min-[430px]:inline">{noiseDmEnabled ? 'Noise XX' : 'AES-GCM'}</span>
          )}
        </div>
        {showE2EE && !(isMobileViewport && inputFocused) && (
          <div className="mb-2 rounded-md border border-zinc-800 bg-zinc-900 p-2">
            <div className="mb-1 text-[10px] tracking-[0.04em] text-zinc-400">E2E ключ (общий пароль для вашей группы)</div>
            <Input
              type="password"
              className="h-8 text-xs"
              value={e2eePassphrase}
              onChange={e => setE2EEPassphrase(e.target.value)}
              placeholder="Введите общий ключ"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className={clsx('h-7 border-zinc-700 px-2 text-[10px] tracking-[0.04em]', e2eeEnabled && 'border-zinc-500 bg-zinc-800 text-zinc-100')}
                onClick={() => {
                  const next = !e2eeEnabled
                  setE2EEEnabled(next)
                  if (next) setNoiseDmEnabled(false)
                }}
              >
                {e2eeEnabled ? 'Выключить E2E' : 'Включить E2E'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 border border-zinc-700 px-2 text-[10px] tracking-[0.04em] text-zinc-400 hover:text-zinc-100"
                onClick={() => { setE2EEEnabled(false); setE2EEPassphrase('') }}
              >
                Сбросить ключ
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 px-2 text-[10px] tracking-[0.04em]"
                onClick={() => setShowGroupWizard(true)}
              >
                GROUP WIZARD
              </Button>
            </div>
            {e2eeFingerprint && (
              <>
                <div className="mt-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-300">
                  FP: {e2eeFingerprint}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                    onClick={() => setShowE2eeQr(true)}
                  >
                    SHOW QR
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                    onClick={() => setScanE2eeQr(true)}
                  >
                    SCAN QR
                  </Button>
                </div>
              </>
            )}
            {sortedProfiles.length > 0 && (
              <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/70 p-2">
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-400">МОИ ГРУППЫ</div>
                <div className="max-h-[180px] space-y-1 overflow-y-auto">
                  {sortedProfiles.map(profile => (
                    <div key={profile.id} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5">
                      {editingProfileId === profile.id ? (
                        <div className="space-y-1.5">
                          <Input
                            value={editProfileName}
                            onChange={(e) => setEditProfileName(e.target.value)}
                            className="h-7 text-[11px]"
                            placeholder="Название"
                          />
                          <Input
                            value={editProfileChannel}
                            onChange={(e) => setEditProfileChannel(e.target.value)}
                            className="h-7 text-[11px]"
                            placeholder="Канал"
                          />
                          <Input
                            type="password"
                            value={editProfileKey}
                            onChange={(e) => setEditProfileKey(e.target.value)}
                            className="h-7 text-[11px]"
                            placeholder="Ключ"
                          />
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 border-zinc-700 bg-zinc-900 px-1.5 text-[9px] text-zinc-300"
                              onClick={saveEditProfile}
                            >
                              SAVE
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[9px] text-zinc-500 hover:text-zinc-200"
                              onClick={cancelEditProfile}
                            >
                              CANCEL
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[11px] text-zinc-100">{profile.name}</div>
                            <div className="text-[9px] text-zinc-500">{profile.channel}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 border-zinc-700 bg-zinc-900 px-1.5 text-[9px] text-zinc-300"
                              onClick={() => applyProfile(profile)}
                            >
                              APPLY
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 border-zinc-700 bg-zinc-900 px-1.5 text-[9px] text-zinc-300"
                              onClick={() => startEditProfile(profile)}
                            >
                              EDIT
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 border-zinc-700 bg-zinc-900 px-1.5 text-[9px] text-zinc-300"
                              onClick={() => duplicateProfile(profile)}
                            >
                              DUP
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 border-zinc-700 bg-zinc-900 px-1.5 text-[9px] text-zinc-300"
                              onClick={() => {
                                const payload = buildGroupInvite({
                                  name: profile.name,
                                  channel: profile.channel,
                                  key: profile.key,
                                })
                                setProfileQrPayload(payload)
                                setShowGroupQr(true)
                              }}
                            >
                              QR
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[9px] text-zinc-500 hover:text-zinc-200"
                              onClick={() => removeGroupProfile(profile.id)}
                            >
                              DEL
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {dmTarget && (
          <div className="flex items-center justify-between rounded-t-md border border-zinc-700 border-b-0 bg-zinc-900 px-3 py-1.5 text-[11px] tracking-[0.03em] text-zinc-100">
            <span>DM → {dmTarget.longName || dmTarget.id}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1 text-xs text-zinc-500 hover:text-zinc-200"
              onClick={() => setDmTarget(null)}
            >
              ✕
            </Button>
          </div>
        )}
        {dmTarget && (
          <div className="mb-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] tracking-[0.07em] text-zinc-400">NOISE FINGERPRINT</span>
              <Badge
                variant="outline"
                className={clsx(
                  'h-5 rounded-[2px] px-1.5 text-[9px]',
                  dmNoisePeer?.verified
                    ? 'border-zinc-700 bg-zinc-800 text-zinc-100'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-400',
                )}
              >
                {dmNoisePeer ? (dmNoisePeer.verified ? 'VERIFIED' : 'UNVERIFIED') : 'UNKNOWN'}
              </Badge>
            </div>
            {dmNoisePeer ? (
              <div className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-300">
                {dmNoisePeer.fingerprint}
              </div>
            ) : (
              <div className="text-[10px] text-zinc-500">
                Fingerprint появится после первого Noise handshake с этим узлом.
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={() => setNoisePeerVerified(dmTarget.id, !dmNoisePeer?.verified)}
                disabled={!dmNoisePeer}
              >
                {dmNoisePeer?.verified ? 'UNVERIFY' : 'VERIFY'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={() => setShowNoiseQr(true)}
                disabled={!dmNoisePeer}
              >
                SHOW QR
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={() => setScanNoiseQr(true)}
                disabled={!dmNoisePeer}
              >
                SCAN QR
              </Button>
              <span className="text-[9px] text-zinc-500">
                Сверьте fingerprint с собеседником по внешнему каналу.
              </span>
            </div>
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 transition focus-within:border-zinc-500 focus-within:shadow-[0_0_0_2px_rgba(250,250,250,.08)] sm:gap-2 sm:px-2.5">
          <span className="mb-1 hidden whitespace-nowrap text-[10px] tracking-[0.04em] text-zinc-500 min-[390px]:inline">
            {dmTarget
              ? `[DM:${dmTarget.shortName || '??'}]`
              : `[${activeChannel.slice(0, 4).toUpperCase()}]`}
          </span>
          <Textarea
            ref={inputRef}
            className="min-h-10 max-h-[120px] flex-1 resize-none border-none bg-transparent py-1.5 text-[16px] leading-[1.4] text-zinc-100 outline-none placeholder:text-zinc-600 focus-visible:ring-0 sm:text-[13px]"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Введите сообщение…"
            rows={1}
            maxLength={MAX_INPUT_LENGTH}
          />
          <Button
            className="mb-0.5 h-9 min-w-14 self-end rounded-md bg-zinc-100 px-2.5 py-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-900 sm:h-8 sm:min-w-12 sm:px-3"
            onClick={() => void handleSend()}
            disabled={!inputText.trim()}
          >
            TX↑
          </Button>
        </div>
        <div className={clsx(
          'flex items-center justify-between px-0.5 pt-1 text-[8px] tracking-[0.04em] text-zinc-600 sm:text-[9px]',
          isMobileViewport && inputFocused && 'pt-0.5',
        )}>
          {inputText.length > 0 && <span>{inputText.length}/{MAX_INPUT_LENGTH}</span>}
          <span className="ml-auto hidden sm:inline">
            {noiseDmEnabled
              ? 'Noise DM: только личные сообщения, короткий текст'
              : e2eeEnabled
                ? 'Длинные E2E сообщения отправляются частями автоматически'
                : 'Длинные сообщения отправляются частями · Enter — отправить'}
          </span>
        </div>
      </div>
      </div>

      <QrVerifyModal
        open={showNoiseQr}
        mode="show"
        title="NOISE FINGERPRINT QR"
        payload={noiseQrPayload}
        helper="Пусть собеседник отсканирует этот QR в MeshChat и подтвердит совпадение."
        onClose={() => setShowNoiseQr(false)}
      />
      <QrVerifyModal
        open={scanNoiseQr}
        mode="scan"
        title="SCAN NOISE QR"
        onScan={handleNoiseQrScan}
        onClose={() => setScanNoiseQr(false)}
      />
      <QrVerifyModal
        open={showE2eeQr}
        mode="show"
        title="E2EE KEY FINGERPRINT QR"
        payload={e2eeQrPayload}
        helper="Сравните QR с участниками группы, чтобы убедиться, что ключ совпадает."
        onClose={() => setShowE2eeQr(false)}
      />
      <QrVerifyModal
        open={scanE2eeQr}
        mode="scan"
        title="SCAN E2EE QR"
        onScan={handleE2eeQrScan}
        onClose={() => setScanE2eeQr(false)}
      />
      <QrVerifyModal
        open={showGroupQr}
        mode="show"
        title="GROUP INVITE QR"
        payload={profileQrPayload || groupInvitePayload}
        helper="Передайте QR участнику, чтобы он быстро вступил в группу."
        onClose={() => { setShowGroupQr(false); setProfileQrPayload('') }}
      />
      <QrVerifyModal
        open={scanGroupQr}
        mode="scan"
        title="SCAN GROUP INVITE QR"
        onScan={handleGroupQrScan}
        onClose={() => setScanGroupQr(false)}
      />
      {showGroupWizard && (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/75 p-3 backdrop-blur-[1px] sm:items-center">
          <div className="w-full max-w-[430px] rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs tracking-[0.08em] text-zinc-300">GROUP WIZARD</div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-zinc-400" onClick={() => setShowGroupWizard(false)}>✕</Button>
            </div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">НАЗВАНИЕ ГРУППЫ</div>
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Например: Squad Alpha" />
              </div>
              <div>
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">КАНАЛ</div>
                <Input value={groupChannel} onChange={(e) => setGroupChannel(e.target.value)} placeholder="LongFast" />
                <div className="mt-1 text-[9px] text-zinc-600">Рекомендуемые: {CHANNEL_PRESETS.map(ch => ch.name).join(' · ')}</div>
              </div>
              <div>
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">ОБЩИЙ E2EE КЛЮЧ</div>
                <Input type="password" value={groupKey} onChange={(e) => setGroupKey(e.target.value)} placeholder="Сильный пароль группы" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={handleApplyGroup}
              >
                APPLY
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={() => {
                  if (!groupInvitePayload) {
                    setError('Заполните данные группы перед генерацией QR')
                    return
                  }
                  setShowGroupQr(true)
                }}
              >
                SHOW INVITE QR
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={() => setScanGroupQr(true)}
              >
                SCAN INVITE QR
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Отдельное сообщение ─────────────────────────────────────── */

interface BubbleProps {
  bubbleId: string
  msg: ChatMessage
  prev?: ChatMessage
  myId: string | null
  highlighted?: boolean
  onAvatarClick: () => void
  onRetry: () => void
}

function messageDomId(msgId: string): string {
  return `msg-${msgId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function MsgBubble({ bubbleId, msg, prev, myId, highlighted, onAvatarClick, onRetry }: BubbleProps) {
  const isOwn = msg.isOwn || msg.fromId === myId
  const showHeader = !prev || prev.from !== msg.from || (msg.ts - prev.ts) > 120_000
  const initials = msg.fromName.slice(0, 2).toUpperCase()
  const time = format(new Date(msg.ts), 'HH:mm:ss')
  const isNoise = typeof msg.rawText === 'string' && msg.rawText.startsWith('nx1:')
  const encLabel = isNoise ? 'NOISE' : 'E2E'
  const delivery = msg.status ?? (msg.ack ? 'ack' : undefined)
  const deliveryLabel = delivery === 'queued'
    ? 'WAIT LINK'
    : delivery === 'sent'
      ? 'SENT'
      : delivery === 'ack'
        ? 'ACK'
        : delivery === 'delivered'
          ? 'DELIVERED'
          : delivery === 'read'
            ? 'READ'
        : delivery === 'failed'
          ? 'FAILED'
          : null
  const deliveryClass = delivery === 'failed'
    ? 'border-zinc-600 bg-zinc-700 text-zinc-200'
    : delivery === 'read'
      ? 'border-zinc-700 bg-zinc-800 text-zinc-100'
      : delivery === 'delivered'
        ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
    : delivery === 'ack'
      ? 'border-zinc-700 bg-zinc-900 text-zinc-300'
      : delivery === 'sent'
      ? 'border-zinc-700 bg-zinc-900 text-zinc-400'
      : 'border-zinc-700 bg-zinc-900 text-zinc-500'
  const deliveryEventTs = delivery === 'read'
    ? msg.readAt
    : delivery === 'delivered'
      ? msg.deliveredAt
      : undefined
  const deliveryEventTime = deliveryEventTs ? format(new Date(deliveryEventTs), 'HH:mm:ss') : null

  return (
    <div
      id={bubbleId}
      className={clsx(
        'flex items-start gap-1.5 py-0.5 animate-[fade-up_0.2s_ease] transition',
        isOwn && 'flex-row-reverse',
        highlighted && 'rounded-md bg-zinc-900/80 ring-1 ring-zinc-500',
      )}
    >
      {/* Avatar (только чужие) */}
      {!isOwn && (
        <button
          className={clsx(
            'grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border border-zinc-700 bg-zinc-900 p-0 text-[10px] font-bold leading-none text-zinc-100 transition hover:border-zinc-500',
            !showHeader && 'pointer-events-none invisible',
          )}
          onClick={onAvatarClick}
          title={`DM → ${msg.fromName}`}
        >
          {initials}
        </button>
      )}

      <div className={clsx('flex max-w-[88%] flex-col gap-1 sm:max-w-[78%]', isOwn && 'items-end')}>
        {/* Sender + meta */}
        {showHeader && !isOwn && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-200">{msg.fromName}</span>
            <span className="text-[10px] text-zinc-500">{time}</span>
            {msg.encrypted && (
              <Badge variant="outline" className={clsx(
                'rounded-[2px] px-1.5 py-0.5 text-[9px]',
                msg.decryptError ? 'border-zinc-600 bg-zinc-700 text-zinc-200' : 'border-zinc-700 bg-zinc-800 text-zinc-300',
              )}>
                {msg.decryptError ? `${encLabel} ERR` : encLabel}
              </Badge>
            )}
            {msg.rssi !== undefined && (
              <Badge variant="outline" className="rounded-[2px] border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[9px] text-zinc-500">
                {msg.rssi}dBm
              </Badge>
            )}
            {msg.hops !== undefined && (
              <Badge variant="outline" className="rounded-[2px] border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[9px] text-zinc-500">
                {msg.hops}h
              </Badge>
            )}
          </div>
        )}

        {/* Bubble */}
        <div
          className={clsx(
            'inline-block max-w-full break-words whitespace-pre-wrap px-2.5 py-1.5 text-[13px] leading-[1.55]',
            isOwn
              ? 'flex items-end gap-2 rounded-md rounded-tr-none border border-zinc-300 bg-zinc-100 text-zinc-900'
              : 'rounded-md rounded-tl-none border border-zinc-800 bg-zinc-900 text-zinc-100',
          )}
        >
          {msg.text}
          {isOwn && (
            <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap">
              <span className="text-[10px] text-zinc-600">{time}</span>
              {deliveryLabel && (
                <Badge variant="outline" className={clsx('h-4 rounded-[2px] px-1 text-[8px] leading-none', deliveryClass)}>
                  {deliveryLabel}
                </Badge>
              )}
              {deliveryEventTime && (
                <span className="text-[10px] text-zinc-500">{deliveryEventTime}</span>
              )}
            </span>
          )}
        </div>
        {isOwn && (delivery === 'failed' || (delivery === 'queued' && !!msg.sendError)) && (
          <div className="flex items-center gap-2">
            {delivery === 'failed' && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 border-zinc-700 bg-zinc-900 px-2 text-[9px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={onRetry}
              >
                RETRY NOW
              </Button>
            )}
            {msg.sendError && (
              <span className="max-w-[220px] truncate text-[9px] text-zinc-500" title={msg.sendError}>
                {msg.sendError}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

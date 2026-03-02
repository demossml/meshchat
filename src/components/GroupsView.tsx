import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { CHANNEL_PRESETS } from '@/lib/types'
import { buildGroupInvite, parseGroupInvite } from '@/lib/groupInvite'
import { createPinMaterial, isValidPin, registerBiometricCredential, supportsBiometricAuth } from '@/lib/security'
import { QrVerifyModal } from '@/components/QrVerifyModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export function GroupsView() {
  const [groupName, setGroupName] = useState('')
  const [groupChannel, setGroupChannel] = useState('')
  const [groupKey, setGroupKey] = useState('')
  const [profileQrPayload, setProfileQrPayload] = useState('')
  const [showGroupQr, setShowGroupQr] = useState(false)
  const [scanGroupQr, setScanGroupQr] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editProfileName, setEditProfileName] = useState('')
  const [editProfileChannel, setEditProfileChannel] = useState('')
  const [editProfileKey, setEditProfileKey] = useState('')
  const [securityPin, setSecurityPin] = useState('')
  const [securityBusy, setSecurityBusy] = useState(false)
  const [securityErr, setSecurityErr] = useState('')
  const biometricSupported = supportsBiometricAuth()

  const {
    groupProfiles,
    activeChannel,
    e2eePassphrase,
    setActiveChannel,
    setE2EEPassphrase,
    setE2EEEnabled,
    setNoiseDmEnabled,
    securityEnabled,
    securityBiometricEnabled,
    securityCredentialId,
    upsertGroupProfile,
    removeGroupProfile,
    touchGroupProfile,
    setSecurityPin: saveSecurityPin,
    disableSecurity,
    setSecurityBiometric,
    setError,
  } = useStore()

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
    setInfo(`Профиль "${profile.name}" применен`)
  }, [setActiveChannel, setE2EEEnabled, setE2EEPassphrase, setError, setNoiseDmEnabled, touchGroupProfile])

  const handleCreateGroup = useCallback(() => {
    const name = groupName.trim()
    const channel = groupChannel.trim()
    const key = groupKey.trim()
    if (!name || !channel || !key) {
      setError('Для группы заполните название, канал и ключ')
      return
    }
    const profileId = `${channel.toLowerCase()}::${name.toLowerCase()}`
    upsertGroupProfile({ id: profileId, name, channel, key })
    applyProfile({ id: profileId, name, channel, key })
    setInfo(`Группа "${name}" создана и активирована`)
  }, [applyProfile, groupChannel, groupKey, groupName, setError, upsertGroupProfile])

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
    applyProfile({ id: profileId, name: parsed.name, channel: parsed.channel, key: parsed.key })
    setScanGroupQr(false)
    setInfo(`Вступили в группу "${parsed.name}"`)
  }, [applyProfile, setError, upsertGroupProfile])

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
    setInfo(`Профиль "${name}" обновлен`)
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
    setInfo(`Создана копия "${copyName}"`)
  }, [upsertGroupProfile])

  const applySecurityPin = useCallback(async () => {
    const pin = securityPin.trim()
    if (!isValidPin(pin)) {
      setSecurityErr('PIN должен быть 4-8 цифр')
      return
    }
    setSecurityBusy(true)
    setSecurityErr('')
    try {
      const material = await createPinMaterial(pin)
      saveSecurityPin(material.hash, material.salt)
      setSecurityPin('')
      setInfo(securityEnabled ? 'PIN обновлен' : 'PIN lock включен')
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error'
      setSecurityErr(`Ошибка PIN: ${message}`)
    } finally {
      setSecurityBusy(false)
    }
  }, [saveSecurityPin, securityEnabled, securityPin])

  const handleRegisterBiometric = useCallback(async () => {
    if (!securityEnabled) {
      setSecurityErr('Сначала включите PIN lock')
      return
    }
    if (!biometricSupported) {
      setSecurityErr('Биометрия не поддерживается в этом браузере')
      return
    }
    setSecurityBusy(true)
    setSecurityErr('')
    try {
      const credentialId = await registerBiometricCredential()
      if (!credentialId) {
        setSecurityErr('Не удалось зарегистрировать биометрию')
        return
      }
      setSecurityBiometric(true, credentialId)
      setInfo('Биометрия включена')
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error'
      setSecurityErr(`Ошибка биометрии: ${message}`)
    } finally {
      setSecurityBusy(false)
    }
  }, [biometricSupported, securityEnabled, setSecurityBiometric])

  const handleDisableSecurity = useCallback(() => {
    disableSecurity()
    setSecurityPin('')
    setSecurityErr('')
    setInfo('Защита отключена')
  }, [disableSecurity])

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 py-2 sm:px-4">
          <span className="font-[var(--display)] text-[13px] font-semibold tracking-[0.04em] sm:text-[14px]"># Groups</span>
          <Badge variant="outline" className="h-5 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.02em] text-zinc-500">
            {sortedProfiles.length} профилей
          </Badge>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5 sm:px-3.5 sm:py-3">
          {info && (
            <div className="mb-2 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[10px] text-zinc-300">
              {info}
            </div>
          )}

          <section className="mb-3 rounded-md border border-zinc-800 bg-zinc-900 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] tracking-[0.08em] text-zinc-400">SECURITY</div>
              <Badge variant="outline" className="h-5 border-zinc-700 bg-zinc-900 px-2 text-[9px] text-zinc-400">
                {securityEnabled ? 'LOCK ON' : 'LOCK OFF'}
              </Badge>
            </div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">
                  {securityEnabled ? 'ИЗМЕНИТЬ PIN' : 'ВКЛЮЧИТЬ PIN'}
                </div>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={securityPin}
                  onChange={(e) => setSecurityPin(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
                  placeholder="4-8 цифр"
                  className="h-8 text-xs tracking-[0.12em]"
                />
              </div>
              {securityErr && (
                <div className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200">
                  {securityErr}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                  onClick={() => void applySecurityPin()}
                  disabled={securityBusy || securityPin.trim().length < 4}
                >
                  {securityEnabled ? 'UPDATE PIN' : 'ENABLE PIN LOCK'}
                </Button>
                {securityEnabled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px] tracking-[0.06em] text-zinc-500 hover:text-zinc-100"
                    onClick={handleDisableSecurity}
                    disabled={securityBusy}
                  >
                    DISABLE LOCK
                  </Button>
                )}
              </div>

              <div className="mt-1 border-t border-zinc-800 pt-2">
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">БИОМЕТРИЯ</div>
                {!biometricSupported ? (
                  <div className="text-[10px] text-zinc-600">В этом браузере биометрия недоступна.</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                      onClick={() => void handleRegisterBiometric()}
                      disabled={securityBusy || !securityEnabled}
                    >
                      {securityCredentialId ? 'RE-REGISTER BIOMETRY' : 'ENABLE BIOMETRY'}
                    </Button>
                    {securityBiometricEnabled && securityCredentialId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10px] tracking-[0.06em] text-zinc-500 hover:text-zinc-100"
                        onClick={() => {
                          setSecurityBiometric(false, null)
                          setInfo('Биометрия отключена')
                        }}
                      >
                        DISABLE BIOMETRY
                      </Button>
                    )}
                    <span className="text-[10px] text-zinc-600">
                      {securityBiometricEnabled && securityCredentialId ? 'Включено' : 'Выключено'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="mb-3 rounded-md border border-zinc-800 bg-zinc-900 p-2.5">
            <div className="mb-2 text-[10px] tracking-[0.08em] text-zinc-400">CREATE / UPDATE GROUP</div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">НАЗВАНИЕ ГРУППЫ</div>
                <Input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Например: Squad Alpha"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">КАНАЛ</div>
                <Input
                  value={groupChannel}
                  onChange={(e) => setGroupChannel(e.target.value)}
                  placeholder={activeChannel || 'LongFast'}
                  className="h-8 text-xs"
                />
                <div className="mt-1 text-[9px] text-zinc-600">Рекомендуемые: {CHANNEL_PRESETS.map(ch => ch.name).join(' · ')}</div>
              </div>
              <div>
                <div className="mb-1 text-[10px] tracking-[0.08em] text-zinc-500">ОБЩИЙ E2EE КЛЮЧ</div>
                <Input
                  type="password"
                  value={groupKey}
                  onChange={(e) => setGroupKey(e.target.value)}
                  placeholder={e2eePassphrase.trim() ? 'Использовать текущий ключ' : 'Сильный пароль группы'}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] tracking-[0.06em] text-zinc-300 hover:bg-zinc-800"
                onClick={handleCreateGroup}
              >
                CREATE + APPLY
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
                  setProfileQrPayload('')
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
                JOIN BY QR
              </Button>
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-950/70 p-2.5">
            <div className="mb-2 text-[10px] tracking-[0.08em] text-zinc-400">MY GROUPS</div>
            <div className="space-y-1.5">
              {sortedProfiles.length === 0 ? (
                <div className="rounded border border-zinc-800 bg-zinc-900 px-2 py-3 text-[10px] text-zinc-500">
                  Профилей пока нет. Создайте группу или отсканируйте приглашение.
                </div>
              ) : sortedProfiles.map(profile => {
                const isActive = profile.channel === activeChannel && profile.key === e2eePassphrase
                return (
                  <div key={profile.id} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5">
                    {editingProfileId === profile.id ? (
                      <div className="space-y-1.5">
                        <Input value={editProfileName} onChange={(e) => setEditProfileName(e.target.value)} className="h-7 text-[11px]" placeholder="Название" />
                        <Input value={editProfileChannel} onChange={(e) => setEditProfileChannel(e.target.value)} className="h-7 text-[11px]" placeholder="Канал" />
                        <Input type="password" value={editProfileKey} onChange={(e) => setEditProfileKey(e.target.value)} className="h-7 text-[11px]" placeholder="Ключ" />
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" className="h-6 border-zinc-700 bg-zinc-900 px-1.5 text-[9px] text-zinc-300" onClick={saveEditProfile}>SAVE</Button>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[9px] text-zinc-500 hover:text-zinc-200" onClick={cancelEditProfile}>CANCEL</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] text-zinc-100">
                            {profile.name}
                            {isActive && <span className="ml-1 text-[9px] text-zinc-500">ACTIVE</span>}
                          </div>
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
                              setProfileQrPayload(buildGroupInvite({ name: profile.name, channel: profile.channel, key: profile.key }))
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
                )
              })}
            </div>
          </section>
        </div>
      </div>

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
    </>
  )
}

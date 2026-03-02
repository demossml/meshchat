import { useState } from 'react'
import { useStore } from '@/store'
import { authenticateWithBiometric, verifyPin } from '@/lib/security'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SecurityGate() {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const {
    securityPinHash,
    securityPinSalt,
    securityBiometricEnabled,
    securityCredentialId,
    unlockSecurity,
  } = useStore()

  const unlockByPin = async () => {
    if (!securityPinHash || !securityPinSalt) return
    setBusy(true)
    setErr('')
    try {
      const ok = await verifyPin(pin, securityPinSalt, securityPinHash)
      if (!ok) {
        setErr('Неверный PIN')
        return
      }
      unlockSecurity()
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const unlockByBiometric = async () => {
    if (!securityCredentialId) return
    setBusy(true)
    setErr('')
    try {
      const ok = await authenticateWithBiometric(securityCredentialId)
      if (!ok) {
        setErr('Биометрическая проверка не выполнена')
        return
      }
      unlockSecurity()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error'
      setErr(`Ошибка биометрии: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-[360px] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
        <div className="mb-2 text-center text-xs tracking-[0.12em] text-zinc-400">SECURE LOCK</div>
        <div className="mb-3 text-center text-[13px] text-zinc-100">Подтвердите доступ к MeshChat</div>

        <div className="space-y-2">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
            placeholder="PIN (4-8 цифр)"
            className="h-10 text-[15px] tracking-[0.14em]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void unlockByPin()
            }}
          />
          {err && <div className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200">{err}</div>}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-300"
              onClick={() => void unlockByPin()}
              disabled={busy || pin.trim().length < 4}
            >
              UNLOCK
            </Button>
            {securityBiometricEnabled && securityCredentialId && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-zinc-700 bg-zinc-900 px-3 text-[11px] text-zinc-300"
                onClick={() => void unlockByBiometric()}
                disabled={busy}
              >
                BIOMETRY
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

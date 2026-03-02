import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import type { ConnectMode } from '@/lib/types'
import clsx from 'clsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'

export function ConnectScreen() {
  const { connect, loadDemo } = useStore()
  const [mode, setMode] = useState<ConnectMode>('wifi')
  const [name, setName] = useState('')
  const [host, setHost] = useState('192.168.0.1')
  const [port, setPort] = useState(80)
  const [path, setPath] = useState('/ws')
  const [adv,  setAdv]  = useState(false)
  const [err,  setErr]  = useState('')
  const touched = useRef({ host: false, port: false, path: false })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/config')
        if (!res.ok) return
        const cfg = await res.json() as { defaultHost?: string; defaultPort?: number; defaultPath?: string }
        if (!alive) return

        if (!touched.current.host && typeof cfg.defaultHost === 'string' && cfg.defaultHost.trim()) {
          setHost(cfg.defaultHost.trim())
        }
        if (!touched.current.port && typeof cfg.defaultPort === 'number' && Number.isFinite(cfg.defaultPort)) {
          setPort(Math.min(65535, Math.max(1, Math.trunc(cfg.defaultPort))))
        }
        if (!touched.current.path && typeof cfg.defaultPath === 'string' && cfg.defaultPath.trim()) {
          const p = cfg.defaultPath.trim()
          setPath(p.startsWith('/') ? p : `/${p}`)
        }
      } catch {
        // API может быть недоступен локально; остаёмся на встроенных дефолтах
      }
    })()
    return () => { alive = false }
  }, [])

  const go = () => {
    if (!name.trim()) { setErr('Введите имя'); return }
    setErr('')

    if (mode === 'bluetooth') {
      connect({ mode: 'bluetooth', name: name.trim() })
      return
    }

    const safePort = Number.isFinite(port) ? Math.min(65535, Math.max(1, Math.trunc(port))) : 80
    const rawPath = path.trim() || '/ws'
    const safePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    connect({ mode: 'wifi', name: name.trim(), host: host.trim() || '192.168.0.1', port: safePort, path: safePath })
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-zinc-950 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(255,255,255,.06),transparent_60%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,.02),transparent_40%)]" />

      <Card className="relative z-10 mx-4 my-3 max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-[460px] overflow-y-auto bg-zinc-900/90 animate-[fade-up_0.35s_ease]">
        <CardHeader className="border-b border-zinc-800 pb-5 pt-7 text-center">
          <div className="flex items-center gap-2.5">
            <span className="text-base text-zinc-100">◼</span>
            <CardTitle className="font-[var(--display)] text-[28px] font-semibold leading-none tracking-[0.16em] text-zinc-50 sm:text-[34px] sm:tracking-[0.18em]">
              MESH<span className="text-zinc-400">CHAT</span>
            </CardTitle>
          </div>
          <CardDescription className="text-[10px] tracking-[0.14em] text-zinc-500">
            MESHTASTIC WEB CLIENT · v2.0
          </CardDescription>
        </CardHeader>

        {/* Status bar */}
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/70 px-4 py-2 text-[10px] tracking-[0.1em] text-zinc-300">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-100 animate-[pulse-dot_2s_infinite]" />
          <span>СИСТЕМА ГОТОВА</span>
          <Badge variant="outline" className="ml-auto border-zinc-700 bg-zinc-900 text-[10px] text-zinc-400">WiFi / Bluetooth</Badge>
        </div>

        {/* Form */}
        <CardContent className="flex flex-col gap-3.5 px-6 py-5">
          <Field label="// ВАШ ПОЗЫВНОЙ" value={name} onChange={setName}
            placeholder="Введите имя..." autoFocus onEnter={go} max={32} />

          <Tabs value={mode} onValueChange={(v) => setMode(v as ConnectMode)}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1">
              <TabsTrigger value="wifi" className="h-9 text-[11px] tracking-[0.08em]">WIFI</TabsTrigger>
              <TabsTrigger value="bluetooth" className="h-9 text-[11px] tracking-[0.08em]">BLUETOOTH</TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === 'wifi' && (
            <>
              <Field label="// IP MESHTASTIC УСТРОЙСТВА" value={host} onChange={(v) => { touched.current.host = true; setHost(v) }}
                placeholder="192.168.0.1" onEnter={go} />

              <Button
                variant="ghost"
                size="sm"
                className="h-auto justify-start px-0 py-0.5 text-[10px] tracking-[0.1em] text-zinc-400 hover:text-zinc-100"
                onClick={() => setAdv(v => !v)}
              >
                {adv ? '▼' : '▶'} ДОПОЛНИТЕЛЬНО
              </Button>

              {adv && (
                <div className="flex flex-col gap-2.5 rounded-md border border-zinc-700 bg-zinc-950/70 p-3 animate-[fade-up_0.2s_ease]">
                  <Field label="// WS ПОРТ" value={String(port)} onChange={v => { touched.current.port = true; setPort(Number(v) || 80) }} placeholder="80" onEnter={go} />
                  <Field label="// WS ПУТЬ" value={path} onChange={(v) => { touched.current.path = true; setPath(v) }} placeholder="/ws" onEnter={go} />
                </div>
              )}
            </>
          )}

          {err && <div className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-100 animate-[fade-up_0.2s_ease]">⚠ {err}</div>}

          <Button
            className="group h-auto justify-between px-5 py-3 text-sm font-semibold tracking-[0.1em]"
            onClick={go}
          >
            ПОДКЛЮЧИТЬСЯ <span className="text-lg transition-transform group-hover:translate-x-1">→</span>
          </Button>

          <Button
            variant="outline"
            className="h-auto border-zinc-700 px-2.5 py-2.5 text-[11px] tracking-[0.08em] text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={loadDemo}
          >
            ⚡ ДЕМО РЕЖИМ (без устройства)
          </Button>
        </CardContent>

        <div className="border-t border-zinc-800 px-4 py-2.5 text-center text-[9px] tracking-[0.08em] text-zinc-500">
          {mode === 'wifi'
            ? 'ПОДКЛЮЧИТЕ ТЕЛЕФОН К WI-FI MESHTASTIC УСТРОЙСТВА ПЕРЕД ВХОДОМ'
            : 'ВКЛЮЧИТЕ BLUETOOTH И ВЫБЕРИТЕ УСТРОЙСТВО MESHTASTIC В СИСТЕМНОМ ОКНЕ'}
        </div>
      </Card>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, autoFocus, onEnter, max }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; autoFocus?: boolean; onEnter?: () => void; max?: number
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] tracking-[0.09em] text-zinc-400">{label}</div>
      <Input
        className="h-10 text-[13px]"
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus} maxLength={max}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
      />
    </div>
  )
}

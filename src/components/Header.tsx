import { useStore } from '@/store'
import { CHANNEL_PRESETS } from '@/lib/types'
import clsx from 'clsx'
import type { Tab } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function Header() {
  const { connected, connecting, activeChannel, tab, nodes,
          securityEnabled, securityUnlocked, lockSecurity,
          setTab, disconnect } = useStore()

  const onlineCount = Object.values(nodes).filter(n => n.isOnline).length
  const chColor = CHANNEL_PRESETS.find(p => p.name === activeChannel)?.color ?? '#fafafa'
  const statusLabel = connecting ? 'CONNECT…' : connected ? 'ONLINE' : 'OFFLINE'
  const statusClass = connected && !connecting
    ? 'border-zinc-300/40 bg-zinc-900/70 text-zinc-100'
    : connecting
      ? 'border-zinc-400/30 bg-zinc-900/70 text-zinc-300'
      : 'border-zinc-700/50 bg-zinc-900/70 text-zinc-400'

  return (
    <header className="flex h-[var(--header-h)] items-end gap-1.5 border-b border-zinc-800 bg-zinc-950/95 px-2 pb-2 pt-[var(--safe-top)] backdrop-blur sm:gap-2 sm:px-4">
      <div className="text-sm font-semibold tracking-[0.14em] text-zinc-100">
        MESH<span className="text-zinc-400">CHAT</span>
      </div>

      <Badge
        variant="outline"
        className="max-w-[110px] truncate tracking-wide border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium sm:max-w-[200px] sm:px-2.5 sm:text-xs"
        style={{ borderColor: `${chColor}80`, color: chColor }}
      >
        {activeChannel}
      </Badge>

      <div className="flex-1" />

      {/* Status */}
      <div className={clsx('hidden items-center gap-2 rounded-md border px-2.5 py-1 text-xs sm:flex', statusClass)}>
        <span className={clsx('h-2 w-2 rounded-full', connected && !connecting ? 'bg-zinc-100' : connecting ? 'bg-zinc-400' : 'bg-zinc-600')} />
        {statusLabel}
        {connected && onlineCount > 0 && (
          <Badge variant="outline" className="h-5 border-zinc-700 bg-black/40 px-1.5 py-0 text-[11px]">{onlineCount}</Badge>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="ml-0.5 hidden md:block">
        <TabsList className="h-auto gap-1 p-1">
          {(['chat', 'map', 'nodes', 'groups'] as const).map(t => (
            <TabsTrigger
              key={t}
              value={t}
              className={clsx('h-7 w-7 p-0 text-[13px] sm:h-8 sm:w-8 sm:text-sm', tab !== t && 'text-zinc-400')}
              title={t === 'chat' ? 'Чат' : t === 'map' ? 'Карта' : t === 'nodes' ? 'Узлы' : 'Группы'}
            >
              {t === 'chat' ? '💬' : t === 'map' ? '◎' : t === 'nodes' ? '◈' : '◉'}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Button
        variant="secondary"
        size="icon"
        className="h-8 w-8 sm:h-9 sm:w-9"
        onClick={() => {
          if (securityEnabled && securityUnlocked) lockSecurity()
          else disconnect()
        }}
        title={securityEnabled && securityUnlocked ? 'Заблокировать приложение' : 'Отключиться'}
      >
        {securityEnabled && securityUnlocked ? '🔒' : '⏻'}
      </Button>
    </header>
  )
}

import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { CHANNEL_PRESETS } from '@/lib/types'
import type { ChatMessage, MeshNode } from '@/lib/types'
import clsx from 'clsx'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { format } from 'date-fns'

export function Sidebar() {
  const [query, setQuery] = useState('')
  const { config, myNodeId, channels, activeChannel, unread, nodes, messages, channelPrefs,
          setActiveChannel, setDmTarget, setTab, setChannelPinned, setChannelMuted, jumpToMessage } = useStore()

  const nodeList = useMemo(() =>
    Object.values(nodes).sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0)), [nodes])
  const sortedChannels = useMemo(() => {
    const order = new Map(channels.map((ch, idx) => [ch, idx]))
    return [...channels].sort((a, b) => {
      const aPinned = channelPrefs[a]?.pinned ? 1 : 0
      const bPinned = channelPrefs[b]?.pinned ? 1 : 0
      if (aPinned !== bPinned) return bPinned - aPinned
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  }, [channels, channelPrefs])
  const search = query.trim().toLowerCase()
  const channelList = useMemo(() => {
    if (!search) return sortedChannels
    return sortedChannels.filter(ch => ch.toLowerCase().includes(search))
  }, [search, sortedChannels])
  const nodeResults = useMemo(() => {
    if (!search) return []
    return nodeList.filter(n => {
      const hay = `${n.longName} ${n.shortName} ${n.id} ${n.hwModel}`.toLowerCase()
      return hay.includes(search)
    }).slice(0, 12)
  }, [nodeList, search])
  const messageResults = useMemo(() => {
    if (!search) return [] as Array<{ channel: string; msg: ChatMessage }>
    const hits: Array<{ channel: string; msg: ChatMessage }> = []
    for (const [ch, list] of Object.entries(messages)) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const msg = list[i]
        const hay = `${msg.text} ${msg.fromName} ${msg.fromId} ${ch}`.toLowerCase()
        if (!hay.includes(search)) continue
        hits.push({ channel: ch, msg })
        if (hits.length >= 50) break
      }
      if (hits.length >= 50) break
    }
    return hits
      .sort((a, b) => b.msg.ts - a.msg.ts)
      .slice(0, 10)
  }, [messages, search])

  const pick = (ch: string) => { setActiveChannel(ch) }
  const pickDm = (node: MeshNode) => { setDmTarget(node); setTab('chat') }
  const jump = (ch: string, msgId: string) => { jumpToMessage(ch, msgId) }

  return (
    <aside
      className={clsx(
        'hidden w-[260px] flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950 md:flex',
      )}
    >
      {/* Identity */}
      {config && (
        <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-zinc-800 bg-zinc-900 px-3 py-3">
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-[13px] font-bold text-zinc-100">
            {config.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs text-zinc-100">{config.name}</div>
            <div className="text-[10px] text-zinc-400">
              {config.mode === 'wifi' ? `${config.host}:${config.port}` : 'Bluetooth LE'}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <section className="flex flex-shrink-0 flex-col gap-1.5 border-b border-zinc-800 px-2.5 py-2">
        <div className="text-[9px] tracking-[0.18em] text-zinc-500">ПОИСК</div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Сообщения / узлы / каналы"
          className="h-8 text-[12px]"
        />
        {search && (
          <div className="text-[9px] text-zinc-500">
            {messageResults.length} сообщений · {nodeResults.length} узлов · {channelList.length} каналов
          </div>
        )}
      </section>

      {search && (
        <section className="flex max-h-[42%] flex-shrink-0 flex-col gap-1 overflow-y-auto px-1.5 py-2">
          <div className="px-1.5 text-[9px] tracking-[0.18em] text-zinc-500">РЕЗУЛЬТАТЫ</div>
          {messageResults.length === 0 ? (
            <div className="px-2 py-1 text-[10px] text-zinc-600">Совпадений в истории нет</div>
          ) : messageResults.map(({ channel, msg }) => (
            <Button
              key={`${channel}-${msg.id}`}
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start rounded-md px-2 py-1.5 text-left hover:bg-zinc-900"
              onClick={() => jump(channel, msg.id)}
            >
              <div className="min-w-0">
                <div className="truncate text-[10px] text-zinc-300">{msg.text}</div>
                <div className="mt-0.5 text-[9px] text-zinc-500">
                  {channel} · {msg.fromName} · {format(new Date(msg.ts), 'HH:mm:ss')}
                </div>
              </div>
            </Button>
          ))}
          {nodeResults.length > 0 && (
            <>
              <div className="mt-1 px-1.5 text-[9px] tracking-[0.18em] text-zinc-500">УЗЛЫ</div>
              {nodeResults.map(n => (
                <Button
                  key={`find-${n.id}`}
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start rounded-md px-2 py-1.5 text-left hover:bg-zinc-900"
                  onClick={() => pickDm(n)}
                >
                  <div className="truncate text-[10px] text-zinc-300">{n.longName || n.id}</div>
                </Button>
              ))}
            </>
          )}
        </section>
      )}

      {/* Channels */}
      <section className="flex flex-col gap-1 px-1.5 py-2.5">
        <div className="px-1.5 pb-1.5 text-[9px] tracking-[0.18em] text-zinc-500">КАНАЛЫ</div>
        {channelList.map(ch => {
          const color = CHANNEL_PRESETS.find(p => p.name === ch)?.color ?? 'var(--g3)'
          const badge = unread[ch] ?? 0
          const pref = channelPrefs[ch] ?? { pinned: false, muted: false }
          return (
            <div key={ch} className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={clsx(
                  'h-auto flex-1 justify-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs text-zinc-400 transition',
                  activeChannel === ch
                    ? 'border-zinc-600 bg-zinc-900 text-zinc-100'
                    : 'border-transparent hover:bg-zinc-900 hover:text-zinc-200',
                  pref.muted && 'text-zinc-600',
                )}
                style={{ '--c': color } as React.CSSProperties}
                onClick={() => pick(ch)}
              >
                <span
                  className={clsx('h-1.5 w-1.5 flex-shrink-0 rounded-full', activeChannel !== ch && 'opacity-35')}
                  style={{ backgroundColor: color }}
                />
                <span className="flex-1 truncate" style={activeChannel === ch ? { color } : undefined}>{ch}</span>
                {pref.pinned && <span className="text-[10px] text-zinc-400">📌</span>}
                {pref.muted && <span className="text-[10px] text-zinc-500">🔕</span>}
                {badge > 0 && !pref.muted && (
                  <Badge variant="secondary" className="h-4 min-w-4 justify-center rounded-sm px-1 text-[9px] leading-none">{badge}</Badge>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-md px-0 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                title={pref.pinned ? 'Открепить канал' : 'Закрепить канал'}
                onClick={() => setChannelPinned(ch, !pref.pinned)}
              >
                📌
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-md px-0 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                title={pref.muted ? 'Включить уведомления канала' : 'Отключить уведомления канала'}
                onClick={() => setChannelMuted(ch, !pref.muted)}
              >
                {pref.muted ? '🔔' : '🔕'}
              </Button>
            </div>
          )
        })}
      </section>

      {/* Nodes */}
      <Separator />
      <section className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 py-2.5">
        <div className="flex items-center justify-between px-1.5 pb-1.5 text-[9px] tracking-[0.18em] text-zinc-500">
          УЗЛЫ
          <Badge variant="outline" className="rounded-[2px] border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[9px] text-zinc-300">
            {nodeList.filter(n => n.isOnline).length}/{nodeList.length}
          </Badge>
        </div>
        {(search ? nodeResults : nodeList).length === 0
          ? <div className="flex items-center gap-1.5 px-2 py-2.5 text-[11px] text-zinc-600"><span className="animate-[blink_1s_infinite]">_</span> Ожидание…</div>
          : (search ? nodeResults : nodeList).map(n => (
              <NodeRow key={n.id} node={n}
                isMe={n.id === myNodeId}
                onClick={() => pickDm(n)} />
            ))}
      </section>
    </aside>
  )
}

function NodeRow({ node, isMe, onClick }: { node: MeshNode; isMe: boolean; onClick: () => void }) {
  const initials = (node.longName || node.shortName || node.id).slice(0, 2).toUpperCase()
  return (
    <Button
      variant="ghost"
      size="sm"
      className={clsx(
        'h-auto w-full justify-start items-center gap-2 rounded-md px-2 py-1.5 text-left transition',
        isMe ? 'cursor-default' : 'hover:bg-zinc-900',
      )}
      onClick={onClick}
    >
      <div className="relative grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-[10px] font-bold text-zinc-100">
        {initials}
        <span
          className={clsx(
            'absolute -bottom-px -right-px h-2 w-2 rounded-full border-2 border-zinc-950',
            node.isOnline ? 'bg-zinc-100 animate-[pulse-dot_2s_infinite]' : 'bg-zinc-600',
          )}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[11px] text-zinc-100">
          {node.longName || node.id}
          {isMe && <span className="text-[10px] text-zinc-400"> (вы)</span>}
        </span>
        <span className="text-[10px] text-zinc-500">
          {node.rssi !== undefined ? `${node.rssi}dBm` : ''}
          {node.hopsAway !== undefined ? ` · ${node.hopsAway}h` : ''}
          {node.batteryLevel !== undefined ? ` · 🔋${node.batteryLevel}%` : ''}
        </span>
      </div>
    </Button>
  )
}

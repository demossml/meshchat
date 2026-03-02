import { useMemo } from 'react'
import { useStore } from '@/store'
import type { MeshNode } from '@/lib/types'
import type { NodeDiagSample } from '@/store'
import clsx from 'clsx'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function NodesView() {
  const { nodes, diagHistory, myNodeId, setDmTarget, setTab } = useStore()

  const list = useMemo(() =>
    Object.values(nodes).sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0)),
    [nodes]
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2 text-[10px] tracking-[0.1em] text-zinc-400">
        <span>УЗЛЫ СЕТИ</span>
        <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-100">
          {list.filter(n => n.isOnline).length} online / {list.length} всего
        </Badge>
      </div>

      <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(270px,1fr))] content-start gap-2.5 overflow-y-auto p-3">
        {list.length === 0 ? (
          <div className="col-span-full flex items-center gap-1.5 px-5 py-5 text-xs text-zinc-600">
            <span className="animate-[blink_1s_infinite]">_</span> Ожидание пакетов…
          </div>
        ) : list.map(n => (
          <NodeCard
            key={n.id}
            node={n}
            history={diagHistory[n.id] ?? []}
            isMe={n.id === myNodeId}
            onDm={() => { setDmTarget(n); setTab('chat') }}
          />
        ))}
      </div>
    </div>
  )
}

function NodeCard({ node, history, isMe, onDm }: { node: MeshNode; history: NodeDiagSample[]; isMe: boolean; onDm: () => void }) {
  const name    = node.longName || node.id
  const initials = name.slice(0, 2).toUpperCase()
  const age     = Date.now() - node.lastHeard
  const ageLabel = age < 60_000 ? `${Math.round(age / 1000)}с` :
                   age < 3_600_000 ? `${Math.round(age / 60_000)}м` :
                   `${Math.round(age / 3_600_000)}ч`
  const windowed = history.slice(-60)

  return (
    <Card
      className={clsx(
        'gap-3 rounded-lg border-zinc-800 bg-zinc-900 p-0 transition hover:border-zinc-700 animate-[fade-up_0.3s_ease]',
        !node.isOnline && 'opacity-[0.6]',
      )}
    >
      <CardContent className="flex flex-col gap-3 p-3.5">
      {/* Top */}
      <div className="flex items-center gap-2.5">
        <div
          className="relative grid h-10 w-10 flex-shrink-0 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-100"
        >
          {initials}
          <span
            className={clsx(
              'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-zinc-900',
              node.isOnline ? 'bg-zinc-100 animate-[pulse-dot_2s_infinite]' : 'bg-zinc-600',
            )}
          />
        </div>
        <div className="min-w-0 overflow-hidden">
          <div className="truncate text-[13px] font-semibold text-zinc-100">
            {name}
            {isMe && <span className="text-[11px] text-zinc-400"> (вы)</span>}
          </div>
          <div className="mt-px text-[10px] text-zinc-500">{node.id} · {node.hwModel || 'UNKNOWN'}</div>
          <div className="mt-px text-[10px] text-zinc-500">{node.role || 'CLIENT'}</div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {node.rssi       !== undefined && <Stat l="RSSI"    v={`${node.rssi} dBm`} />}
        {node.snr        !== undefined && <Stat l="SNR"     v={`${node.snr} dB`} />}
        {node.hopsAway   !== undefined && <Stat l="HOPS"    v={String(node.hopsAway)} />}
        {node.batteryLevel!== undefined && <Stat l="АКБ"    v={`${node.batteryLevel}%`} warn={node.batteryLevel < 20} />}
        {node.voltage    !== undefined && <Stat l="VOLTAGE" v={`${node.voltage?.toFixed(2)}В`} />}
        {node.lat !== 0  &&               <Stat l="GPS"     v={`${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}`} wide />}
        <Stat l="SEEN"   v={ageLabel} />
        <Stat l="СТАТУС" v={node.isOnline ? 'online' : 'offline'} ok={node.isOnline} />
      </div>

      {/* Diagnostics history */}
      <div className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2">
        <div className="mb-1.5 flex items-center justify-between text-[8px] tracking-[0.13em] text-zinc-500">
          <span>MESH-ДИАГНОСТИКА</span>
          <span>{windowed.length} pts</span>
        </div>
        <div className="grid gap-1.5">
          <MetricTrend
            label="RSSI"
            unit="dBm"
            samples={windowed.map(s => s.rssi)}
            strokeClass="stroke-zinc-200"
            precision={0}
          />
          <MetricTrend
            label="SNR"
            unit="dB"
            samples={windowed.map(s => s.snr)}
            strokeClass="stroke-zinc-400"
            precision={1}
          />
          <MetricTrend
            label="HOPS"
            unit=""
            samples={windowed.map(s => s.hops)}
            strokeClass="stroke-zinc-500"
            precision={0}
          />
        </div>
      </div>

      {/* Actions */}
      {!isMe && (
        <Button
          variant="secondary"
          className="h-auto w-full rounded-md border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] tracking-[0.04em] text-zinc-100 hover:border-zinc-600 hover:bg-zinc-700"
          onClick={onDm}
        >
          Написать личное сообщение
        </Button>
      )}
      </CardContent>
    </Card>
  )
}

function Stat({ l, v, warn, ok, wide }: { l: string; v: string; warn?: boolean; ok?: boolean; wide?: boolean }) {
  const color = warn ? '#fafafa' : ok === true ? '#fafafa' : ok === false ? '#a1a1aa' : undefined
  return (
    <div className={clsx('flex flex-col gap-0.5 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5', wide && 'col-span-full')}>
      <span className="text-[8px] tracking-[0.15em] text-zinc-500">{l}</span>
      <span className="text-[11px] text-zinc-100" style={color ? { color } : undefined}>{v}</span>
    </div>
  )
}

function MetricTrend({
  label,
  unit,
  samples,
  strokeClass,
  precision,
}: {
  label: string
  unit: string
  samples: Array<number | undefined>
  strokeClass: string
  precision: number
}) {
  const defined = samples
    .map((value, idx) => value === undefined ? null : { idx, value })
    .filter((v): v is { idx: number; value: number } => v !== null)
  const latest = defined.length > 0 ? defined[defined.length - 1].value : undefined

  const w = 100
  const h = 24
  const pad = 2
  const denom = Math.max(1, samples.length - 1)

  let min = 0
  let max = 1
  if (defined.length > 0) {
    min = Math.min(...defined.map(p => p.value))
    max = Math.max(...defined.map(p => p.value))
    if (min === max) {
      min -= 1
      max += 1
    }
  }

  const points = defined.map(p => {
    const x = (p.idx / denom) * w
    const yNorm = (p.value - min) / (max - min)
    const y = h - pad - yNorm * (h - pad * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  return (
    <div className="grid grid-cols-[48px_1fr_56px] items-center gap-2">
      <span className="text-[8px] tracking-[0.12em] text-zinc-500">{label}</span>
      <div className="h-7 rounded border border-zinc-800 bg-zinc-900/70 px-1 py-0.5">
        {defined.length >= 2 ? (
          <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
            <polyline
              points={points}
              fill="none"
              className={clsx('stroke-[1.5]', strokeClass)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div className="grid h-full place-items-center text-[8px] text-zinc-600">нет данных</div>
        )}
      </div>
      <span className="text-right text-[9px] text-zinc-300">
        {latest === undefined ? '—' : `${latest.toFixed(precision)}${unit ? ` ${unit}` : ''}`}
      </span>
    </div>
  )
}

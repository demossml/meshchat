import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import type { ChatMessage } from '@/lib/types'

const HEALTH_WINDOW_MS = 20 * 60 * 1000
const BAD_ALERT_DELAY_MS = 15_000

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  return Math.round(sorted[mid])
}

function messageEndTs(msg: ChatMessage): number | null {
  return msg.ackAt ?? msg.deliveredAt ?? msg.readAt ?? null
}

export function LinkHealthPanel() {
  const { messages, outbox } = useStore()
  const [badStartedAt, setBadStartedAt] = useState<number | null>(null)
  const [badAlertVisible, setBadAlertVisible] = useState(false)
  const [badAlertDismissed, setBadAlertDismissed] = useState(false)

  const health = useMemo(() => {
    const now = Date.now()
    const own = Object.values(messages)
      .flat()
      .filter(msg => msg.isOwn && now - msg.ts <= HEALTH_WINDOW_MS)

    const completed = own.filter(msg => ['ack', 'delivered', 'read', 'failed'].includes(msg.status ?? ''))
    const failed = completed.filter(msg => msg.status === 'failed').length
    const success = completed.filter(msg => msg.status === 'ack' || msg.status === 'delivered' || msg.status === 'read')

    const latencySamples = success
      .map(msg => {
        const end = messageEndTs(msg)
        const start = msg.sentAt ?? msg.ts
        if (!end || end <= start) return null
        return end - start
      })
      .filter((value): value is number => value !== null)

    const retried = completed.filter(msg => (msg.sendAttempts ?? 1) > 1).length
    const lossPct = completed.length > 0 ? (failed / completed.length) * 100 : 0
    const retryPct = completed.length > 0 ? (retried / completed.length) * 100 : 0
    const latencyMs = median(latencySamples)

    const lossTone: 'ok' | 'warn' | 'bad' = lossPct >= 45 ? 'bad' : lossPct >= 20 ? 'warn' : 'ok'
    const latencyTone: 'ok' | 'warn' | 'bad' = latencyMs === null ? 'ok' : latencyMs >= 8000 ? 'bad' : latencyMs >= 3500 ? 'warn' : 'ok'
    const retryTone: 'ok' | 'warn' | 'bad' = retryPct >= 55 ? 'bad' : retryPct >= 25 ? 'warn' : 'ok'
    const queueTone: 'ok' | 'warn' | 'bad' = outbox.length >= 8 ? 'bad' : outbox.length >= 3 ? 'warn' : 'ok'
    const hasBad = lossTone === 'bad' || latencyTone === 'bad' || retryTone === 'bad' || queueTone === 'bad'

    const badReasons: string[] = []
    if (lossTone === 'bad') badReasons.push(`loss ${lossPct.toFixed(0)}%`)
    if (latencyTone === 'bad') badReasons.push(`latency ${latencyMs ?? 0}ms`)
    if (retryTone === 'bad') badReasons.push(`retry ${retryPct.toFixed(0)}%`)
    if (queueTone === 'bad') badReasons.push(`queue ${outbox.length}`)

    return {
      lossPct,
      retryPct,
      latencyMs,
      queueDepth: outbox.length,
      sampleSize: completed.length,
      lossTone,
      latencyTone,
      retryTone,
      queueTone,
      hasBad,
      badReasonText: badReasons.join(' · '),
    }
  }, [messages, outbox.length])

  useEffect(() => {
    if (!health.hasBad) {
      setBadStartedAt(null)
      setBadAlertVisible(false)
      setBadAlertDismissed(false)
      return
    }

    setBadStartedAt((prev) => {
      if (prev !== null) return prev
      setBadAlertDismissed(false)
      return Date.now()
    })
  }, [health.hasBad])

  useEffect(() => {
    if (!health.hasBad || badStartedAt === null || badAlertDismissed) return
    const elapsed = Date.now() - badStartedAt
    if (elapsed >= BAD_ALERT_DELAY_MS) {
      setBadAlertVisible(true)
      return
    }
    const timer = setTimeout(() => setBadAlertVisible(true), BAD_ALERT_DELAY_MS - elapsed)
    return () => clearTimeout(timer)
  }, [badAlertDismissed, badStartedAt, health.hasBad])

  return (
    <section className="border-b border-zinc-800 bg-zinc-950/80 px-2 py-1.5 md:px-3">
      {badAlertVisible && health.hasBad && !badAlertDismissed && (
        <div className="mb-1.5 flex items-center gap-2 rounded border border-zinc-200 bg-zinc-100 px-2 py-1 text-[9px] text-zinc-900">
          <span className="font-semibold tracking-[0.08em]">LINK DEGRADED</span>
          <span className="truncate">{health.badReasonText || 'high loss/latency/retry or queue depth'}</span>
          <button
            type="button"
            className="ml-auto rounded border border-zinc-400 px-1 py-0 leading-none text-zinc-700"
            onClick={() => {
              setBadAlertVisible(false)
              setBadAlertDismissed(true)
            }}
            aria-label="Hide health alert"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex items-center gap-1 overflow-x-auto">
        <span className="shrink-0 text-[9px] tracking-[0.12em] text-zinc-500">LINK HEALTH</span>
        <MetricChip
          label="loss"
          value={`${health.lossPct.toFixed(0)}%`}
          tone={health.lossTone}
          hint="Доля failed среди завершенных исходящих сообщений за окно 20 минут."
        />
        <MetricChip
          label="latency"
          value={health.latencyMs !== null ? `${health.latencyMs}ms` : 'n/a'}
          tone={health.latencyTone}
          hint="Медиана времени от sent до ack/delivered/read."
        />
        <MetricChip
          label="retry rate"
          value={`${health.retryPct.toFixed(0)}%`}
          tone={health.retryTone}
          hint="Доля сообщений, которым потребовалась повторная попытка отправки."
        />
        <MetricChip
          label="queue depth"
          value={String(health.queueDepth)}
          tone={health.queueTone}
          hint="Количество сообщений в очереди outbox, ожидающих отправки."
        />
        <span className="ml-auto shrink-0 text-[9px] text-zinc-600">n={health.sampleSize}</span>
      </div>
      <div className="mt-1 hidden items-center gap-3 text-[8px] text-zinc-600 sm:flex">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-zinc-500" /> ok</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-zinc-300" /> warn</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-zinc-100" /> bad</span>
      </div>
    </section>
  )
}

function MetricChip({ label, value, tone, hint }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad'; hint: string }) {
  const toneClass = tone === 'bad'
    ? 'border-zinc-200 bg-zinc-100 text-zinc-900'
    : tone === 'warn'
      ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
      : 'border-zinc-700 bg-zinc-900 text-zinc-400'
  return (
    <div className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] ${toneClass}`} title={`${label}: ${hint}`}>
      <span className={tone === 'bad' ? 'text-zinc-700' : 'text-zinc-500'}>{label}: </span>{value}
    </div>
  )
}

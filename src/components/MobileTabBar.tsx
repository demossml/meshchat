import { useMemo } from 'react'
import clsx from 'clsx'
import { useStore } from '@/store'
import type { Tab } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

const MOBILE_TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'chat', label: 'Чат', icon: '💬' },
  { id: 'map', label: 'Карта', icon: '◎' },
  { id: 'nodes', label: 'Узлы', icon: '◈' },
  { id: 'groups', label: 'Группы', icon: '◉' },
]

export function MobileTabBar() {
  const { tab, setTab, unread, nodes, groupProfiles } = useStore()

  const unreadTotal = useMemo(
    () => Object.values(unread).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0),
    [unread],
  )
  const onlineNodes = useMemo(
    () => Object.values(nodes).filter(node => node.isOnline).length,
    [nodes],
  )
  const groupsCount = groupProfiles.length

  return (
    <nav className="mobile-tabbar z-40 shrink-0 border-b border-zinc-800 bg-zinc-950/95 px-2 py-1.5 backdrop-blur-md md:hidden">
      <div className="grid grid-cols-4 gap-1">
        {MOBILE_TABS.map(item => {
          const isActive = tab === item.id
          const badgeValue = item.id === 'chat'
            ? unreadTotal
            : item.id === 'nodes'
              ? onlineNodes
              : item.id === 'groups'
                ? groupsCount
              : null

          return (
            <button
              key={item.id}
              type="button"
              className={clsx(
                'relative flex h-11 items-center justify-center rounded-md border text-xs transition',
                isActive
                  ? 'border-zinc-300/40 bg-zinc-100 text-zinc-900'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300 active:bg-zinc-800',
              )}
              onClick={() => setTab(item.id)}
              aria-label={item.label}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm leading-none">{item.icon}</span>
                <span className="text-[11px] tracking-[0.04em]">{item.label}</span>
              </div>
              {badgeValue !== null && badgeValue > 0 && (
                <Badge
                  variant="secondary"
                  className={clsx(
                    'absolute right-1.5 top-1 h-4 min-w-4 justify-center rounded-sm px-1 text-[9px] leading-none',
                    isActive ? 'bg-zinc-900 text-zinc-100' : '',
                  )}
                >
                  {badgeValue > 99 ? '99+' : badgeValue}
                </Badge>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

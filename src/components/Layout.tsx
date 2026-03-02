import { useStore } from '@/store'
import { Header }   from './Header'
import { Sidebar }  from './Sidebar'
import { ChatView } from './ChatView'
import { MapView }  from './MapView'
import { NodesView }from './NodesView'
import { MobileTabBar } from './MobileTabBar'

export function Layout() {
  const { tab } = useStore()

  return (
    <div className="flex h-[var(--app-vh)] w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Header />
      <MobileTabBar />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {tab === 'chat'  && <ChatView />}
          {tab === 'map'   && <MapView />}
          {tab === 'nodes' && <NodesView />}
        </main>
      </div>
    </div>
  )
}

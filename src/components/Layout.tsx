import { useStore } from '@/store'
import { Header }   from './Header'
import { Sidebar }  from './Sidebar'
import { ChatView } from './ChatView'
import { MapView }  from './MapView'
import { NodesView }from './NodesView'
import { GroupsView } from './GroupsView'
import { LinkHealthPanel } from './LinkHealthPanel'
import { MobileTabBar } from './MobileTabBar'

export function Layout() {
  const { tab } = useStore()

  return (
    <div className="flex h-[var(--app-vh)] w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Header />
      <LinkHealthPanel />
      <MobileTabBar />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {tab === 'chat'  && <ChatView />}
          {tab === 'map'   && <MapView />}
          {tab === 'nodes' && <NodesView />}
          {tab === 'groups' && <GroupsView />}
        </main>
      </div>
    </div>
  )
}

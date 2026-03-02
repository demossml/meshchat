import { useStore } from '@/store'
import { useWebSocket } from '@/hooks/useWebSocket'
import { ConnectScreen } from '@/components/ConnectScreen'
import { Layout } from '@/components/Layout'

// Передаём send вниз через context вместо prop drilling
import { createContext, useContext } from 'react'
export const SendCtx = createContext<(d: object) => boolean>(() => false)
export const useSend = () => useContext(SendCtx)

export default function App() {
  const { wsUrl, config } = useStore()
  const { send } = useWebSocket(wsUrl)

  return (
    <SendCtx.Provider value={send}>
      {!config ? <ConnectScreen /> : <Layout />}
    </SendCtx.Provider>
  )
}

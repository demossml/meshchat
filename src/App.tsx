import { useStore } from '@/store'
import { useWebSocket } from '@/hooks/useWebSocket'
import { ConnectScreen } from '@/components/ConnectScreen'
import { Layout } from '@/components/Layout'
import { OnboardingWizard } from '@/components/OnboardingWizard'
import { SecurityGate } from '@/components/SecurityGate'

// Передаём send вниз через context вместо prop drilling
import { createContext, useContext, useEffect } from 'react'
export const SendCtx = createContext<(d: object) => boolean>(() => false)
export const useSend = () => useContext(SendCtx)

export default function App() {
  const { wsUrl, config, onboardingCompleted, securityEnabled, securityUnlocked, lockSecurity } = useStore()
  const { send } = useWebSocket(wsUrl)

  useEffect(() => {
    if (!securityEnabled) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') lockSecurity()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [lockSecurity, securityEnabled])

  return (
    <SendCtx.Provider value={send}>
      {!config ? <ConnectScreen /> : (
        <>
          <Layout />
          {!onboardingCompleted && <OnboardingWizard />}
        </>
      )}
      {securityEnabled && !securityUnlocked && <SecurityGate />}
    </SendCtx.Provider>
  )
}

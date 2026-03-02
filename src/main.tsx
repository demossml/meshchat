import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

function applyViewportMetrics() {
  const root = document.documentElement
  const viewportHeight = Math.round(window.visualViewport?.height ?? window.innerHeight)
  root.style.setProperty('--app-vh', `${viewportHeight}px`)

  // Telegram WebApp может отдавать safe-area отдельно от CSS env().
  const telegram = (window as Window & {
    Telegram?: {
      WebApp?: {
        safeAreaInset?: { top?: number; bottom?: number }
        contentSafeAreaInset?: { top?: number; bottom?: number }
        onEvent?: (event: string, cb: () => void) => void
      }
    }
  }).Telegram?.WebApp

  const inset = telegram?.safeAreaInset ?? telegram?.contentSafeAreaInset
  if (!inset) return
  if (typeof inset.top === 'number') root.style.setProperty('--tg-safe-top', `${Math.max(0, inset.top)}px`)
  if (typeof inset.bottom === 'number') root.style.setProperty('--tg-safe-bottom', `${Math.max(0, inset.bottom)}px`)
}

applyViewportMetrics()
window.addEventListener('resize', applyViewportMetrics, { passive: true })
window.addEventListener('orientationchange', applyViewportMetrics, { passive: true })
window.visualViewport?.addEventListener('resize', applyViewportMetrics, { passive: true })
;(window as Window & { Telegram?: { WebApp?: { onEvent?: (event: string, cb: () => void) => void } } })
  .Telegram?.WebApp?.onEvent?.('viewportChanged', applyViewportMetrics)
window.addEventListener('focusin', applyViewportMetrics, { passive: true })
window.addEventListener('focusout', applyViewportMetrics, { passive: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

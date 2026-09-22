import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './lib/auth'
import { installErrorReporting } from './lib/errorReporting'
import { I18nProvider } from './lib/i18n'

installErrorReporting()

// TEMP DEBUG — remove once the Capacitor sm: breakpoint mystery is solved.
// A fixed on-screen readout since Safari's Web Inspector hasn't been
// reachable for the Simulator; screenshot this instead of guessing further.
function ViewportDebug() {
  const mm = (q: string) => (window.matchMedia?.(q).matches ? 'YES' : 'no')
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 999999,
        background: 'red',
        color: 'white',
        font: '11px monospace',
        padding: '2px 4px',
        pointerEvents: 'none',
      }}
    >
      innerWidth={window.innerWidth} innerHeight={window.innerHeight} dpr={window.devicePixelRatio} sm(640)=
      {mm('(min-width: 640px)')} visualViewport=
      {window.visualViewport?.width}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <AuthProvider>
          <ViewportDebug />
          <App />
        </AuthProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)

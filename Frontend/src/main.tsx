import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './lib/auth'
import { ConfirmProvider } from './lib/confirm'
import { installErrorReporting } from './lib/errorReporting'
import { I18nProvider } from './lib/i18n'

installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <ConfirmProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)

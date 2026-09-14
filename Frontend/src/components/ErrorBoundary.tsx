import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Catches render-time crashes so a bug shows a recoverable screen instead of a
 * blank page, and so it's always reported even if the browser doesn't otherwise
 * surface it to window.onerror. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: `${error.stack}\n\nComponent stack:${info.componentStack}`,
        url: window.location.href,
      }),
      keepalive: true,
    }).catch(() => {})
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-cream p-6 text-center">
          <span className="font-heading text-lg font-bold text-ink">Something went wrong</span>
          <p className="max-w-sm font-body text-sm text-muted-ink">
            Sorry about that — it's been reported. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full border-2 border-ink bg-paper px-4 py-1.5 font-heading text-sm font-bold text-ink"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

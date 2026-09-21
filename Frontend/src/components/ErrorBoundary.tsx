import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// This sits above <I18nProvider> in main.tsx on purpose (a crash inside the
// provider itself must still be caught), so its fallback can't use useT() —
// there's no i18n context above it to read from. Read the same localStorage
// key i18n.tsx uses directly instead of a proper t() call.
const FALLBACK_STRINGS = {
  en: {
    title: 'Something went wrong',
    body: "Sorry about that — it's been reported. Reloading usually fixes it.",
    reload: 'Reload',
  },
  zh: {
    title: '出错了',
    body: '抱歉，我们已经收到报告，刷新页面通常就能解决。',
    reload: '刷新',
  },
} as const

function currentLangStrings() {
  try {
    if (localStorage.getItem('fruitcrew.lang') === 'zh') return FALLBACK_STRINGS.zh
  } catch {
    /* ignore */
  }
  return FALLBACK_STRINGS.en
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
      const s = currentLangStrings()
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-cream p-6 text-center">
          <span className="font-heading text-lg font-bold text-ink">{s.title}</span>
          <p className="max-w-sm font-body text-sm text-muted-ink">{s.body}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full border-2 border-ink bg-paper px-4 py-1.5 font-heading text-sm font-bold text-ink"
          >
            {s.reload}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

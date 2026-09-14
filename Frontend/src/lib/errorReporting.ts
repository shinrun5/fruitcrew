// A crash on someone else's phone, in a browser you'll never test, is
// otherwise invisible — plain fetch (not lib/api's wrapper: this must never
// depend on being logged in, and must never itself throw or retry).
function report(message: string, stack?: string) {
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack, url: window.location.href }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore — reporting a crash must never cause another one
  }
}

/** Call once at startup. Catches render/script errors and unhandled promise
 * rejections that would otherwise only ever show up in one person's console. */
export function installErrorReporting() {
  window.addEventListener('error', (e) => {
    report(e.message, e.error?.stack)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    report(message, reason instanceof Error ? reason.stack : undefined)
  })
}

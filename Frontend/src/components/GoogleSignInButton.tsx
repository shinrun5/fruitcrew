import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null

/** Loads Google Identity Services once, however many <GoogleSignInButton>s end
 * up mounted across the app's lifetime. */
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google sign-in'))
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

/** Renders nothing if VITE_GOOGLE_CLIENT_ID isn't set — a half-wired button
 * that fails when clicked is worse than one that just isn't there yet. */
export function GoogleSignInButton({ onToken }: { onToken: (idToken: string) => void }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    loadGoogleScript()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [clientId])

  useEffect(() => {
    if (!ready || !clientId || !ref.current || !window.google) return
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => onToken(response.credential),
    })
    // Google's own icon-only variant — their branding terms don't allow
    // reskinning the "G" mark itself to match the app's own button style,
    // so this is the closest compliant option to a plain icon button.
    window.google.accounts.id.renderButton(ref.current, {
      type: 'icon',
      shape: 'circle',
      theme: 'outline',
      size: 'large',
    })
  }, [ready, clientId, onToken])

  if (!clientId) return null
  return <div ref={ref} className="flex justify-center" />
}

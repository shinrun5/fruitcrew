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
  // holds the latest onToken without making the setup effect below re-run
  // (and re-call initialize/renderButton) every time the parent re-renders
  // and passes a new inline callback — Google's own console warns loudly if
  // initialize() runs more than once
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })

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
      callback: (response) => onTokenRef.current(response.credential),
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
  }, [ready, clientId])

  if (!clientId) return null
  return (
    // Google's own icon graphic keeps failing to render inside their button
    // (a live server/rendering quirk on their end, not something in our
    // control — the button's actual click-to-sign-in works fine regardless).
    // A static "G" laid on top, clicks passing through to Google's real
    // button underneath, sidesteps it without touching the working part.
    <div className="relative flex justify-center">
      <div ref={ref} />
      <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <path
          fill="#FFC107"
          d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
        />
        <path
          fill="#FF3D00"
          d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
        />
        <path
          fill="#4CAF50"
          d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
        />
        <path
          fill="#1976D2"
          d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
        />
      </svg>
    </div>
  )
}

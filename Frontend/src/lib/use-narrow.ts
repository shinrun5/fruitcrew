import { useEffect, useState } from 'react'

const BREAKPOINT = 640 // Tailwind's sm:

/** The same check, read once — for code outside a component's render. */
export const isNarrowScreen = () => window.innerWidth < BREAKPOINT

/** True below Tailwind's sm: breakpoint — a JS-computed equivalent of a
 * sm:hidden/hidden-sm:inline CSS split, for the one spot (Header's
 * Post/Generate buttons) where that CSS split wasn't taking effect inside
 * the Capacitor WKWebView for reasons a plain window.innerWidth check
 * sidesteps rather than needing to root-cause. */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrowScreen)
  useEffect(() => {
    const onResize = () => setNarrow(isNarrowScreen())
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}

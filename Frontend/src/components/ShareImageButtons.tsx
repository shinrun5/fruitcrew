import { useRef, useState } from 'react'
import { Button } from './Button'
import { useT } from '../lib/i18n'

/** Buttons that render `draw()` to a PNG, then either save it or open the
 * native share sheet (WeChat, Messages, whatever's installed). */
export function ShareImageButtons({
  filename,
  shareTitle,
  draw,
}: {
  filename: string
  shareTitle: string
  draw: () => HTMLCanvasElement
}) {
  const t = useT()
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)
  // the disabled= prop only takes effect after React re-renders, which is a
  // beat too slow to stop a fast double-tap on a touchscreen from firing
  // run() twice (two share sheets, e.g. two of the same image sent) — this
  // guard is synchronous, checked and set before anything async starts
  const running = useRef(false)
  const canShareFiles =
    typeof navigator.share === 'function' &&
    typeof (navigator as Navigator & { canShare?: unknown }).canShare === 'function'

  async function run(mode: 'download' | 'share') {
    if (running.current) return
    running.current = true
    setBusy(mode)
    try {
      const canvas = draw()
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      if (mode === 'share') {
        const file = new File([blob], filename, { type: 'image/png' })
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
        if (nav.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: shareTitle })
          return
        }
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // share sheet cancelled, etc. — nothing to show for it
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Share (native share sheet) already covers "save this" wherever it's
       * available — its own "Save Image"/"Save to Files" destinations — so
       * Download only needs to show where Share isn't an option (desktop
       * browsers mostly). Keeping both would also risk Download silently
       * doing nothing in a bare WebView with no download manager wired up. */}
      {!canShareFiles && (
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void run('download')}>
          {busy === 'download' ? t('schedule.export.preparing') : t('schedule.export.download')}
        </Button>
      )}
      {canShareFiles && (
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void run('share')}>
          {busy === 'share' ? t('schedule.export.preparing') : t('schedule.export.share')}
        </Button>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { FruitAvatar } from './FruitAvatar'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { FRUITS } from '../lib/fruit'

/** Pure fruit-swatch grid — each fruit is one-per-store, so anything in
 * `taken` is locked out unless it's already `value`. `size` under 26px drops
 * labels and switches to a compact flex-wrap layout (the manager-editing
 * context); at or above 26px it's a labeled grid (the self-service context). */
export function FruitPicker({
  value,
  taken,
  onChange,
  size = 30,
  disabled,
}: {
  value: string | null
  taken: Set<string>
  onChange: (fruit: string) => void
  size?: number
  disabled?: boolean
}) {
  const compact = size < 26
  return (
    <div className={compact ? 'flex flex-wrap gap-1' : 'grid grid-cols-3 gap-2 sm:grid-cols-4'}>
      {FRUITS.map((f) => {
        const isMine = f === value
        const locked = !isMine && taken.has(f)
        return (
          <button
            key={f}
            type="button"
            disabled={locked || disabled}
            title={locked ? `${f} — taken` : f}
            onClick={() => onChange(f)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-xl border-2 transition-colors duration-150 ease-out',
              compact ? 'h-8 w-8 p-0' : 'px-1 py-2',
              isMine
                ? 'border-ink bg-cream shadow-ink-card'
                : locked
                  ? 'border-ink/15 opacity-30'
                  : 'border-ink/20 hover:bg-cream',
            )}
          >
            <FruitAvatar kind={f} size={size} />
            {!compact && (
              <span className="font-body text-[10px] font-bold capitalize leading-none text-ink">{f}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Self-service wrapper: fetches/saves your own fruit, then renders the pure
 * picker above. Used by Profile; the manager-side editor in Workers.tsx
 * already has its worker's fruit + the store's taken set in local state, so
 * it renders <FruitPicker> directly instead. */
export function MyFruitPicker() {
  const [mine, setMine] = useState<string | null>(null)
  const [taken, setTaken] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getMyFruit()
      .then((r) => {
        setMine(r.mine)
        setTaken(new Set(r.taken))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load fruits'))
      .finally(() => setLoading(false))
  }, [])

  async function pick(fruit: string | null) {
    if (saving) return
    setSaving(fruit ?? 'default')
    setError(null)
    try {
      const r = await api.setMyFruit(fruit)
      setMine(r.fruit)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <p className="font-body text-sm text-muted-ink">Loading…</p>

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-heading text-sm font-bold text-ink">Your fruit</span>
        {mine && (
          <button
            onClick={() => void pick(null)}
            className="font-body text-[11px] font-bold text-muted-ink underline"
          >
            use default
          </button>
        )}
      </div>
      <p className="mt-0.5 font-body text-xs text-muted-ink">
        One per store — greyed-out ones are already taken by a coworker.
      </p>
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <div className="mt-2">
        <FruitPicker value={mine} taken={taken} onChange={(f) => void pick(f)} disabled={saving !== null} />
      </div>
    </div>
  )
}

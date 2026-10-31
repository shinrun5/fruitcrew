import type { ReactNode } from 'react'

/** A small rounded status label. */
export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px font-body text-[10px] font-bold ${tone}`}>{children}</span>
}

/** A number with a label under it — the earnings and overview tiles. */
export function Stat({ label, value, hint, tone = 'text-ink' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border-2 border-ink/15 bg-paper px-3 py-2">
      <span className={`font-heading text-lg font-extrabold ${tone}`}>{value}</span>
      <span className="font-body text-[11px] font-bold text-muted-ink">{label}</span>
      {hint && <span className="mt-0.5 font-body text-[10px] text-muted-ink">{hint}</span>}
    </div>
  )
}

/** A page section's heading, with an optional one-line explanation. */
export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mt-5 mb-2 flex items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="font-heading text-sm font-bold text-ink">{title}</h2>
        {hint && <p className="font-body text-[11px] text-muted-ink">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

/** Paid months used out of the limit. */
export function MonthsBar({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full border border-ink/20 bg-cream" role="progressbar" aria-valuenow={used} aria-valuemax={max}>
      <div className="h-full rounded-full bg-green" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Page wrapper for the ambassador portal: a phone-width column. */
export function AmbPage({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col p-4 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink print:hidden">{title}</h1>
      {sub && <p className="mt-0.5 font-body text-xs text-muted-ink print:hidden">{sub}</p>}
      {children}
    </div>
  )
}

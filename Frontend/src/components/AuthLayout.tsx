import type { InputHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FruitAvatar } from './FruitAvatar'

/** Centered chunky card for the login / register screens. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream p-6">
      <div className="w-full max-w-sm rounded-2xl border-[3px] border-ink bg-paper p-7 shadow-[6px_6px_0_var(--color-ink)]">
        <div className="mb-5 flex flex-col items-center gap-2">
          <FruitAvatar kind="apple" size={40} />
          <h1 className="font-heading text-xl font-extrabold text-ink">{title}</h1>
          {subtitle && (
            <p className="text-center font-body text-xs font-semibold text-muted-ink">{subtitle}</p>
          )}
        </div>
        {children}
        {footer && <div className="mt-4 text-center font-body text-xs text-muted-ink">{footer}</div>}
        <p className="mt-4 text-center font-body text-[11px] text-muted-ink">
          By continuing you agree to our{' '}
          <Link to="/terms" className="underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block font-body text-xs font-bold text-muted-ink">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border-[2.5px] border-ink bg-cream px-3 py-2 font-body text-sm text-ink outline-none transition-colors focus:bg-paper"
      />
    </label>
  )
}

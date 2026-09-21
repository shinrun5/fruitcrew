import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FruitAvatar } from './FruitAvatar'
import { useT } from '../lib/i18n'

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
  const t = useT()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream p-6">
      <div className="w-full max-w-sm rounded-2xl border-[3px] border-ink bg-paper p-7 shadow-ink-hero">
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
          {t('auth.agreeTo')}{' '}
          <Link to="/terms" className="underline">
            {t('profile.terms')}
          </Link>{' '}
          {t('auth.and')}{' '}
          <Link to="/privacy" className="underline">
            {t('auth.privacyPolicy')}
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

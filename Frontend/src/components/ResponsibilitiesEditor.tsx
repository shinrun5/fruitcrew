import { useEffect, useState } from 'react'
import { StarBadgeIcon } from './icons'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { Responsibility, ResponsibilityScope } from '../types'

const SCOPES: ResponsibilityScope[] = ['OPENING', 'CLOSING', 'ANY']
const SCOPE_LABEL_KEY = {
  OPENING: 'stores.responsibilities.scope.OPENING',
  CLOSING: 'stores.responsibilities.scope.CLOSING',
  ANY: 'stores.responsibilities.scope.ANY',
} as const satisfies Record<ResponsibilityScope, string>

/** Per-store editor for the store's custom capability/role list — replaces the
 * old fixed canOpen/canClose booleans and the fixed 4-role Closing Duties
 * board. Grouped by scope so it's clear which shifts a role is even relevant
 * for (Opening-time, Closing-time, or Any). */
export function ResponsibilitiesEditor({ storeId }: { storeId: number }) {
  const t = useT()
  const [rows, setRows] = useState<Responsibility[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  function refresh() {
    return api
      .getResponsibilities(storeId)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : t('stores.responsibilities.errLoad')))
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.responsibilities.errGeneric'))
    }
  }

  if (loading) return <p className="mt-2 font-body text-xs text-muted-ink">{t('common.loading')}</p>

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-ink/10 pt-3">
      {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
      {SCOPES.map((scope) => {
        const scopeRows = rows.filter((r) => r.scope === scope)
        return (
          <div key={scope}>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-heading text-[11px] font-bold text-ink">{t(SCOPE_LABEL_KEY[scope])}</span>
              <button
                onClick={() =>
                  void act(() =>
                    api.createResponsibility({
                      storeId,
                      name: `${t('stores.responsibilities.newName')} ${scopeRows.length + 1}`,
                      scope,
                    }),
                  )
                }
                className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-heading text-[10px] font-bold text-ink"
              >
                {t('stores.responsibilities.add')}
              </button>
            </div>
            {scopeRows.length === 0 ? (
              <span className="font-body text-[11px] text-muted-ink">{t('stores.responsibilities.none')}</span>
            ) : (
              <div className="flex flex-col gap-1.5">
                {scopeRows.map((r) => (
                  <Row
                    key={r.id}
                    resp={r}
                    onRename={(name) => act(() => api.updateResponsibility(r.id, { name }))}
                    onArchive={() => {
                      if (window.confirm(t('stores.responsibilities.confirmArchive', { name: r.name })))
                        void act(() => api.archiveResponsibility(r.id))
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Row({
  resp,
  onRename,
  onArchive,
}: {
  resp: Responsibility
  onRename: (name: string) => void
  onArchive: () => void
}) {
  const t = useT()
  const [name, setName] = useState(resp.name)
  const dirty = name.trim() !== resp.name && name.trim().length > 0

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-cream/60 p-1.5">
      {resp.builtin && <StarBadgeIcon size={11} />}
      {resp.builtin ? (
        <span className="font-body text-xs font-bold text-ink">{resp.name}</span>
      ) : (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border-2 border-ink bg-cream px-1.5 py-0.5 font-body text-xs text-ink outline-none"
        />
      )}
      {resp.builtin && (
        <span className="font-body text-[10px] text-muted-ink">{t('stores.responsibilities.builtinHint')}</span>
      )}
      <div className="ml-auto flex gap-1.5">
        {dirty && (
          <button
            onClick={() => onRename(name.trim())}
            className="rounded-full border-2 border-ink bg-green px-2 py-0.5 font-heading text-[10px] font-bold text-white"
          >
            {t('common.save')}
          </button>
        )}
        {!resp.builtin && (
          <button
            onClick={onArchive}
            className="rounded-full border-2 border-coral px-2 py-0.5 font-heading text-[10px] font-bold text-coral-dark"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

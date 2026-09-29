import { useT } from '../lib/i18n'
import type { Store } from '../types'

/** Store/section picker shared by a manager invite, an existing manager's own
 * store toggles, and a manager/owner picking which store(s) they'll actually
 * work as staff. A section always grants real access (that's where the
 * actual schedule/requirements/chat live); its parent store, once it has
 * sections, is never itself scheduled — so it's shown separately with a
 * hint rather than looking like just another store when picking *management*
 * access. For picking *work* access (`includeParentOfSections={false}`) the
 * parent is dropped entirely instead, since being staff at a store that's
 * never itself scheduled wouldn't do anything. */
export function StorePicker({
  stores,
  picked,
  onToggle,
  disabled,
  includeParentOfSections = true,
}: {
  stores: Store[]
  picked: number[]
  onToggle: (id: number) => void
  disabled?: boolean
  includeParentOfSections?: boolean
}) {
  const t = useT()
  const topLevel = stores.filter((s) => s.parentStoreId == null)
  const sectionsOf = (id: number) => stores.filter((s) => s.parentStoreId === id)

  const pill = (s: Store, on: boolean) => (
    <button
      key={s.id}
      type="button"
      disabled={disabled}
      onClick={() => onToggle(s.id)}
      className={`rounded-full border-2 px-2 py-0.5 font-heading text-[10px] font-bold ${
        on ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
      }`}
    >
      {s.name}
    </button>
  )

  return (
    <div className="flex flex-col gap-1.5">
      {topLevel.map((s) => {
        const sections = sectionsOf(s.id)
        const showParent = includeParentOfSections || sections.length === 0
        return (
          <div key={s.id}>
            {showParent && (
              <div className="flex flex-wrap items-center gap-1.5">
                {pill(s, picked.includes(s.id))}
                {sections.length > 0 && (
                  <span className="font-body text-[9px] text-muted-ink">{t('stores.managers.parentGrants')}</span>
                )}
              </div>
            )}
            {sections.length > 0 && (
              <div className={showParent ? 'ml-3 mt-1 flex flex-wrap gap-1.5 border-l-2 border-ink/15 pl-2' : 'flex flex-wrap gap-1.5'}>
                {sections.map((sec) => pill(sec, picked.includes(sec.id)))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

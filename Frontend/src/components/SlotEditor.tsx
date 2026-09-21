import { useState } from 'react'
import { timeRange } from '../lib/time'
import { useT } from '../lib/i18n'
import type { ShiftRequirement } from '../types'

const WIDTH = 250

/** Edit how many people the slots of a store/day need — for holidays and one-off changes.
 * Pages through that day's requirements. */
export function SlotEditor({
  anchorRect,
  requirements,
  storeName,
  onSave,
  onClose,
}: {
  anchorRect: DOMRect
  requirements: ShiftRequirement[]
  storeName: string
  onSave: (requirementId: number, patch: { regularRequired: number; needOpen: boolean }) => void
  onClose: () => void
}) {
  const t = useT()
  const [idx, setIdx] = useState(0)
  const r = requirements[idx]!
  const fixed = r.managerRequired + r.seniorRequired + r.newRequired // tier minimums we keep
  const currentHead = fixed + r.regularRequired

  const [head, setHead] = useState(currentHead)
  const [needOpen, setNeedOpen] = useState(r.needOpen)

  // reset the editable state when paging to a different slot
  const [shownIdx, setShownIdx] = useState(0)
  if (shownIdx !== idx) {
    setShownIdx(idx)
    setHead(currentHead)
    setNeedOpen(r.needOpen)
  }

  const dirty = head !== currentHead || needOpen !== r.needOpen
  const left = Math.min(Math.max(anchorRect.left, 8), window.innerWidth - WIDTH - 8)
  const top = Math.max(8, Math.min(anchorRect.bottom + 8, window.innerHeight - 8 - 220))

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex flex-col gap-3 rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[4px_4px_0_var(--color-ink)]"
        style={{ top, left, width: WIDTH }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-heading text-sm font-bold text-ink">
            {storeName} · {r.day[0] + r.day.slice(1).toLowerCase()}
          </span>
          {requirements.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIdx((v) => (v - 1 + requirements.length) % requirements.length)}
                className="font-heading text-xs font-bold text-muted-ink"
              >
                ◂
              </button>
              <span className="font-body text-[10px] font-bold text-muted-ink">
                {idx + 1}/{requirements.length}
              </span>
              <button
                onClick={() => setIdx((v) => (v + 1) % requirements.length)}
                className="font-heading text-xs font-bold text-muted-ink"
              >
                ▸
              </button>
            </div>
          )}
        </div>

        <span className="font-body text-[11px] font-semibold text-muted-ink">{timeRange(r.start, r.end)}</span>

        <div className="flex items-center gap-2">
          <span className="font-body text-[11px] font-bold text-muted-ink">
            {t('schedule.slot.peopleNeeded')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setHead((h) => Math.max(fixed || 1, h - 1))}
              className="h-6 w-6 rounded-full border-2 border-ink font-heading text-sm font-bold text-ink"
            >
              −
            </button>
            <span className="w-4 text-center font-heading text-sm font-bold text-ink">{head}</span>
            <button
              onClick={() => setHead((h) => Math.min(12, h + 1))}
              className="h-6 w-6 rounded-full border-2 border-ink font-heading text-sm font-bold text-ink"
            >
              +
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 font-body text-[11px] font-bold text-muted-ink">
          <input type="checkbox" checked={needOpen} onChange={(e) => setNeedOpen(e.target.checked)} />
          {t('schedule.slot.needOpenLabel')}
        </label>

        <button
          disabled={!dirty}
          onClick={() => onSave(r.id, { regularRequired: Math.max(0, head - fixed), needOpen })}
          className="self-end rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-[11px] font-bold text-white disabled:opacity-40"
        >
          {t('common.save')}
        </button>
      </div>
    </>
  )
}

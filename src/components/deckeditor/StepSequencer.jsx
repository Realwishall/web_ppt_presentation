import { useRef, useState } from 'react'
import { ChevronUp, ChevronDown, GripVertical, ListOrdered, Plus, Minus, Group, Eye } from 'lucide-react'
import { PanelSection, Btn, IconBtn, Hint, Empty } from './ui'

/**
 * The animation sequencer for the slide on the board.
 *
 * The presenter reveals `.step` elements in DOM order and counts one press per
 * step, so this panel is a direct view of that order — no parallel model, no
 * step index attribute to drift out of sync with the markup.
 *
 * The honest consequence, surfaced in the UI rather than hidden: re-ordering a
 * step moves the element in the document, which normally moves it on the slide
 * too. When the steps share a flex or grid parent the runtime can pin the
 * visual order back with CSS `order`, and the toggle below says so.
 */
export default function StepSequencer({
  steps, stepParentIsFlex, reveal, selectionCount, selectionAllSteps,
  onMove, onPick, onAddStep, onRemoveStep, onGroup, onReveal,
}) {
  const [dragFrom, setDragFrom] = useState(null)
  const [dropAt, setDropAt] = useState(null)
  const [preserve, setPreserve] = useState(true)
  const pressRef = useRef(null)

  function commitDrop() {
    if (dragFrom === null || dropAt === null) return
    let to = dropAt.i
    if (dropAt.edge === 'bottom') to += 1
    if (dragFrom < to) to -= 1
    if (to !== dragFrom) onMove(dragFrom, to, preserve)
  }

  return (
    <PanelSection
      icon={ListOrdered}
      title={`Animation steps · ${steps.length}`}
      right={
        <span className="text-[10px] font-medium text-slate-500">
          {reveal < 0 ? 'all shown' : `${reveal} shown`}
        </span>
      }
    >
      {/* Step scrubber — walk the reveal exactly as the clicker will. */}
      {steps.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <input
            type="range"
            min={0}
            max={steps.length}
            value={reveal < 0 ? steps.length : reveal}
            onChange={(e) => onReveal(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-indigo-500"
            title="Preview the reveal, press by press"
          />
          <button
            type="button"
            onClick={() => onReveal(-1)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-white/10 hover:text-slate-200"
          >
            All
          </button>
        </div>
      )}

      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <Btn onClick={onAddStep} disabled={!selectionCount || selectionAllSteps}>
          <Plus className="h-3.5 w-3.5" /> New step
        </Btn>
        <Btn onClick={onRemoveStep} disabled={!selectionCount || !selectionAllSteps}>
          <Minus className="h-3.5 w-3.5" /> Un-step
        </Btn>
        <Btn onClick={onGroup} disabled={selectionCount < 2} wide>
          <Group className="h-3.5 w-3.5" /> Group {selectionCount > 1 ? selectionCount : ''} into one press
        </Btn>
      </div>

      {steps.length === 0 ? (
        <Empty>
          No steps on this slide — it reveals all at once.
          <br />Select something on the board and press <b>New step</b>.
        </Empty>
      ) : (
        <ol className="space-y-1">
          {steps.map((s, i) => (
            <li
              key={s.uid}
              draggable
              onPointerDown={(e) => { pressRef.current = e.target }}
              onDragStart={(e) => {
                if (pressRef.current?.closest?.('button')) { e.preventDefault(); return }
                setDragFrom(i)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => { setDragFrom(null); setDropAt(null) }}
              onDragOver={(e) => {
                if (dragFrom === null) return
                e.preventDefault()
                const box = e.currentTarget.getBoundingClientRect()
                const edge = e.clientY < box.top + box.height / 2 ? 'top' : 'bottom'
                setDropAt((v) => (v?.i === i && v.edge === edge ? v : { i, edge }))
              }}
              onDrop={(e) => { if (dragFrom === null) return; e.preventDefault(); commitDrop(); setDropAt(null) }}
              className={`relative flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition ${
                s.selected
                  ? 'border-indigo-400 bg-indigo-500/15'
                  : 'border-white/8 bg-white/4 hover:border-indigo-400/35'
              } ${dragFrom === i ? 'opacity-40' : ''}`}
            >
              {dragFrom !== null && dragFrom !== i && dropAt?.i === i && (
                <span
                  className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-indigo-400 ${
                    dropAt.edge === 'top' ? '-top-1' : '-bottom-1'
                  }`}
                />
              )}
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-600 active:cursor-grabbing" />
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={(e) => onPick(s.uid, e.shiftKey || e.ctrlKey || e.metaKey)}
                className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-300 hover:text-slate-100"
                title={s.text}
              >
                <span className="mr-1 font-mono text-[10px] text-slate-600">{s.tag}</span>
                {s.text}
              </button>
              <span className="flex shrink-0 flex-col">
                <IconBtn title="Reveal earlier" disabled={i === 0} onClick={() => onMove(i, i - 1, preserve)}>
                  <ChevronUp className="h-3 w-3" />
                </IconBtn>
                <IconBtn title="Reveal later" disabled={i === steps.length - 1} onClick={() => onMove(i, i + 1, preserve)}>
                  <ChevronDown className="h-3 w-3" />
                </IconBtn>
              </span>
            </li>
          ))}
        </ol>
      )}

      {steps.length > 1 && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={preserve}
            onChange={(e) => setPreserve(e.target.checked)}
            className="mt-0.5 accent-indigo-500"
          />
          <span>
            Keep the slide layout when reordering
            {stepParentIsFlex
              ? <span className="text-emerald-400"> — available on this slide</span>
              : <span className="text-amber-400/90"> — not available here; these steps are not flex/grid siblings, so reordering also moves them on the slide</span>}
          </span>
        </label>
      )}

      <Hint>
        Reveal order is document order — that is how the presenter counts presses.
        A step may not sit inside another step.
      </Hint>
    </PanelSection>
  )
}

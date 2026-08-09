import { useEffect, useState } from 'react'
import {
  Type, Trash2, MousePointerSquareDashed, Target, Gauge, Wand2,
  AlignVerticalSpaceAround, MoveHorizontal, ChevronsUpDown, Layers,
} from 'lucide-react'
import { PanelSection, Btn, Hint, Empty } from './ui'

const UNITS = [
  { id: 'vmin', label: 'vmin', hint: 'follows the board — what the authoring contract asks for' },
  { id: 'px', label: 'px', hint: 'fixed pixels; the slide stops scaling with the screen' },
  { id: 'em', label: 'em', hint: 'relative to the parent element' },
]

const STEP_FACTORS = [
  { label: '−10%', f: 0.9 },
  { label: '−5%', f: 0.95 },
  { label: '+5%', f: 1.05 },
  { label: '+10%', f: 1.1 },
]

/**
 * Right-hand control panel: what a selection is, and every edit that can be
 * made to it.
 *
 * The scope selector is the load-bearing control. A deck repeats one class
 * dozens of times, so "make this bigger" is nearly always meant as "make every
 * one of these bigger" — but the two must never be confused, so the scope is
 * an explicit, always-visible choice, and the board dot-outlines the blast
 * radius in pink before anything is pressed.
 */
export default function Inspector({
  state, scope, setScope, matchSize, setMatchSize, unit, setUnit,
  onFontScale, onFontSet, onSpace, onDelete, onSelectSimilar, onSelectAll, onAutoFit,
}) {
  const sel = state.selection || []
  const one = sel.length === 1 ? sel[0] : null
  const [exact, setExact] = useState('')

  useEffect(() => {
    if (!one) { setExact(''); return }
    setExact(String(unit === 'px' ? one.fontPx : unit === 'vmin' ? one.fontVmin : ''))
  }, [one, unit])

  const scopeCount =
    scope === 'element' ? sel.length
      : scope === 'page' ? state.similarOnPage || 0
        : scope === 'deck' ? state.similarInDeck || 0
          : sel.length

  const fit = state.fitZoom ?? 1
  const shrunk = fit < 0.995

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* ── what is selected ─────────────────────────────────────────────── */}
      <PanelSection icon={MousePointerSquareDashed} title={`Selection · ${sel.length}`}>
        {sel.length === 0 ? (
          <Empty>
            Click an element on the slide.<br />
            Shift-click to add · drag empty space to lasso · double-click to edit text.
          </Empty>
        ) : (
          <>
            <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto">
              {sel.slice(0, 8).map((s) => (
                <li key={s.uid} className="flex items-baseline gap-1.5 truncate rounded bg-white/4 px-2 py-1 text-[11px]">
                  <span className="font-mono text-[10px] text-indigo-400">{s.tag}</span>
                  {s.classes.slice(0, 2).map((c) => (
                    <span key={c} className="font-mono text-[10px] text-slate-500">.{c}</span>
                  ))}
                  {s.isStep && <span className="rounded-full bg-violet-600 px-1 text-[9px] font-bold text-white">step</span>}
                  <span className="min-w-0 flex-1 truncate text-slate-400">{s.text}</span>
                </li>
              ))}
              {sel.length > 8 && <li className="px-2 text-[10px] text-slate-500">+{sel.length - 8} more</li>}
            </ul>
            <div className="grid grid-cols-2 gap-1.5">
              <Btn onClick={() => onSelectSimilar('page')} disabled={!one}>
                <Target className="h-3.5 w-3.5" /> Similar ({state.similarOnPage || 0})
              </Btn>
              <Btn onClick={onSelectAll}>
                <Layers className="h-3.5 w-3.5" /> All text
              </Btn>
            </div>
          </>
        )}
      </PanelSection>

      {/* ── scope ────────────────────────────────────────────────────────── */}
      <PanelSection icon={Target} title="Apply changes to">
        <div className="grid gap-1">
          <ScopeRow id="element" scope={scope} setScope={setScope}
            label={sel.length > 1 ? `These ${sel.length} elements` : 'This element only'}
            count={sel.length} />
          <ScopeRow id="page" scope={scope} setScope={setScope}
            label="All similar on this slide" count={state.similarOnPage || 0} disabled={!one} />
          <ScopeRow id="deck" scope={scope} setScope={setScope}
            label="All similar in the whole deck" count={state.similarInDeck || 0} disabled={!one} />
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
          <input type="checkbox" checked={matchSize} onChange={(e) => setMatchSize(e.target.checked)}
            className="accent-indigo-500" />
          Similar must also match the current font size
        </label>
        <Hint>
          “Similar” means the same tag and the same classes — the thing your deck’s CSS
          keys off. Matching elements are dot-outlined in pink on the board.
        </Hint>
      </PanelSection>

      {/* ── typography ───────────────────────────────────────────────────── */}
      <PanelSection
        icon={Type}
        title="Typography"
        right={<UnitPicker unit={unit} setUnit={setUnit} />}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <button type="button" disabled={!sel.length} onClick={() => onFontScale(0.9)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm font-bold text-slate-300 transition hover:border-indigo-400/40 hover:text-white disabled:opacity-35">
            A<span className="text-[9px]">−</span>
          </button>
          <div className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-center">
            {one ? (
              <>
                <div className="text-sm font-semibold text-slate-100">{one.fontVmin} vmin</div>
                <div className="text-[10px] text-slate-500">
                  {one.fontPx}px on a {state.board?.w}×{state.board?.h} board
                </div>
              </>
            ) : (
              <div className="py-1 text-[11px] text-slate-500">{sel.length ? 'mixed' : '—'}</div>
            )}
          </div>
          <button type="button" disabled={!sel.length} onClick={() => onFontScale(1.1)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-lg font-bold text-slate-300 transition hover:border-indigo-400/40 hover:text-white disabled:opacity-35">
            A<span className="text-[9px]">+</span>
          </button>
        </div>

        <div className="mb-2 grid grid-cols-4 gap-1">
          {STEP_FACTORS.map((s) => (
            <Btn key={s.label} disabled={!sel.length} onClick={() => onFontScale(s.f)}>{s.label}</Btn>
          ))}
        </div>

        {unit !== 'em' && (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              const v = parseFloat(exact)
              if (isFinite(v) && v > 0) onFontSet(v)
            }}
          >
            <input
              value={exact}
              onChange={(e) => setExact(e.target.value)}
              disabled={!sel.length}
              inputMode="decimal"
              placeholder="exact"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-indigo-400 disabled:opacity-40"
            />
            <Btn type="submit" disabled={!sel.length}>Set {unit}</Btn>
          </form>
        )}

        <Hint>
          Sizes are read back out of the live board and rewritten in {unit}, so a
          <code className="mx-1 rounded bg-black/40 px-1 font-mono text-[10px]">clamp()</code>
          you never wrote by hand still bumps correctly.
          {scopeCount > 1 && (
            <b className="text-indigo-300"> This will change {scopeCount} elements.</b>
          )}
        </Hint>
      </PanelSection>

      {/* ── spacing ──────────────────────────────────────────────────────── */}
      <PanelSection icon={AlignVerticalSpaceAround} title="Spacing">
        <div className="grid grid-cols-2 gap-1.5">
          <Nudge label="Line height" icon={ChevronsUpDown} disabled={!sel.length}
            onDown={() => onSpace('lineHeight', -1)} onUp={() => onSpace('lineHeight', 1)} />
          <Nudge label="Letter space" icon={MoveHorizontal} disabled={!sel.length}
            onDown={() => onSpace('letterSpacing', -1)} onUp={() => onSpace('letterSpacing', 1)} />
          <Nudge label="Gap below" icon={AlignVerticalSpaceAround} disabled={!sel.length}
            onDown={() => onSpace('margin', -1)} onUp={() => onSpace('margin', 1)} />
          <Nudge label="Padding" icon={AlignVerticalSpaceAround} disabled={!sel.length}
            onDown={() => onSpace('padding', -1)} onUp={() => onSpace('padding', 1)} />
        </div>
        <Hint>Written in em, so they keep tracking the font size you just set.</Hint>
      </PanelSection>

      {/* ── fit meter ────────────────────────────────────────────────────── */}
      <PanelSection icon={Gauge} title="Fit on the board">
        <div className={`rounded-lg border px-3 py-2 ${
          shrunk ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/25 bg-emerald-500/8'
        }`}>
          <div className="flex items-baseline justify-between">
            <span className={`text-lg font-bold ${shrunk ? 'text-amber-300' : 'text-emerald-300'}`}>
              {Math.round(fit * 100)}%
            </span>
            <span className="text-[10px] text-slate-400">
              {shrunk ? 'auto-shrunk to fit' : 'renders at authored size'}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {shrunk
              ? `This slide overflows, so the presenter squeezes it to ${Math.round(fit * 100)}%. Every size you read above is what you authored — on the board it lands ${Math.round(fit * 100)}% of that.`
              : 'Nothing is being squeezed. What you see is exactly what the class sees.'}
          </p>
        </div>
        <Btn wide disabled={!shrunk} onClick={onAutoFit} active={shrunk}>
          <Wand2 className="h-3.5 w-3.5" /> Shrink text until it fits ({Math.round(fit * 100)}% → 100%)
        </Btn>
        <Hint>
          Bakes the squeeze into the authored sizes once, on the outermost text
          elements, so nested sizes are never scaled twice.
        </Hint>
      </PanelSection>

      {/* ── destructive ──────────────────────────────────────────────────── */}
      <PanelSection icon={Trash2} title="Element">
        <Btn wide danger disabled={!sel.length} onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete {scopeCount > 1 ? `${scopeCount} elements` : 'this element'}
        </Btn>
        <Hint>Removed from the DOM. Ctrl+Z brings it straight back.</Hint>
      </PanelSection>
    </div>
  )
}

function ScopeRow({ id, scope, setScope, label, count, disabled }) {
  const on = scope === id
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setScope(id)}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition disabled:opacity-30 ${
        on ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100' : 'border-white/8 bg-white/4 text-slate-400 hover:border-indigo-400/35'
      }`}
    >
      <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
        on ? 'border-indigo-300 bg-indigo-400' : 'border-slate-600'
      }`}>
        {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{count}</span>
    </button>
  )
}

function UnitPicker({ unit, setUnit }) {
  return (
    <span className="flex rounded-md border border-white/10 bg-black/25 p-0.5">
      {UNITS.map((u) => (
        <button
          key={u.id}
          type="button"
          title={u.hint}
          onClick={() => setUnit(u.id)}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
            unit === u.id ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {u.label}
        </button>
      ))}
    </span>
  )
}

function Nudge({ label, icon: Icon, onUp, onDown, disabled }) {
  return (
    <div className={`rounded-lg border border-white/8 bg-white/4 p-1.5 ${disabled ? 'opacity-35' : ''}`}>
      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-slate-400">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="flex gap-1">
        <button type="button" disabled={disabled} onClick={onDown}
          className="flex-1 rounded bg-black/30 py-0.5 text-xs font-bold text-slate-300 transition hover:bg-black/50 hover:text-white disabled:cursor-not-allowed">−</button>
        <button type="button" disabled={disabled} onClick={onUp}
          className="flex-1 rounded bg-black/30 py-0.5 text-xs font-bold text-slate-300 transition hover:bg-black/50 hover:text-white disabled:cursor-not-allowed">+</button>
      </div>
    </div>
  )
}

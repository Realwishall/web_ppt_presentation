import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  X, Save, Loader2, Undo2, Redo2, MonitorPlay, Presentation, Type as TypeIcon,
  MousePointer2, ChevronLeft, ChevronRight, Maximize2, AlertTriangle,
} from 'lucide-react'
import { readFolderHtml, updateFolder, makeId } from '../lib/content'
import { ASPECTS, boardSize, fitScale, buildEditorSrcdoc, countPages } from '../lib/deckEditFrame'
import StepSequencer from '../components/deckeditor/StepSequencer'
import Inspector from '../components/deckeditor/Inspector'
import { Btn } from '../components/deckeditor/ui'

const EMPTY_STATE = {
  index: 0, mode: 'select', selection: [], steps: [],
  similarOnPage: 0, similarInDeck: 0, stepParentIsFlex: false,
  reveal: -1, fitZoom: 1, overflow: 0, canUndo: false, canRedo: false, board: {},
}

/**
 * IN-PRESENTATION EDITOR
 *
 * Opened from the Content Library. The middle of the screen is the deck, laid
 * out at true board pixels and CSS-scaled down (see `deckEditFrame.js` for why
 * that distinction is the whole feature). The two side rails are editing
 * controls only — no pen, no laser, no board tools; those belong to /teach.
 *
 * Saving goes through `updateFolder`, which mints a NEW immutable content
 * version. A lecture recorded against the old version still replays over the
 * slides its ink was drawn on.
 */
export default function DeckEditorView() {
  const navigate = useNavigate()
  const location = useLocation()
  const folder = location.state?.folder || null

  const frameRef = useRef(null)
  const stageRef = useRef(null)

  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [dirty, setDirty] = useState(false)

  const [aspect, setAspect] = useState('screen')
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [pagesMeta, setPagesMeta] = useState([])
  const [state, setState] = useState(EMPTY_STATE)
  const [toast, setToast] = useState('')

  const [scope, setScope] = useState('element')
  const [matchSize, setMatchSize] = useState(false)
  const [unit, setUnit] = useState('vmin')

  const board = useMemo(() => boardSize(aspect), [aspect])
  const scale = fitScale(board.w, board.h, box.w, box.h)

  const post = useCallback((msg) => {
    frameRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  /* ── load the deck ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!folder) { setErr('No deck was passed to the editor. Open it from the Content Library.'); setLoading(false); return }
    let alive = true
    readFolderHtml(folder)
      .then((text) => {
        if (!alive) return
        if (!text) throw new Error('This folder has no HTML yet.')
        if (!countPages(text)) throw new Error('No <section class="page"> slides found in this deck.')
        setHtml(text)
      })
      .catch((e) => { if (alive) setErr(e.message || 'Could not load this deck.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [folder])

  const srcdoc = useMemo(() => (html ? buildEditorSrcdoc(html) : ''), [html])

  /* ── keep the stage measurement honest ───────────────────────────────── */
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      setBox({ w: Math.max(0, r.width - 24), h: Math.max(0, r.height - 24) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* The frame's viewport did not change (it is always board-sized), but the
     deck may have scripts that key off resize — and the fit engine wants a
     nudge whenever the board dimensions themselves change. */
  useEffect(() => { post({ type: 'lfe-refit' }) }, [board.w, board.h, post])

  /* ── message bus ─────────────────────────────────────────────────────── */
  const docWaiters = useRef(new Map())
  // The runtime edit counter as of the last successful save, and the newest
  // one seen. Both are refs: `save` must read the value that is true *now*,
  // not the one captured when its render ran.
  const savedRevRef = useRef(0)
  const liveRevRef = useRef(0)

  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frameRef.current?.contentWindow) return
      const d = e.data || {}
      if (d.type === 'lfe-ready') {
        setPagesMeta(d.pages || [])
      } else if (d.type === 'lfe-state') {
        liveRevRef.current = d.rev || 0
        setState((prev) => ({ ...prev, ...d }))
        // Undo depth is the wrong dirty signal: undoing back to the start is
        // still a change if a save happened in between. The runtime's
        // monotonic edit counter is.
        setDirty((d.rev || 0) !== savedRevRef.current)
        // Keep the slide rail's step badges honest as steps are added/removed.
        setPagesMeta((prev) => (
          prev.length && prev[d.index] && prev[d.index].stepCount !== (d.steps || []).length
            ? prev.map((p, i) => (i === d.index ? { ...p, stepCount: (d.steps || []).length } : p))
            : prev
        ))
        if (d.note) setToast(d.note)
      } else if (d.type === 'lfe-doc') {
        const w = docWaiters.current.get(d.requestId)
        if (w) { docWaiters.current.delete(d.requestId); w(d.html) }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(''), 4200)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!savedNote) return undefined
    const t = setTimeout(() => setSavedNote(''), 3500)
    return () => clearTimeout(t)
  }, [savedNote])

  /* Keep the runtime's idea of "similar" in step with the checkbox. */
  useEffect(() => { post({ type: 'lfe-match-size', on: matchSize }) }, [matchSize, post])

  /* Leaving with unsaved edits should cost a click, not a lecture. */
  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  /* Undo/redo also has to work when focus sits out here on a sidebar button. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.matches?.('input,textarea,[contenteditable="true"]')) return
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        post({ type: e.shiftKey ? 'lfe-redo' : 'lfe-undo' })
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      } else if (!meta && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const next = state.index + (e.key === 'ArrowRight' ? 1 : -1)
        if (next >= 0 && next < pagesMeta.length) post({ type: 'lfe-show', index: next })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, state.index, pagesMeta.length])

  /* ── save ────────────────────────────────────────────────────────────── */
  const requestDoc = useCallback(() => new Promise((resolve) => {
    const requestId = makeId('doc')
    docWaiters.current.set(requestId, resolve)
    setTimeout(() => {
      if (docWaiters.current.has(requestId)) { docWaiters.current.delete(requestId); resolve(null) }
    }, 8000)
    post({ type: 'lfe-doc', requestId })
  }), [post])

  async function save() {
    if (saving || !folder) return
    setSaving(true); setErr('')
    try {
      const doc = await requestDoc()
      if (!doc) throw new Error('The slide frame did not answer — nothing was saved.')
      if (!countPages(doc)) throw new Error('The edited document has no slides left — refusing to save it.')
      await updateFolder(folder.classId, folder.chapterId, folder.id, { html: doc })
      // NOTE: `html` is deliberately NOT re-set here. Assigning a new srcdoc
      // would reload the iframe, throwing away the undo stack and the current
      // slide — a save must never feel like starting over.
      savedRevRef.current = liveRevRef.current
      setDirty(false)
      setSavedNote(`Saved as v${(folder.version || 1) + 1}.`)
    } catch (e) {
      setErr(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function close() {
    if (dirty && !confirm('You have unsaved edits. Leave the editor and discard them?')) return
    navigate('/', { replace: true })
  }

  /* ── command helpers ─────────────────────────────────────────────────── */
  const cmd = {
    fontScale: (f) => post({ type: 'lfe-font', op: 'scale', value: f, unit, scope }),
    fontSet: (v) => post({ type: 'lfe-font', op: 'set', value: v, unit, scope }),
    space: (prop, delta) => post({ type: 'lfe-space', prop, delta, scope }),
    del: () => post({ type: 'lfe-delete', scope }),
    selectSimilar: (s) => post({ type: 'lfe-select-similar', scope: s }),
    selectAll: () => post({ type: 'lfe-select-all' }),
    autoFit: () => post({ type: 'lfe-autofit', unit }),
    addStep: () => post({ type: 'lfe-step-set', on: true, scope }),
    removeStep: () => post({ type: 'lfe-step-set', on: false, scope }),
    group: () => post({ type: 'lfe-step-group' }),
    moveStep: (from, to, preserveLayout) => post({ type: 'lfe-step-move', from, to, preserveLayout }),
    pick: (uid, additive) => post({ type: 'lfe-pick', uid, additive }),
    reveal: (count) => post({ type: 'lfe-reveal', count }),
  }

  const selectionAllSteps = state.selection.length > 0 && state.selection.every((s) => s.isStep)

  /* ── render ──────────────────────────────────────────────────────────── */
  if (err && !html) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[#0b0f19] p-6 text-center">
        <div className="max-w-md">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          <p className="mb-4 text-sm text-slate-300">{err}</p>
          <Btn onClick={() => navigate('/', { replace: true })}>Back to the library</Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0f19] text-slate-200">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/8 px-3 py-2">
        <Presentation className="h-4 w-4 shrink-0 text-indigo-400" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{folder?.name || 'Deck'}</div>
          <div className="font-mono text-[10px] text-slate-500">
            {folder?.code}<span className="text-slate-600"> ·v{folder?.version || 1}</span>
            {dirty && <span className="ml-1.5 text-amber-400">· saving creates v{(folder?.version || 1) + 1}</span>}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/25 px-2 py-1">
            <MonitorPlay className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              title="Match the board this deck is taught on"
              className="bg-transparent text-[11px] font-semibold text-slate-200 outline-none [&>option]:bg-slate-900"
            >
              {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <span className="font-mono text-[10px] text-slate-500">{board.w}×{board.h}</span>
          </label>

          <span className="flex rounded-lg border border-white/10 bg-black/25 p-0.5">
            <ModeBtn on={state.mode === 'select'} icon={MousePointer2} label="Select"
              onClick={() => post({ type: 'lfe-mode', mode: 'select' })} />
            <ModeBtn on={state.mode === 'text'} icon={TypeIcon} label="Text"
              onClick={() => post({ type: 'lfe-mode', mode: 'text' })} />
          </span>

          <span className="flex rounded-lg border border-white/10 bg-black/25 p-0.5">
            <IconTool title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => post({ type: 'lfe-undo' })}>
              <Undo2 className="h-4 w-4" />
            </IconTool>
            <IconTool title="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => post({ type: 'lfe-redo' })}>
              <Redo2 className="h-4 w-4" />
            </IconTool>
          </span>

          <button type="button" onClick={save} disabled={saving || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save version
          </button>
          <button type="button" onClick={close}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {err && html && (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/10 px-4 py-1.5 text-xs text-red-300">{err}</div>
      )}

      {/* ── body ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: slides + animation sequencing */}
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-white/8 bg-black/20">
          <SlideRail
            pages={pagesMeta}
            index={state.index}
            onPick={(i) => post({ type: 'lfe-show', index: i })}
          />
          <StepSequencer
            steps={state.steps}
            stepParentIsFlex={state.stepParentIsFlex}
            reveal={state.reveal}
            selectionCount={state.selection.length}
            selectionAllSteps={selectionAllSteps}
            onMove={cmd.moveStep}
            onPick={cmd.pick}
            onAddStep={cmd.addStep}
            onRemoveStep={cmd.removeStep}
            onGroup={cmd.group}
            onReveal={cmd.reveal}
          />
        </aside>

        {/* CENTRE: the slide, at presentation proportions */}
        <main ref={stageRef} className="relative grid min-w-0 flex-1 place-items-center overflow-hidden bg-[#05070d] p-3">
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {srcdoc && box.w > 0 && (
            <div
              className="relative overflow-hidden rounded-lg border border-white/10 shadow-2xl shadow-black/60"
              style={{ width: Math.round(board.w * scale), height: Math.round(board.h * scale) }}
            >
              <iframe
                ref={frameRef}
                title="Deck editor canvas"
                sandbox="allow-scripts"
                scrolling="no"
                srcDoc={srcdoc}
                style={{
                  width: board.w,
                  height: board.h,
                  border: 0,
                  transformOrigin: '0 0',
                  transform: `scale(${scale})`,
                }}
              />
            </div>
          )}

          {/* footer strip: page nav + the scale we are viewing at */}
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex items-center justify-center gap-2">
            <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-black/70 px-1.5 py-1 backdrop-blur">
              <IconTool title="Previous slide" disabled={state.index <= 0}
                onClick={() => post({ type: 'lfe-show', index: state.index - 1 })}>
                <ChevronLeft className="h-4 w-4" />
              </IconTool>
              <span className="px-1 text-[11px] font-semibold tabular-nums text-slate-300">
                {pagesMeta.length ? state.index + 1 : 0} / {pagesMeta.length}
              </span>
              <IconTool title="Next slide" disabled={state.index >= pagesMeta.length - 1}
                onClick={() => post({ type: 'lfe-show', index: state.index + 1 })}>
                <ChevronRight className="h-4 w-4" />
              </IconTool>
              <span className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2 text-[10px] text-slate-500">
                <Maximize2 className="h-3 w-3" /> viewing at {Math.round(scale * 100)}%
              </span>
            </div>
          </div>

          {(toast || savedNote) && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-xl border border-violet-400/30 bg-violet-950/90 px-3 py-1.5 text-xs text-violet-100 shadow-lg">
              {savedNote || toast}
            </div>
          )}
        </main>

        {/* RIGHT: the inspector */}
        <aside className="w-72 shrink-0 border-l border-white/8 bg-black/20">
          <Inspector
            state={state}
            scope={scope} setScope={setScope}
            matchSize={matchSize} setMatchSize={setMatchSize}
            unit={unit} setUnit={setUnit}
            onFontScale={cmd.fontScale}
            onFontSet={cmd.fontSet}
            onSpace={cmd.space}
            onDelete={cmd.del}
            onSelectSimilar={cmd.selectSimilar}
            onSelectAll={cmd.selectAll}
            onAutoFit={cmd.autoFit}
          />
        </aside>
      </div>
    </div>
  )
}

/* ── slide rail ────────────────────────────────────────────────────────── */
function SlideRail({ pages, index, onPick }) {
  return (
    <section className="border-b border-white/8 px-3 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Slides · {pages.length}
      </div>
      <ol className="space-y-1">
        {pages.map((p) => (
          <li key={p.index}>
            <button
              type="button"
              onClick={() => onPick(p.index)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                p.index === index
                  ? 'border-indigo-400 bg-indigo-500/15'
                  : 'border-white/8 bg-white/4 hover:border-indigo-400/35'
              }`}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-black/40 text-[10px] font-bold text-slate-400">
                {p.index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{p.title}</span>
              {p.stepCount > 0 && (
                <span className="shrink-0 rounded-full bg-violet-600/80 px-1.5 text-[9px] font-bold text-white">
                  {p.stepCount}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ModeBtn({ on, icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} title={`${label} mode`}
      className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition ${
        on ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

function IconTool({ children, title, disabled, onClick }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className="rounded p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-25 disabled:hover:bg-transparent">
      {children}
    </button>
  )
}

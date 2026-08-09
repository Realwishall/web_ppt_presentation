import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  X, Loader2, ChevronLeft, ChevronRight, Maximize2, Minimize2, AlertTriangle,
  NotebookPen, Copy, Check, Download, Trash2, PanelRightOpen, PanelRightClose,
  Eye, EyeOff, CornerDownLeft, MonitorPlay,
} from 'lucide-react'
import { readFolderHtml } from '../lib/content'
import { ASPECTS, boardSize, fitScale, countPages } from '../lib/deckEditFrame'
import {
  buildNotesSrcdoc, parsePages, deckNoteKey, makeNoteId,
  loadDeckNotes, saveDeckNotes, clearDeckNotes,
  formatNotesForAI, notesFileName,
} from '../lib/deckNotes'

/**
 * NOTES MODE  (/notes — the content panel's "Record Text" button)
 *
 * The deck runs exactly as it will be taught — same board pixels, same
 * auto-fit, same one-press-one-idea step reveal — with a note box pinned to
 * the bottom of the screen and a slide number stamped onto every line.
 *
 * Three decisions carry the whole screen:
 *
 * 1. THE DRAFT REMEMBERS WHERE IT WAS BORN. The slide number is captured on
 *    the FIRST keystroke of a note, not when it is committed. You type half a
 *    thought, press Next, finish the thought — it still files under the slide
 *    you were looking at when you started. Turning the page with text in the
 *    box commits it there and hands you an empty box for the new slide, which
 *    is what "type while you click through" actually means in practice.
 *
 * 2. ←/→ ALWAYS DRIVE THE DECK, even mid-word in the note box. That is the
 *    teacher's explicit call: navigating must never require reaching for the
 *    mouse. The cost is that arrows no longer move the caret inside the box —
 *    Home/End and clicking still do, and Ctrl+←/→ skips a whole slide.
 *    Everything else about typing is untouched: space is a space, ↑/↓ move
 *    between the box's own lines, Enter files the note.
 *
 * 3. THE DECK NEVER SWALLOWS A KEYSTROKE. The slide is a cross-origin sandbox,
 *    so a key pressed after clicking the slide would otherwise vanish. The
 *    runtime forwards every keydown out here, and a printable character is
 *    re-aimed at the note box — so you can click a figure, keep typing, and
 *    the words land where you expect.
 *
 * Notes are stored in this browser under the deck's content code and exported
 * as slide-numbered markdown, ready to paste into another prompt.
 */
export default function NotesRecorderView() {
  const navigate = useNavigate()
  const location = useLocation()
  const folder = location.state?.folder || null

  const frameRef = useRef(null)
  const stageRef = useRef(null)
  const wrapRef = useRef(null)
  const boxRef = useRef(null)

  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [aspect, setAspect] = useState('screen')
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [pages, setPages] = useState([])
  const [index, setIndex] = useState(0)   // 0-based slide
  const [step, setStep] = useState(0)
  const [stepCount, setStepCount] = useState(0)
  const [full, setFull] = useState(false)

  const [notes, setNotes] = useState([])
  const [draft, setDraft] = useState('')
  const [draftSlide, setDraftSlide] = useState(null) // 1-based, frozen at first keystroke
  const [listOpen, setListOpen] = useState(false)
  const [barHidden, setBarHidden] = useState(false)
  const [copied, setCopied] = useState('')
  const [toast, setToast] = useState('')

  const noteKey = useMemo(() => deckNoteKey(folder), [folder])
  const board = useMemo(() => boardSize(aspect), [aspect])
  const scale = fitScale(board.w, board.h, box.w, box.h)

  const post = useCallback((msg) => {
    frameRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  /* ── load the deck ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!folder) {
      setErr('No deck was passed to notes mode. Open it from the Content Library.')
      setLoading(false)
      return undefined
    }
    let alive = true
    readFolderHtml(folder)
      .then((text) => {
        if (!alive) return
        if (!text) throw new Error('This folder has no HTML yet.')
        if (!countPages(text)) throw new Error('No <section class="page"> slides found in this deck.')
        setHtml(text)
        setPages(parsePages(text))   // titles now; the frame refines them on ready
      })
      .catch((e) => { if (alive) setErr(e.message || 'Could not load this deck.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [folder])

  const srcdoc = useMemo(() => (html ? buildNotesSrcdoc(html) : ''), [html])

  /* ── restore what was written last time ──────────────────────────────── */
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current || !folder) return
    hydrated.current = true
    const saved = loadDeckNotes(noteKey)
    if (saved.notes.length) setNotes(saved.notes)
    if (saved.draft?.text) {
      setDraft(saved.draft.text)
      setDraftSlide(saved.draft.slide || null)
    }
  }, [folder, noteKey])

  /* Persist on every change, a beat behind the keystroke. A browser crash
     mid-lecture then costs nothing, and the write does not run once per
     character typed. */
  useEffect(() => {
    if (!hydrated.current) return undefined
    const t = setTimeout(() => {
      const ok = saveDeckNotes(noteKey, {
        notes,
        draft: draft.trim() ? { text: draft, slide: draftSlide } : null,
        meta: {
          name: folder?.name || null,
          code: folder?.code || null,
          version: folder?.version || null,
          slideCount: pages.length,
        },
      })
      if (!ok) setToast('Notes could not be saved in this browser — copy them out before you close the tab.')
    }, 250)
    return () => clearTimeout(t)
  }, [notes, draft, draftSlide, noteKey, folder, pages.length])

  /* ── stage measurement ───────────────────────────────────────────────── */
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      setBox({ w: Math.max(0, r.width - 16), h: Math.max(0, r.height - 16) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { post({ type: 'lfn-refit' }) }, [board.w, board.h, post])

  /* ── committing a note ───────────────────────────────────────────────── */

  /**
   * File the draft under the slide it was started on and clear the box.
   * `slideOverride` exists for the page-turn path, which knows the slide the
   * text belongs to even if the first keystroke somehow never registered.
   */
  const commitDraft = useCallback((slideOverride) => {
    const text = draft.trim()
    if (!text) { setDraft(''); setDraftSlide(null); return false }
    const slide = slideOverride || draftSlide || index + 1
    setNotes((prev) => [...prev, {
      id: makeNoteId(),
      slide,
      title: pages[slide - 1]?.title || '',
      text,
      at: Date.now(),
    }])
    setDraft('')
    setDraftSlide(null)
    return true
  }, [draft, draftSlide, index, pages])

  // Keep the committer reachable from the key handler without re-binding the
  // listener on every keystroke.
  const commitRef = useRef(commitDraft)
  useEffect(() => { commitRef.current = commitDraft }, [commitDraft])

  const goRef = useRef({ index: 0, step: 0, count: 0 })
  useEffect(() => { goRef.current = { index, step, count: pages.length } }, [index, step, pages.length])

  /* ── navigation ──────────────────────────────────────────────────────── */

  /* Any move off the current slide first commits whatever is in the box, so a
     half-written thought is never carried onto the next page. */
  const beforeMove = useCallback(() => { commitRef.current() }, [])

  const advance = useCallback((dir) => { beforeMove(); post({ type: 'lfn-advance', dir }) }, [beforeMove, post])
  const jump = useCallback((dir) => { beforeMove(); post({ type: 'lfn-jump', dir }) }, [beforeMove, post])
  const showSlide = useCallback((i) => { beforeMove(); post({ type: 'lfn-show', index: i, step: 0 }) }, [beforeMove, post])

  /* ── frame messages ──────────────────────────────────────────────────── */
  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frameRef.current?.contentWindow) return
      const d = e.data || {}
      if (d.type === 'lfn-ready') {
        if (d.pages?.length) setPages(d.pages)
      } else if (d.type === 'lfn-state') {
        setIndex(d.index || 0)
        setStep(d.step || 0)
        setStepCount(d.stepCount || 0)
      } else if (d.type === 'lfn-key') {
        handleForwardedKey(d)
      }
    }

    /* A key pressed while the SLIDE has focus. Navigation keys drive the deck;
       a printable character is handed to the note box, which is then focused —
       so the teacher never has to notice where focus went. */
    const handleForwardedKey = (d) => {
      const { key, ctrl, shift, alt } = d
      if (navKey(key, ctrl)) { runNavKey(key, ctrl); return }
      if (key === 'Enter') {
        if (shift) { setDraft((t) => `${t}\n`); focusBox() }
        else { commitRef.current(); focusBox() }
        return
      }
      if (key === 'Backspace') { setDraft((t) => t.slice(0, -1)); focusBox(); return }
      if (key === 'Escape') { escape(); return }
      if (ctrl || alt) return
      if (key.length === 1) {
        stampSlide()
        setDraft((t) => t + key)
        focusBox()
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusBox = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    // Put the caret at the end, not wherever it was before focus moved away.
    requestAnimationFrame(() => {
      el.focus()
      const n = el.value.length
      try { el.setSelectionRange(n, n) } catch { /* ignore */ }
    })
  }, [])

  /** Freeze the slide this note belongs to at the first character typed. */
  const stampSlide = useCallback(() => {
    setDraftSlide((s) => (s == null ? goRef.current.index + 1 : s))
  }, [])

  const navKey = (key, ctrl) => (
    key === 'ArrowRight' || key === 'ArrowLeft'
    || key === 'PageDown' || key === 'PageUp'
    || key === 'ArrowDown' || key === 'ArrowUp'
    || ((key === 'Home' || key === 'End') && ctrl)
    || key === ' ' || key === 'Spacebar'
  )

  const runNavKey = useCallback((key, ctrl) => {
    switch (key) {
      case 'ArrowRight':
        // Ctrl skips the remaining steps and turns the page outright.
        if (ctrl) jump(1); else advance(1)
        break
      case 'ArrowLeft':
        if (ctrl) jump(-1); else advance(-1)
        break
      case 'PageDown': case 'ArrowDown': case ' ': case 'Spacebar':
        jump(1)
        break
      case 'PageUp': case 'ArrowUp':
        jump(-1)
        break
      case 'Home':
        showSlide(0)
        break
      case 'End':
        showSlide(Math.max(0, goRef.current.count - 1))
        break
      default:
        break
    }
  }, [advance, jump, showSlide])

  /* ── host-side keyboard ──────────────────────────────────────────────── */
  const escape = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else boxRef.current?.blur()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      const inBox = e.target === boxRef.current
      // Editing a saved note in the side panel, or using the aspect select, is
      // ordinary text editing — those fields keep every key they are given.
      const inOtherField = !inBox
        && !!e.target?.matches?.('input,select,textarea,[contenteditable="true"]')

      if (e.key === 'Escape') { e.preventDefault(); escape(); return }
      if (inOtherField) return

      // Space and the vertical arrows belong to the deck only when the note box
      // is not the thing being typed into — otherwise every space would turn a
      // page instead of separating two words.
      const boxOwnsKey = inBox
        && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'ArrowDown')

      if (!boxOwnsKey && navKey(e.key, e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        runNavKey(e.key, e.ctrlKey || e.metaKey)
        return
      }

      if (inBox && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commitRef.current()
        return
      }

      // Typing anywhere on this screen means typing a note.
      if (!inBox && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        e.preventDefault()
        stampSlide()
        setDraft((t) => t + e.key)
        focusBox()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escape, focusBox, runNavKey, stampSlide])

  /* ── full screen = presentation mode ─────────────────────────────────── */
  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else wrapRef.current?.requestFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(''), 1800)
    return () => clearTimeout(t)
  }, [copied])

  /* ── export ──────────────────────────────────────────────────────────── */

  /* The draft counts: exporting must never quietly leave out the line still
     sitting in the box. */
  const allNotes = useMemo(() => (
    draft.trim()
      ? [...notes, { id: 'draft', slide: draftSlide || index + 1, text: draft, at: Date.now() }]
      : notes
  ), [notes, draft, draftSlide, index])

  const markdown = useMemo(() => formatNotesForAI(allNotes, {
    deckName: folder?.name,
    code: folder?.code,
    version: folder?.version,
    slideCount: pages.length,
    pages,
  }), [allNotes, folder, pages])

  async function copyAll() {
    if (!markdown) { setToast('No notes to copy yet.'); return }
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied('all')
    } catch {
      // Clipboard is blocked outside a secure context / without permission —
      // fall back to a selection the teacher can press Ctrl+C on.
      const ta = document.createElement('textarea')
      ta.value = markdown
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand?.('copy')
      ta.remove()
      if (ok) setCopied('all')
      else setToast('Could not reach the clipboard — use Download instead.')
    }
  }

  function downloadMd() {
    if (!markdown) { setToast('No notes to download yet.'); return }
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${notesFileName(folder?.name)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  function removeNote(id) {
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }
  function editNote(id, text) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n)))
  }
  function clearAll() {
    if (!confirm('Delete every note taken on this deck in this browser? This cannot be undone.')) return
    setNotes([])
    setDraft('')
    setDraftSlide(null)
    clearDeckNotes(noteKey)
  }

  function close() {
    commitRef.current()
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    navigate('/', { replace: true })
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  if (err && !html) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[#0b0f19] p-6 text-center">
        <div className="max-w-md">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          <p className="mb-4 text-sm text-slate-300">{err}</p>
          <button type="button" onClick={() => navigate('/', { replace: true })}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            Back to the library
          </button>
        </div>
      </div>
    )
  }

  const slideNo = pages.length ? index + 1 : 0
  const noteCount = notes.length
  const onThisSlide = notes.filter((n) => n.slide === slideNo).length

  return (
    <div ref={wrapRef} className="fixed inset-0 z-50 flex flex-col bg-[#05070d] text-slate-200">
      {/* ── header (hidden in presentation mode) ───────────────────────── */}
      {!full && (
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/8 bg-[#0b0f19] px-3 py-2">
          <NotebookPen className="h-4 w-4 shrink-0 text-emerald-400" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100">
              {folder?.name || 'Deck'} <span className="text-slate-500">· notes</span>
            </div>
            <div className="font-mono text-[10px] text-slate-500">
              {folder?.code}{folder?.version ? <span className="text-slate-600"> ·v{folder.version}</span> : null}
              <span className="ml-1.5 text-slate-600">{noteCount} note{noteCount === 1 ? '' : 's'} saved in this browser</span>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/25 px-2 py-1">
              <MonitorPlay className="h-3.5 w-3.5 text-slate-500" />
              <select value={aspect} onChange={(e) => setAspect(e.target.value)}
                title="Match the board this deck is taught on"
                className="bg-transparent text-[11px] font-semibold text-slate-200 outline-none [&>option]:bg-slate-900">
                {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>

            <HeadBtn onClick={copyAll} title="Copy every note as slide-numbered markdown">
              {copied === 'all' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'all' ? 'Copied' : 'Copy for AI'}
            </HeadBtn>
            <HeadBtn onClick={downloadMd} title="Download the notes as a .md file">
              <Download className="h-3.5 w-3.5" /> Download
            </HeadBtn>
            <HeadBtn onClick={() => setListOpen((v) => !v)} title="Show every note taken on this deck">
              {listOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
              Notes ({noteCount})
            </HeadBtn>
            <HeadBtn onClick={toggleFull} title="Presentation mode (full screen)">
              <Maximize2 className="h-3.5 w-3.5" /> Present
            </HeadBtn>
            <button type="button" onClick={close} title="Back to the library"
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
      )}

      {/* ── body ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <main ref={stageRef} className="relative grid min-w-0 flex-1 place-items-center overflow-hidden p-2">
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {srcdoc && box.w > 0 && (
            <div className="relative overflow-hidden rounded-lg border border-white/10 shadow-2xl shadow-black/60"
              style={{ width: Math.round(board.w * scale), height: Math.round(board.h * scale) }}>
              <iframe
                ref={frameRef}
                title="Slides — notes mode"
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

          {/* In presentation mode the only chrome over the slide is this: which
              slide you are on, and how many notes it already carries. */}
          {full && (
            <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[11px] font-semibold tabular-nums text-slate-300 backdrop-blur">
              {slideNo} / {pages.length}
              {stepCount > 0 && <span className="ml-1.5 text-slate-500">· step {step}/{stepCount}</span>}
              {onThisSlide > 0 && <span className="ml-1.5 text-emerald-400">· {onThisSlide} note{onThisSlide === 1 ? '' : 's'}</span>}
            </div>
          )}

          {toast && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-xl border border-amber-400/30 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-100 shadow-lg">
              {toast}
            </div>
          )}
        </main>

        {/* ── notes list (never over the slide in presentation mode) ────── */}
        {listOpen && !full && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-white/8 bg-[#0b0f19]">
            <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Notes · {noteCount}
              </span>
              <button type="button" onClick={clearAll} disabled={!noteCount} title="Delete every note on this deck"
                className="ml-auto rounded p-1 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {!noteCount && (
                <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-500">
                  Nothing yet. Type in the box below while you click through the deck — each line is filed under the slide you were on.
                </p>
              )}
              <NoteGroups notes={notes} pages={pages} current={slideNo}
                onGo={(s) => showSlide(s - 1)} onEdit={editNote} onRemove={removeNote} />
            </div>
          </aside>
        )}
      </div>

      {/* ── the note bar ───────────────────────────────────────────────── */}
      {barHidden ? (
        <button type="button" onClick={() => { setBarHidden(false); focusBox() }}
          title="Show the note box"
          className={`${full ? 'absolute bottom-3 left-1/2 -translate-x-1/2' : 'mx-auto mb-2'} z-20 flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-950/85 px-3 py-1.5 text-xs font-semibold text-emerald-200 backdrop-blur transition hover:bg-emerald-900/85`}>
          <Eye className="h-3.5 w-3.5" /> Notes hidden — click or type to bring the box back
        </button>
      ) : (
        <div className={
          full
            ? 'absolute inset-x-0 bottom-0 z-20 border-t border-white/10 bg-black/75 px-3 py-2 backdrop-blur'
            : 'shrink-0 border-t border-white/8 bg-[#0b0f19] px-3 py-2'
        }>
          <div className="mx-auto flex max-w-6xl items-end gap-2">
            {/* deck navigation, always within thumb reach of the box */}
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
              <NavBtn title="Back (←)" onClick={() => advance(-1)} disabled={index === 0 && step === 0}>
                <ChevronLeft className="h-4 w-4" />
              </NavBtn>
              <span className="px-1.5 text-center text-[11px] font-semibold leading-tight tabular-nums text-slate-300">
                <span className="block">{slideNo} / {pages.length}</span>
                {stepCount > 0 && <span className="block text-[9px] font-normal text-slate-500">step {step}/{stepCount}</span>}
              </span>
              <NavBtn title="Next (→)" onClick={() => advance(1)}
                disabled={index >= pages.length - 1 && step >= stepCount}>
                <ChevronRight className="h-4 w-4" />
              </NavBtn>
            </div>

            {/* the box */}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">
                  Slide {draftSlide || slideNo}
                </span>
                <span className="truncate text-slate-500">
                  {pages[(draftSlide || slideNo) - 1]?.title || ''}
                </span>
                <span className="ml-auto hidden items-center gap-1 whitespace-nowrap text-slate-600 sm:flex">
                  <CornerDownLeft className="h-3 w-3" /> Enter saves · Shift+Enter new line · ←/→ move the deck
                </span>
              </div>
              <textarea
                ref={boxRef}
                value={draft}
                rows={2}
                spellCheck={false}
                placeholder={`Type a note for slide ${slideNo}… it is stamped with this slide number automatically.`}
                onChange={(e) => { if (e.target.value && draftSlide == null) stampSlide(); setDraft(e.target.value) }}
                className="w-full resize-none rounded-xl border border-emerald-400/25 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            {/* actions */}
            <div className="flex shrink-0 flex-col gap-1">
              <button type="button" onClick={() => commitRef.current()} disabled={!draft.trim()}
                title="Save this note against its slide (Enter)"
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-40">
                <NotebookPen className="h-3.5 w-3.5" /> Save note
              </button>
              <div className="flex gap-1">
                <MiniBtn onClick={copyAll} title="Copy every note as slide-numbered markdown">
                  {copied === 'all' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </MiniBtn>
                <MiniBtn onClick={downloadMd} title="Download the notes as .md"><Download className="h-3.5 w-3.5" /></MiniBtn>
                <MiniBtn onClick={() => setBarHidden(true)} title="Hide the note box"><EyeOff className="h-3.5 w-3.5" /></MiniBtn>
                <MiniBtn onClick={toggleFull} title={full ? 'Leave presentation mode (Esc)' : 'Presentation mode'}>
                  {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </MiniBtn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── notes list, grouped by slide ──────────────────────────────────────── */
function NoteGroups({ notes, pages, current, onGo, onEdit, onRemove }) {
  const groups = useMemo(() => {
    const m = new Map()
    for (const n of notes) {
      if (!m.has(n.slide)) m.set(n.slide, [])
      m.get(n.slide).push(n)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [notes])

  return (
    <ol className="space-y-3">
      {groups.map(([slide, list]) => (
        <li key={slide}>
          <button type="button" onClick={() => onGo(slide)}
            className={`mb-1 flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5 ${
              slide === current ? 'text-emerald-300' : 'text-slate-400'
            }`}>
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-black/50 text-[10px] font-bold">
              {slide}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px]">
              {pages[slide - 1]?.title || `Slide ${slide}`}
            </span>
          </button>
          <ul className="space-y-1">
            {list.map((n) => (
              <li key={n.id} className="group flex items-start gap-1 rounded-lg border border-white/8 bg-white/4 p-1.5">
                <textarea
                  value={n.text}
                  rows={Math.min(6, n.text.split('\n').length + (n.text.length > 60 ? 1 : 0))}
                  onChange={(e) => onEdit(n.id, e.target.value)}
                  className="min-w-0 flex-1 resize-none bg-transparent text-xs leading-snug text-slate-200 outline-none"
                />
                <button type="button" onClick={() => onRemove(n.id)} title="Delete this note"
                  className="shrink-0 rounded p-1 text-slate-600 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

/* ── small chrome ──────────────────────────────────────────────────────── */
function HeadBtn({ children, onClick, title }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-emerald-400/40 hover:bg-white/10 hover:text-white">
      {children}
    </button>
  )
}
function NavBtn({ children, onClick, title, disabled }) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled}
      className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent">
      {children}
    </button>
  )
}
function MiniBtn({ children, onClick, title }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:border-emerald-400/40 hover:text-white">
      {children}
    </button>
  )
}

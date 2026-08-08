import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Library, X, ChevronRight, Layers, FolderOpen, Loader2, Check, Upload,
  CheckSquare, Square,
} from 'lucide-react'
import { listClasses, listChapters, listFolders, FOLDER_TAGS, makeId } from '../lib/content'
import {
  findUnfinishedSession,
  saveTeachingSession,
  loadSessionForReview,
} from '../lib/sessions'
import { loadPresenterExportConfig, rememberExportValues } from '../lib/batchSettings'
import ChapterIcon from '../components/ChapterIcon'

// No pointer / key / board activity for this long → snapshot the session.
// The user is never signed out and never navigated away; teaching continues.
const INACTIVITY_MS = 15 * 60 * 1000

// Full-screen host for the standalone presenter panel (public/presenter.html).
// The board gets the whole viewport — no header of our own — so the panel's
// own control strip asks us for the three things it can't do from inside a
// sandboxed iframe: open the Library picker, navigate back out, and release
// full screen. Decks normally come from Firestore; the picker's "Upload HTML"
// button is the one escape hatch for a deck that is still only a local file.
export default function PresenterView() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const iframeRef = useRef(null)
  const wrapRef = useRef(null)
  const [libOpen, setLibOpen] = useState(false)
  const [restoreNote, setRestoreNote] = useState('')
  // A folder passed via navigation state (e.g. the "Preview" button on the
  // content panel) is auto-loaded once the presenter iframe is ready.
  const pendingFolder = useRef(location.state?.folder || null)
  const pendingReview = useRef(location.state?.reviewSession || null)
  const batchId = params.get('batch') || location.state?.batchId || null
  // "Fresh teach" on the dashboard: same presenter, empty board — the last
  // session's unexported pages are left in history instead of being restored.
  const freshStart = params.get('fresh') === '1' || location.state?.fresh === true
  const sessionIdRef = useRef(makeId('sess'))
  // How far the *live* board has been exported — used so a later timeout
  // snapshot (full board) can still restore only the unexported tail on Teach.
  const liveExportedThroughRef = useRef(-1)
  const lastActivity = useRef(Date.now())
  const savingRef = useRef(false)

  const post = useCallback((msg) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  const touchActivity = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  const persistBoard = useCallback(async (msg) => {
    const bid = msg.batchId || batchId
    if (!bid || !msg.board) return null
    // End-session: do not archive the full board — only export / timeout persist.
    if (msg.reason === 'end') return null
    if (msg.reason !== 'export' && msg.reason !== 'timeout') return null
    if (savingRef.current) return null
    savingRef.current = true
    try {
      const sid = msg.sessionId || sessionIdRef.current
      let exportedThrough = msg.exportedThrough
      let createdAt

      if (msg.reason === 'export') {
        // Freeze how far this live board reached so later timeout restore can skip it.
        liveExportedThroughRef.current = Math.max(
          liveExportedThroughRef.current,
          exportedThrough ?? -1,
        )
      } else {
        // timeout: keep full board, but remember prior export progress
        const prior = await loadSessionForReview(bid, sid).catch(() => null)
        if (prior) createdAt = prior.createdAt
        if (exportedThrough == null || exportedThrough < 0) {
          exportedThrough = Math.max(
            liveExportedThroughRef.current,
            prior?.exportedThrough ?? -1,
          )
        }
      }
      if (exportedThrough == null) exportedThrough = -1

      const snap = await saveTeachingSession(bid, msg.board, {
        sessionId: sid,
        exportedThrough,
        status: msg.reason === 'timeout' ? 'timeout' : undefined,
        reason: msg.reason,
        createdAt,
      })

      if (msg.reason === 'export') {
        // Leave the export archive alone — continue teaching under a fresh id.
        sessionIdRef.current = makeId('sess')
        post({ type: 'lf-session-config', batchId: bid, sessionId: sessionIdRef.current })
      } else {
        sessionIdRef.current = snap.id
        post({ type: 'lf-session-config', batchId: bid, sessionId: snap.id })
      }
      return snap
    } catch (err) {
      console.warn('Session save failed:', err)
      return null
    } finally {
      savingRef.current = false
    }
  }, [batchId, post])

  // Post one or many folders into the presenter iframe as decks.
  const loadFolders = useCallback((folders) => {
    const list = (Array.isArray(folders) ? folders : [folders]).filter(Boolean)
    if (!list.length) return
    if (list.length === 1) {
      const f = list[0]
      post({
        type: 'lf-load-deck',
        text: f.html || '',
        name: f.name || 'Folder',
        folderId: f.id || f.folderId || null,
        classId: f.classId || null,
        chapterId: f.chapterId || null,
        tag: f.tag || null,
      })
    } else {
      post({
        type: 'lf-load-decks',
        decks: list.map((f) => ({
          text: f.html || '',
          name: f.name || 'Folder',
          folderId: f.id || f.folderId || null,
          classId: f.classId || null,
          chapterId: f.chapterId || null,
          tag: f.tag || null,
        })),
      })
    }
    setLibOpen(false)
    touchActivity()
  }, [post, touchActivity])

  const loadFolder = useCallback((folder) => loadFolders([folder]), [loadFolders])

  // Everything the export flow needs: the global chapter/topic map, the
  // global Starting/Ending pages and logo, plus this batch's memory of the
  // last export. Pushed into the panel so the export dialog can be built
  // entirely inside the iframe (which keeps working in full screen).
  const pushExportConfig = useCallback(async (bid) => {
    if (!bid) return
    try {
      const config = await loadPresenterExportConfig(bid)
      post({ type: 'lf-export-config', config })
    } catch (err) {
      console.warn('Export config load failed:', err)
      post({ type: 'lf-export-config', config: null })
    }
  }, [post])

  // When the iframe finishes loading, configure the session and flush queues.
  const onIframeLoad = useCallback(async () => {
    // Prefer board focus so keyboard + clicker keys land in the presenter.
    try { iframeRef.current?.focus?.() } catch { /* ignore */ }
    post({ type: 'lf-fs-state', on: !!document.fullscreenElement })
    if (batchId) {
      post({ type: 'lf-session-config', batchId, sessionId: sessionIdRef.current })
      pushExportConfig(batchId)
    }

    // Review an old session (full snapshot) takes priority over auto-restore.
    if (pendingReview.current) {
      const review = pendingReview.current
      pendingReview.current = null
      const snap = typeof review === 'string'
        ? await loadSessionForReview(batchId, review)
        : review
      if (snap?.pages?.length) {
        sessionIdRef.current = snap.id || sessionIdRef.current
        post({ type: 'lf-session-config', batchId: snap.batchId || batchId, sessionId: sessionIdRef.current })
        post({
          type: 'lf-restore-session',
          sessionId: sessionIdRef.current,
          payload: {
            decks: snap.decks || [],
            pages: snap.pages || [],
            current: Math.max(0, snap.current || 0),
          },
        })
        setRestoreNote('Loaded saved session for review.')
        return
      }
    }

    if (pendingFolder.current) {
      loadFolder(pendingFolder.current)
      pendingFolder.current = null
      return
    }

    // Fresh teach: start on a clean board and say so, rather than silently
    // leaving the teacher wondering where last lecture's pages went.
    if (freshStart) {
      setRestoreNote('Fresh session — last session’s pages were not reloaded.')
      return
    }

    // Teach: auto-restore unexported / partially exported work from last session.
    if (batchId) {
      try {
        const found = await findUnfinishedSession(batchId)
        if (found?.payload) {
          sessionIdRef.current = found.snapshot.id
          post({ type: 'lf-session-config', batchId, sessionId: sessionIdRef.current })
          post({
            type: 'lf-restore-session',
            sessionId: sessionIdRef.current,
            payload: found.payload,
          })
          const n = found.payload.pages.length
          setRestoreNote(
            `Restored ${n} unexported page${n === 1 ? '' : 's'} (with ink) from your last session.`,
          )
        }
      } catch (err) {
        console.warn('Unfinished session restore failed:', err)
      }
    }
  }, [batchId, freshStart, loadFolder, post, pushExportConfig])

  useEffect(() => {
    if (!restoreNote) return
    const t = setTimeout(() => setRestoreNote(''), 4000)
    return () => clearTimeout(t)
  }, [restoreNote])

  // 15-minute inactivity → quietly save the current board. Nothing else:
  // the session stays open, full screen is kept, the user stays signed in.
  // Saved once per idle stretch; a new save arms again after the next activity.
  useEffect(() => {
    if (!batchId) return undefined
    let savedForThisIdle = false
    const cleanups = new Set()
    const tick = setInterval(() => {
      if (Date.now() - lastActivity.current < INACTIVITY_MS) {
        savedForThisIdle = false          // activity resumed — arm the next save
        return
      }
      if (savedForThisIdle || savingRef.current) return
      savedForThisIdle = true

      const requestId = makeId('idle')
      let giveUp
      const done = () => {
        window.removeEventListener('message', onState)
        clearTimeout(giveUp)
        cleanups.delete(done)
      }
      const onState = async (e) => {
        if (e.source !== iframeRef.current?.contentWindow) return
        const d = e.data || {}
        if (d.type !== 'lf-session-state' || d.requestId !== requestId) return
        done()
        await persistBoard({ ...d, reason: 'timeout', batchId })
      }
      // If the panel never answers, drop the listener and try again next idle.
      giveUp = setTimeout(() => { done(); savedForThisIdle = false }, 8000)
      cleanups.add(done)
      window.addEventListener('message', onState)
      post({ type: 'lf-request-save', requestId, reason: 'timeout', batchId })
    }, 30_000)
    return () => {
      clearInterval(tick)
      cleanups.forEach((fn) => fn())
    }
  }, [batchId, persistBoard, post])

  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const d = e.data || {}
      if (d.type === 'lf-open-library') {
        setLibOpen(true)
        touchActivity()
        post({ type: 'lf-library-ack' })   // tells the panel not to fall back
      } else if (d.type === 'lf-exit') {
        navigate(-1)
      } else if (d.type === 'lf-fullscreen') {
        // This wrapper — not the iframe — is the full-screen element, because
        // a browser paints only the full-screen element and its descendants.
        // Fullscreening the iframe would leave the picker below unpainted and
        // the Library button dead. The wrapper contains both.
        post({ type: 'lf-fullscreen-ack' })
        if (d.on) wrapRef.current?.requestFullscreen?.().catch(() => {})
        else if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      } else if (d.type === 'lf-activity') {
        touchActivity()
      } else if (d.type === 'lf-export-vars') {
        // The teacher just filled in the export form — remember the batch code
        // (and chapter/lecture) so the next export starts pre-filled.
        touchActivity()
        const bid = d.batchId || batchId
        if (bid && d.values) {
          rememberExportValues(bid, d.values).catch((err) =>
            console.warn('Could not remember export values:', err))
        }
      } else if (d.type === 'lf-session-state') {
        // Idle snapshots are answered by the inactivity effect's own listener,
        // and they are not user activity — they must not restart the idle clock.
        if (d.reason === 'timeout') return
        touchActivity()
        persistBoard(d)
      }
    }
    const onFsChange = () => post({ type: 'lf-fs-state', on: !!document.fullscreenElement })
    const onPointer = () => touchActivity()
    // PPT clickers send PageUp/PageDown (and sometimes Space). When focus sits
    // on the host shell instead of the board iframe, forward those keys in.
    const NAV_KEYS = new Set([
      'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ', 'Spacebar', 'Backspace',
    ])
    const onKey = (e) => {
      if (libOpen) return
      if (e.target?.matches?.('input,textarea,[contenteditable="true"]')) return
      if (!NAV_KEYS.has(e.key)) return
      e.preventDefault()
      touchActivity()
      post({ type: 'lf-key', key: e.key })
    }
    window.addEventListener('message', onMessage)
    document.addEventListener('fullscreenchange', onFsChange)
    window.addEventListener('keydown', onKey)
    wrapRef.current?.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('fullscreenchange', onFsChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [batchId, navigate, persistBoard, post, touchActivity, libOpen])

  return (
    <div ref={wrapRef} className="fixed inset-0 z-50 bg-[#0b0f19]">
      <iframe
        ref={iframeRef}
        title="Presenter panel"
        src="/presenter.html"
        allow="fullscreen"
        onLoad={onIframeLoad}
        className="h-full w-full border-0"
        tabIndex={-1}
      />

      {restoreNote && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-xl border border-violet-400/30 bg-violet-950/90 px-4 py-2 text-sm text-violet-100 shadow-lg">
          {restoreNote}
        </div>
      )}

      {libOpen && (
        <LibraryPicker
          onClose={() => setLibOpen(false)}
          onPickMany={loadFolders}
          onNote={setRestoreNote}
        />
      )}
    </div>
  )
}

// Drill-down picker over every class → chapter → folder in Firestore.
// Folder level supports multi-select + multi-category filtering.
// "Upload HTML" side-steps the library entirely: the file is read here and
// posted into the board as a deck, exactly like a folder that came from
// Firestore. Nothing is written back to the library.
function LibraryPicker({ onClose, onPickMany, onNote }) {
  const [cls, setCls] = useState(null)
  const [chapter, setChapter] = useState(null)
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  async function onFilesChosen(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''            // so the same file can be picked again later
    if (!files.length) return
    setUploadErr('')
    setUploading(true)
    try {
      const decks = []
      const rejected = []
      for (const file of files) {
        let html = null
        try { html = await file.text() } catch { html = null }
        // Same contract the board enforces: a deck is <section class="page">s.
        const ok = html && new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelectorAll('.page').length > 0
        if (!ok) { rejected.push(file.name); continue }
        decks.push({
          // No folder id: this deck has no home in the library, and a fake id
          // would be persisted as a session's sourceFolderId.
          id: null,
          name: file.name.replace(/\.html?$/i, ''),
          html,
          tag: 'Uploaded',
        })
      }
      if (rejected.length) {
        const msg = `Skipped ${rejected.join(', ')} — no <section class="page"> slides found.`
        // Shown in the picker if it stays open; handed to the host toast when
        // the good decks load and the picker closes underneath it.
        setUploadErr(msg)
        if (decks.length) onNote?.(msg)
      }
      if (decks.length) onPickMany(decks)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex bg-slate-900/70 backdrop-blur-sm" onClick={onClose}>
      <div className="m-auto flex h-[80vh] w-[92vw] max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Library className="h-4 w-4 text-violet-600" />
          <div className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            <Crumb label="Classes" onClick={() => { setCls(null); setChapter(null) }} active={!cls} />
            {cls && (<><ChevronRight className="h-3.5 w-3.5 text-slate-300" /><Crumb label={cls.name} onClick={() => setChapter(null)} active={!chapter} /></>)}
            {chapter && (<><ChevronRight className="h-3.5 w-3.5 text-slate-300" /><Crumb label={chapter.name} active /></>)}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,text/html"
            multiple
            className="hidden"
            onChange={onFilesChosen}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Load a deck straight from this computer"
            className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Upload className="h-4 w-4" />}
            Upload HTML
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {uploadErr && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            {uploadErr}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!cls && <ClassPicker onOpen={setCls} />}
          {cls && !chapter && <ChapterPicker cls={cls} onOpen={setChapter} />}
          {cls && chapter && (
            <FolderPicker cls={cls} chapter={chapter} onPickMany={onPickMany} />
          )}
        </div>
      </div>
    </div>
  )
}

function useList(fn, deps) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let active = true
    fn().then((r) => { if (active) setItems(r) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return items
}

function ClassPicker({ onOpen }) {
  const items = useList(() => listClasses(), [])
  if (items === null) return <Spinner />
  if (!items.length) return <Empty text="No classes yet. Create content from the dashboard first." />
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <PickRow key={c.id} onClick={() => onOpen(c)}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Layers className="h-4.5 w-4.5" /></span>
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{c.name}</span>
        </PickRow>
      ))}
    </ul>
  )
}

function ChapterPicker({ cls, onOpen }) {
  const items = useList(() => listChapters(cls.id), [cls.id])
  if (items === null) return <Spinner />
  if (!items.length) return <Empty text="No chapters in this class." />
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <PickRow key={c.id} onClick={() => onOpen(c)}>
          <ChapterIcon svg={c.svgIcon} size={36} />
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{c.name}</span>
        </PickRow>
      ))}
    </ul>
  )
}

function FolderPicker({ cls, chapter, onPickMany }) {
  const items = useList(() => listFolders(cls.id, chapter.id), [cls.id, chapter.id])
  const [selected, setSelected] = useState(() => new Set())
  // Empty set = show all categories; otherwise filter to selected tags.
  const [activeTags, setActiveTags] = useState(() => new Set())

  const availableTags = useMemo(() => {
    if (!items) return []
    const present = new Set(items.map((f) => f.tag || FOLDER_TAGS[0]))
    return FOLDER_TAGS.filter((t) => present.has(t)).concat(
      [...present].filter((t) => !FOLDER_TAGS.includes(t)),
    )
  }, [items])

  // Drop stale category selections when the chapter's tag set changes.
  useEffect(() => {
    setActiveTags((prev) => {
      if (!prev.size) return prev
      const next = new Set([...prev].filter((t) => availableTags.includes(t)))
      return next.size === prev.size ? prev : next
    })
    setSelected(new Set())
  }, [availableTags, cls.id, chapter.id])

  const filtered = useMemo(() => {
    if (!items) return []
    if (!activeTags.size) return items
    return items.filter((f) => activeTags.has(f.tag || FOLDER_TAGS[0]))
  }, [items, activeTags])

  function toggleTag(tag) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  function toggleFolder(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // "Select all" acts on what is currently visible, so it respects the
  // category filter rather than quietly picking up hidden folders.
  const visibleSelected = useMemo(
    () => filtered.filter((f) => selected.has(f.id)).length,
    [filtered, selected],
  )
  const allVisibleSelected = filtered.length > 0 && visibleSelected === filtered.length

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach((f) => next.delete(f.id))
      else filtered.forEach((f) => next.add(f.id))
      return next
    })
  }

  function loadSelected() {
    const folders = filtered
      .filter((f) => selected.has(f.id))
      .map((f) => ({ ...f, classId: cls.id, chapterId: chapter.id }))
    if (!folders.length) return
    onPickMany(folders)
  }

  if (items === null) return <Spinner />
  if (!items.length) return <Empty text="No folders in this chapter." />

  return (
    <div className="flex h-full flex-col">
      {availableTags.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Categories
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTags(new Set())}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                activeTags.size === 0
                  ? 'bg-violet-600 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-violet-300'
              }`}
            >
              All
            </button>
            {availableTags.map((tag) => {
              const on = activeTags.has(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                    on
                      ? 'bg-violet-600 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-violet-300'
                  }`}
                >
                  {tag}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Select one or more categories to filter. Empty categories stay hidden.
          </p>
        </div>
      )}

      {!filtered.length ? (
        <Empty text="No folders match the selected categories." />
      ) : (
        <>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {filtered.length} folder{filtered.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-violet-300 hover:text-violet-700"
          >
            {allVisibleSelected
              ? <><Square className="h-3.5 w-3.5" /> Clear all</>
              : <><CheckSquare className="h-3.5 w-3.5" /> Select all</>}
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {filtered.map((f) => {
            const on = selected.has(f.id)
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => toggleFolder(f.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left shadow-sm transition ${
                    on
                      ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200'
                      : 'border-slate-200 bg-white hover:border-violet-200 hover:shadow-md'
                  }`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${
                    on ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 bg-white'
                  }`}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-600">
                    <FolderOpen className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{f.name}</span>
                    <span className="mt-0.5 inline-block rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {f.tag || FOLDER_TAGS[0]}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        </>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">
          {visibleSelected ? `${visibleSelected} selected` : 'Select one or more folders'}
        </span>
        <button
          type="button"
          disabled={!visibleSelected}
          onClick={loadSelected}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Load selected
        </button>
      </div>
    </div>
  )
}

function PickRow({ children, onClick }) {
  return (
    <li>
      <button onClick={onClick}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-violet-200 hover:shadow-md">
        {children}
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </button>
    </li>
  )
}
function Crumb({ label, onClick, active }) {
  return (
    <button onClick={onClick} disabled={active}
      className={`max-w-[12rem] truncate rounded px-1.5 py-0.5 ${active ? 'font-semibold text-slate-900' : 'text-slate-500 hover:bg-slate-100'}`}>
      {label}
    </button>
  )
}
function Spinner() {
  return <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
}
function Empty({ text }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{text}</div>
}

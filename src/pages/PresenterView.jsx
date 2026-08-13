import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Library, X, ChevronRight, Layers, FolderOpen, Loader2, Check, Upload,
  CheckSquare, Square,
} from 'lucide-react'
import {
  listClasses, listChapters, listFolders, readFolderHtml, registerUploadedDeck,
  uploadChapterName, FOLDER_TAGS, makeId,
} from '../lib/content'
import {
  findUnfinishedSession,
  saveTeachingSession,
  loadSessionForReview,
} from '../lib/sessions'
import { loadPresenterExportConfig, rememberExportValues } from '../lib/batchSettings'
import { useAuth } from '../context/AuthContext'
import ChapterIcon from '../components/ChapterIcon'

// No pointer / key / board activity for this long → snapshot the session.
// The user is never signed out and never navigated away; teaching continues.
const INACTIVITY_MS = 15 * 60 * 1000

/**
 * A cheap fingerprint of a board: how many pages, how much ink, how many
 * frozen slides. Two boards with the same signature are, for saving purposes,
 * the same board.
 *
 * This is what answers "has anything changed since the last time this was
 * written?" — the question the exit save actually needs. Page counts alone are
 * not enough (ink added to an already-exported page changes nothing about the
 * count), and `exportedThrough` is not enough either (it is only known for
 * exports that happened during this visit, so opening an old session and
 * closing it again would look like brand-new work and rewrite the archive).
 */
function boardSignature(pages) {
  let strokes = 0
  let points = 0
  let frozen = 0
  for (const p of pages || []) {
    const s = p.strokes || []
    strokes += s.length
    for (const stroke of s) points += (stroke.pts || []).length
    if (p.snap) frozen += 1
  }
  return `${(pages || []).length}:${strokes}:${points}:${frozen}`
}

const EMPTY_BOARD_SIGNATURE = boardSignature([])

// Full-screen host for the standalone presenter panel (public/presenter.html).
// The board gets the whole viewport — no header of our own — so the panel's
// own control strip asks us for the three things it can't do from inside a
// sandboxed iframe: open the Library picker, leave for the dashboard (saving
// the board on the way out), and release full screen. Decks come from
// Firestore under the signed-in teacher's own tree; the picker's "Upload HTML"
// button is the one escape hatch for a deck that is still only a local file.
export default function PresenterView() {
  const navigate = useNavigate()
  const { user } = useAuth()
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
  // True while the board is a restored *tail* of an older session: its pages
  // were renumbered from `exportedThrough + 1` down to 0, so that session's
  // export mark describes a numbering this board no longer uses. Inheriting it
  // would mark pages that were never exported as exported — and, once the mark
  // reaches the last page, stamp the session `complete`, which is what stops
  // it ever being offered for restore again.
  const renumberedRestoreRef = useRef(false)
  const lastActivity = useRef(Date.now())
  const savingRef = useRef(false)
  // Signature of the board as it was the last time it was written anywhere —
  // an export, an idle save, or the copy the host just restored into the
  // panel. The exit save compares against this and stays silent if the board
  // has not moved since.
  const lastSavedSignatureRef = useRef(EMPTY_BOARD_SIGNATURE)
  // Saves run one at a time, in order. Dropping a concurrent save (the old
  // behaviour) could throw away an export archive because an idle snapshot
  // happened to be in flight.
  const saveQueueRef = useRef(Promise.resolve())

  const post = useCallback((msg) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  /** Tell the panel who and what this board belongs to. */
  const pushSessionConfig = useCallback((bid, sid) => {
    post({
      type: 'lf-session-config',
      batchId: bid || null,
      sessionId: sid || null,
      // Scopes the panel's own crash-recovery key, so a Preview inked by one
      // teacher is never offered to the next person on this machine.
      userKey: user?.uid || null,
    })
  }, [post, user])

  const touchActivity = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  const persistBoard = useCallback((msg) => {
    const bid = msg.batchId || batchId
    if (!bid || !msg.board) return Promise.resolve(null)
    // End-session: do not archive the full board — only export / timeout / exit persist.
    if (!['export', 'timeout', 'exit'].includes(msg.reason)) return Promise.resolve(null)

    const run = async () => {
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
          // The board has now been exported under its current numbering, so
          // that mark is the live one from here on.
          renumberedRestoreRef.current = false
        } else {
          // timeout / exit: keep the full board, but remember prior export progress
          const prior = await loadSessionForReview(bid, sid).catch(() => null)
          if (prior) createdAt = prior.createdAt
          if (exportedThrough == null || exportedThrough < 0) {
            const inherited = renumberedRestoreRef.current ? -1 : (prior?.exportedThrough ?? -1)
            exportedThrough = Math.max(liveExportedThroughRef.current, inherited)
          }
        }
        if (exportedThrough == null) exportedThrough = -1

        const snap = await saveTeachingSession(bid, msg.board, {
          sessionId: sid,
          exportedThrough,
          // An exit save is a real, resumable session — let its status be
          // derived (active / partially exported) rather than labelled an idle
          // auto-save.
          status: msg.reason === 'timeout' ? 'timeout' : undefined,
          reason: msg.reason,
          createdAt,
        })

        // What actually landed on the server — NOT the live board. An
        // "export current page only" writes a prefix, so fingerprinting the
        // live board here would tell the exit save that the pages beyond the
        // export were already saved, and they would be dropped on the way out.
        lastSavedSignatureRef.current = boardSignature(snap?.pages)

        if (msg.reason === 'export') {
          // Leave the export archive alone — continue teaching under a fresh id.
          sessionIdRef.current = makeId('sess')
          pushSessionConfig(bid, sessionIdRef.current)
        } else {
          sessionIdRef.current = snap.id
          pushSessionConfig(bid, snap.id)
        }
        return snap
      } catch (err) {
        console.warn('Session save failed:', err)
        return null
      } finally {
        savingRef.current = false
      }
    }

    // Queue behind whatever is already saving, rather than refusing to run.
    const next = saveQueueRef.current.then(run, run)
    saveQueueRef.current = next.then(() => {}, () => {})
    return next
  }, [batchId, pushSessionConfig])

  /**
   * Ask the panel for the live board and wait for its reply.
   *
   * The board lives inside the iframe, so every save starts as a round trip:
   * post `lf-request-save`, listen for the `lf-session-state` that carries the
   * matching `requestId`. Resolves `null` if the panel never answers — a save
   * that cannot happen must not hang the caller (or, for exit, trap the
   * teacher on a board they asked to leave).
   */
  const requestBoardSnapshot = useCallback((reason, timeoutMs = 8000) =>
    new Promise((resolve) => {
      const win = iframeRef.current?.contentWindow
      if (!win) { resolve(null); return }
      const requestId = makeId('req')
      let timer
      const finish = (value) => {
        window.removeEventListener('message', onState)
        clearTimeout(timer)
        resolve(value)
      }
      const onState = (e) => {
        if (e.source !== iframeRef.current?.contentWindow) return
        const d = e.data || {}
        if (d.type !== 'lf-session-state' || d.requestId !== requestId) return
        finish(d)
      }
      timer = setTimeout(() => finish(null), timeoutMs)
      window.addEventListener('message', onState)
      post({ type: 'lf-request-save', requestId, reason, batchId })
    }), [batchId, post])

  // Leaving the presenter: save first, then go to the dashboard.
  //
  // The old behaviour was `navigate(-1)`, which is wrong twice over. It dead-
  // ends when /teach is the first page in the tab (opened from a link, or
  // reloaded mid-lecture) — there is no entry to go back to, so the button
  // does nothing. And it walked away from a board that had never been saved:
  // everything drawn since the last Export was simply gone.
  //
  // So: snapshot the board and write it unless it is already saved — the
  // signature has not moved since the last export, idle save, or restore. That
  // covers both "everything went out through Export" and "an old session was
  // opened, looked at, and closed again", which must not rewrite its own
  // archive. Then land on the dashboard, whatever happened: a failed save is
  // logged, never a reason to trap the teacher on the board.
  const leavingRef = useRef(false)
  const leaveToDashboard = useCallback(async () => {
    if (leavingRef.current) return
    leavingRef.current = true
    try {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})

      if (batchId) {
        const msg = await requestBoardSnapshot('exit', 6000)
        const pages = msg?.board?.pages || []
        if (pages.length && boardSignature(pages) !== lastSavedSignatureRef.current) {
          setRestoreNote('Saving this session…')
          // Bounded, like the snapshot round trip above. A Firestore write
          // that never settles (no network, no offline persistence) would
          // otherwise leave this awaiting forever with `leavingRef` latched —
          // a Back button that does nothing, which is the bug being fixed.
          // The write is not cancelled, it just stops being waited on: the
          // panel's own local recovery snapshot still covers this board.
          await Promise.race([
            persistBoard({ ...msg, reason: 'exit', batchId }),
            new Promise((r) => setTimeout(r, 10_000)),
          ])
        }
      }
    } catch (err) {
      console.warn('Could not save the session on exit:', err)
    } finally {
      navigate('/', { replace: true })
    }
  }, [batchId, navigate, persistBoard, requestBoardSnapshot])

  // Post one or many folders into the presenter iframe as decks.
  //
  // A folder row no longer carries its HTML — it carries a content `code` and
  // the `version` it points at. Resolve those here (cached in IndexedDB, so a
  // deck taught last week costs no reads) and hand the board both the text and
  // the reference, so the session it later saves can store the reference alone.
  const loadFolders = useCallback(async (folders) => {
    const list = (Array.isArray(folders) ? folders : [folders]).filter(Boolean)
    if (!list.length) return
    // Close the picker on the press, not after the fetch — resolving several
    // codes can take a beat and a picker that hangs open reads as a dead button.
    setLibOpen(false)
    touchActivity()

    const resolved = []
    const failed = []
    for (const f of list) {
      const text = f.html != null ? f.html : await readFolderHtml(f).catch(() => '')
      if (!text) { failed.push(f.name || 'Untitled'); continue }
      resolved.push({
        text,
        name: f.name || 'Folder',
        code: f.code || null,
        version: f.version || null,
        folderId: f.id || f.folderId || null,
        classId: f.classId || null,
        chapterId: f.chapterId || null,
        tag: f.tag || null,
      })
    }
    if (failed.length) {
      setRestoreNote(`Could not load ${failed.join(', ')} — the content is missing.`)
    }
    if (!resolved.length) return

    if (resolved.length === 1) post({ type: 'lf-load-deck', ...resolved[0] })
    else post({ type: 'lf-load-decks', decks: resolved })
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
    // Always sent, batch or not: it also carries the user key that scopes the
    // panel's crash-recovery store, and a Preview has no batch.
    pushSessionConfig(batchId, batchId ? sessionIdRef.current : null)
    if (batchId) pushExportConfig(batchId)

    // Review an old session (full snapshot) takes priority over auto-restore.
    if (pendingReview.current) {
      const review = pendingReview.current
      pendingReview.current = null
      const snap = typeof review === 'string'
        ? await loadSessionForReview(batchId, review)
        : review
      if (snap?.pages?.length) {
        sessionIdRef.current = snap.id || sessionIdRef.current
        // This board came straight out of storage, so it is already saved.
        // Without this, closing a session you only came to look at would
        // rewrite its archive with a fresh timestamp and an "exit" reason.
        lastSavedSignatureRef.current = boardSignature(snap.pages)
        liveExportedThroughRef.current = snap.exportedThrough ?? -1
        pushSessionConfig(snap.batchId || batchId, sessionIdRef.current)
        post({
          type: 'lf-restore-session',
          sessionId: sessionIdRef.current,
          payload: {
            // `v` is not decoration: the panel scales a v1 payload down by the
            // board it is restoring onto, so omitting it shrinks every stroke
            // of a v2 board into the top-left corner.
            v: snap.v || 1,
            decks: snap.decks || [],
            pages: snap.pages || [],
            current: Math.max(0, snap.current || 0),
          },
        })
        setRestoreNote(
          snap.missingContent?.length
            ? `Loaded saved session — ${snap.missingContent.join(', ')} could not be found in the content library.`
            : 'Loaded saved session for review.',
        )
        return
      }
    }

    if (pendingFolder.current) {
      const folder = pendingFolder.current
      pendingFolder.current = null
      await loadFolder(folder)
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
          // Restored, not taught: leaving again without touching anything
          // must not write this board back a second time.
          lastSavedSignatureRef.current = boardSignature(found.payload.pages)
          renumberedRestoreRef.current = !!found.payload.renumbered
          pushSessionConfig(batchId, sessionIdRef.current)
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
  }, [batchId, freshStart, loadFolder, post, pushExportConfig, pushSessionConfig])

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
    let alive = true
    const tick = setInterval(async () => {
      if (Date.now() - lastActivity.current < INACTIVITY_MS) {
        savedForThisIdle = false          // activity resumed — arm the next save
        return
      }
      if (savedForThisIdle || savingRef.current) return
      savedForThisIdle = true

      const msg = await requestBoardSnapshot('timeout')
      if (!alive) return
      // The panel never answered — try again on the next idle stretch.
      if (!msg) { savedForThisIdle = false; return }
      await persistBoard({ ...msg, reason: 'timeout', batchId })
    }, 30_000)
    return () => {
      alive = false
      clearInterval(tick)
    }
  }, [batchId, persistBoard, requestBoardSnapshot])

  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const d = e.data || {}
      if (d.type === 'lf-open-library') {
        setLibOpen(true)
        touchActivity()
        post({ type: 'lf-library-ack' })   // tells the panel not to fall back
      } else if (d.type === 'lf-exit') {
        leaveToDashboard()
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
        // A snapshot the host asked for (idle save, exit save) carries the
        // requestId of whoever asked; that caller is already awaiting it, and
        // handling it a second time here would save the same board twice. It
        // is also not user activity, so it must not restart the idle clock.
        if (d.requestId) return
        touchActivity()
        if (d.reason === 'end') {
          // "End session" wipes the board on purpose — that board is not
          // archived. But the NEXT lecture must not inherit this one's
          // identity: saving it under the same session id would overwrite the
          // lecture that was just closed, and a stale export mark would make
          // the exit save think the new board was already saved.
          sessionIdRef.current = makeId('sess')
          liveExportedThroughRef.current = -1
          renumberedRestoreRef.current = false
          lastSavedSignatureRef.current = EMPTY_BOARD_SIGNATURE
          pushSessionConfig(d.batchId || batchId, sessionIdRef.current)
          return
        }
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
    const readAddPageShortcut = () => {
      try {
        const raw = localStorage.getItem('lf-shortcut-add-page')
        if (!raw) return { key: 'n', ctrl: false, shift: false, alt: false, meta: false }
        const o = JSON.parse(raw)
        if (!o || typeof o.key !== 'string' || !o.key) {
          return { key: 'n', ctrl: false, shift: false, alt: false, meta: false }
        }
        return {
          key: String(o.key).toLowerCase(),
          ctrl: !!o.ctrl, shift: !!o.shift, alt: !!o.alt, meta: !!o.meta,
        }
      } catch {
        return { key: 'n', ctrl: false, shift: false, alt: false, meta: false }
      }
    }
    const onKey = (e) => {
      if (libOpen) return
      if (e.target?.matches?.('input,textarea,[contenteditable="true"]')) return
      const sc = readAddPageShortcut()
      const name = e.key === ' ' || e.key === 'Spacebar' ? 'space' : String(e.key || '').toLowerCase()
      const isAddPage = name === sc.key
        && !!e.ctrlKey === !!sc.ctrl
        && !!e.shiftKey === !!sc.shift
        && !!e.altKey === !!sc.alt
        && !!e.metaKey === !!sc.meta
      if (!NAV_KEYS.has(e.key) && !isAddPage) return
      e.preventDefault()
      touchActivity()
      post({
        type: 'lf-key',
        key: e.key,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      })
    }
    // Captured now: by cleanup time the ref may already point elsewhere, and
    // this effect re-runs every time the Library opens or closes — a handler
    // left behind on each pass would pile up on the same element.
    const wrapEl = wrapRef.current
    window.addEventListener('message', onMessage)
    document.addEventListener('fullscreenchange', onFsChange)
    window.addEventListener('keydown', onKey)
    wrapEl?.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('fullscreenchange', onFsChange)
      window.removeEventListener('keydown', onKey)
      wrapEl?.removeEventListener('pointerdown', onPointer)
    }
  }, [batchId, leaveToDashboard, persistBoard, post, pushSessionConfig, touchActivity, libOpen])

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
  // Uploads become real library rows, so the picker below must re-read after
  // one lands rather than showing a stale folder list.
  const [libStamp, setLibStamp] = useState(0)

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

        // Every HTML page file that enters the system gets a code — including
        // this one. It is filed under Random / MM-YYYY so it has a real home,
        // and the session that teaches it stores the code, not the bytes.
        const name = file.name.replace(/\.html?$/i, '')
        try {
          const reg = await registerUploadedDeck({ name, html })
          decks.push({ ...reg, html })
        } catch (err) {
          console.warn('Could not register the uploaded deck:', err)
          // Teach it anyway — but it has no code, so the session cannot
          // reload it later, and saveTeachingSession warns about that.
          decks.push({ id: null, code: null, name, html, tag: 'Uploaded' })
        }
      }
      if (rejected.length) {
        const msg = `Skipped ${rejected.join(', ')} — no <section class="page"> slides found.`
        // Shown in the picker if it stays open; handed to the host toast when
        // the good decks load and the picker closes underneath it.
        setUploadErr(msg)
        if (decks.length) onNote?.(msg)
      }
      if (decks.length) {
        onPickMany(decks)
        const filed = decks.filter((d) => d.code).length
        if (filed) {
          onNote?.(`Filed ${filed} deck${filed === 1 ? '' : 's'} under Random → ${uploadChapterName()}.`)
          setLibStamp((n) => n + 1)
        }
      }
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
          {!cls && <ClassPicker onOpen={setCls} stamp={libStamp} />}
          {cls && !chapter && <ChapterPicker cls={cls} onOpen={setChapter} stamp={libStamp} />}
          {cls && chapter && (
            <FolderPicker cls={cls} chapter={chapter} onPickMany={onPickMany} stamp={libStamp} />
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

function ClassPicker({ onOpen, stamp }) {
  const items = useList(() => listClasses(), [stamp])
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

function ChapterPicker({ cls, onOpen, stamp }) {
  const items = useList(() => listChapters(cls.id), [cls.id, stamp])
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

function FolderPicker({ cls, chapter, onPickMany, stamp }) {
  const items = useList(() => listFolders(cls.id, chapter.id), [cls.id, chapter.id, stamp])
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

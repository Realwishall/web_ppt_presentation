// Teaching session storage — REFERENCES, NOT COPIES.
//
//   users/{uid}/batches/{batchId}/meta/sessionHistory
//       ← ONE document with lightweight entries for EVERY session
//         (id, title, status, times, pageCount, …). Old Sessions lists
//         everything with a single getDoc — even at ~1000 sessions.
//   users/{uid}/batches/{batchId}/sessions/{sessionId}
//       ← the board: which deck code each page came from, which page number,
//         and the ink. NO deck HTML — not one byte.
//   users/{uid}/batches/{batchId}/sessions/{sessionId}/chunks/{i}
//       ← only when the ink + frozen slides alone would burst 1 MB.
//
// A session's decks are stored as `{ code, version }` pairs pointing into the
// content registry (contentStore.js), which is append-only. Teaching the same
// deck to six batches now writes the HTML once, not six times, and editing
// that deck later cannot disturb the ink already drawn over version 2.
//
// EVERY read is batch-scoped AND user-scoped. A session belongs to exactly one
// batch of exactly one teacher, and the local caches carry both ids — opening
// Batch B must never surface a board that was taught to Batch A, and signing in
// as somebody else must never surface either.

import {
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { makeId } from './content'
import { readContentMany } from './contentStore'
import { ucol, udoc, uid } from './userScope'

const IDB_NAME = 'lf-sessions'
const IDB_STORE = 'snapshots'
const IDB_VERSION = 1
/** Cap on entries in the single history doc (~0.5 KB each → well under 1 MB). */
const HISTORY_LIMIT = 1000
/** Keep each Firestore doc comfortably under the 1 MB ceiling. */
const CHUNK_CHARS = 700_000
/** Past this, `pages` spills out of the session doc into chunks/. */
const INLINE_PAGES_MAX = 700_000

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const dbx = req.result
      if (!dbx.objectStoreNames.contains(IDB_STORE)) {
        const store = dbx.createObjectStore(IDB_STORE, { keyPath: 'id' })
        store.createIndex('batchId', 'batchId', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Stamp the owner on every cached board, so a lookup can check it. */
export async function saveSnapshotLocal(snapshot) {
  const dbx = await openIdb()
  try {
    const tx = dbx.transaction(IDB_STORE, 'readwrite')
    await idbReq(tx.objectStore(IDB_STORE).put({ ...snapshot, uid: snapshot.uid || uid() }))
  } finally {
    dbx.close()
  }
}

/**
 * A cached snapshot — ONLY if it belongs to this user AND to `batchId`.
 *
 * The store is keyed by session id alone and one browser profile is shared by
 * everyone who signs in on this machine, so without these two checks a stale
 * entry from another batch — or another teacher — would satisfy the lookup and
 * put somebody else's board on the projector.
 */
export async function getSnapshotLocal(batchId, sessionId) {
  if (!batchId || !sessionId) return null
  const me = uid()
  const dbx = await openIdb()
  try {
    const tx = dbx.transaction(IDB_STORE, 'readonly')
    const row = await idbReq(tx.objectStore(IDB_STORE).get(sessionId))
    if (!row) return null
    if (row.batchId !== batchId) return null
    if ((row.uid || null) !== me) return null
    return row
  } finally {
    dbx.close()
  }
}

export async function listSnapshotsLocal(batchId) {
  if (!batchId) return []
  const me = uid()
  const dbx = await openIdb()
  try {
    const tx = dbx.transaction(IDB_STORE, 'readonly')
    const rows = await idbReq(tx.objectStore(IDB_STORE).index('batchId').getAll(batchId))
    return (rows || [])
      .filter((r) => r.batchId === batchId && (r.uid || null) === me)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } finally {
    dbx.close()
  }
}

function historyRef(batchId) {
  return udoc('batches', batchId, 'meta', 'sessionHistory')
}

function sessionRef(batchId, sessionId) {
  return udoc('batches', batchId, 'sessions', sessionId)
}

function chunkRef(batchId, sessionId, i) {
  return udoc('batches', batchId, 'sessions', sessionId, 'chunks', String(i))
}

function chunksCol(batchId, sessionId) {
  return ucol('batches', batchId, 'sessions', sessionId, 'chunks')
}

function historyEntryFromSnapshot(snap) {
  return {
    id: snap.id,
    title: snap.title || 'Teaching session',
    status: snap.status,
    reason: snap.reason || null,
    pageCount: snap.pages?.length || 0,
    currentPage: snap.current ?? -1,
    exportedThrough: snap.exportedThrough ?? -1,
    deckNames: (snap.decks || []).map((d) => d.name).filter(Boolean),
    deckCodes: (snap.decks || []).map((d) => d.code).filter(Boolean),
    fileCount: (snap.decks || []).length,
    createdAtMs: snap.createdAt || Date.now(),
    updatedAtMs: snap.updatedAt || Date.now(),
  }
}

/**
 * Merge one session's basic info into the batch history doc.
 * This is the list Old Sessions reads with a single getDoc.
 */
async function upsertSessionHistory(batchId, snap) {
  const ref = historyRef(batchId)
  const existing = await getDoc(ref)
  const entry = historyEntryFromSnapshot(snap)
  let sessions = existing.exists() ? [...(existing.data().sessions || [])] : []
  sessions = sessions.filter((s) => s.id !== entry.id)
  sessions.unshift(entry)
  sessions.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
  if (sessions.length > HISTORY_LIMIT) sessions = sessions.slice(0, HISTORY_LIMIT)
  await setDoc(ref, {
    batchId,
    sessions,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  })
  return sessions
}

/**
 * All previous sessions for this batch, newest first — one Firestore read.
 * Scoped by construction: the path itself contains the batch id.
 */
export async function listSessionHistory(batchId) {
  if (!batchId) return []
  const snap = await getDoc(historyRef(batchId))
  if (!snap.exists()) return []
  const sessions = [...(snap.data().sessions || [])]
  sessions.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
  return sessions
}

/** @deprecated use listSessionHistory */
export const listSessionMetas = listSessionHistory

/**
 * Export saves: keep ONLY the pages/decks included in that export.
 * Idle saves: keep the full live board (for auto-restore on the next Teach).
 */
function boardForReason(boardState, reason, exportedThrough) {
  const pagesIn = boardState.pages || []
  const decksIn = boardState.decks || []

  if (reason === 'export') {
    const end = Math.min(exportedThrough ?? -1, pagesIn.length - 1)
    if (end < 0) {
      return { pages: [], decks: [], current: -1, exportedThrough: -1, status: 'complete' }
    }
    const pages = pagesIn.slice(0, end + 1)
    const needed = new Set(pages.map((p) => p.deckId).filter((id) => id != null))
    const decks = decksIn.filter((d) => needed.has(d.id))
    return {
      pages,
      decks,
      current: Math.min(boardState.current ?? 0, end),
      // Every page in this snapshot was exported.
      exportedThrough: pages.length - 1,
      status: 'complete',
    }
  }

  // timeout (and any other full-board persist): store everything
  return {
    pages: pagesIn,
    decks: decksIn,
    current: boardState.current ?? -1,
    exportedThrough: exportedThrough ?? -1,
    status: reason === 'timeout' ? 'timeout' : undefined,
  }
}

/**
 * A deck as the session records it: a pointer into the content registry.
 * `text` is deliberately absent — that is the whole change.
 */
function deckReference(d, pageStart) {
  return {
    id: d.id,
    code: d.code || null,
    version: d.version || null,
    name: d.name || 'Deck',
    tag: d.tag || null,
    count: d.count || 0,
    // Provenance only — never used to re-fetch live library content.
    folderId: d.folderId || null,
    classId: d.classId || null,
    chapterId: d.chapterId || null,
    pageStart: pageStart < 0 ? 0 : pageStart,
  }
}

/** Ink + frozen slide for one page, plus which deck page it sat on. */
function pageRecord(p) {
  return {
    strokes: p.strokes || [],
    snap: p.snap || null,
    paper: p.paper || 'dots',
    // The board serializes this and restoreSession reads it back; dropping it
    // here is why a page marked "skip" came back included in the next export.
    skipExport: !!p.skipExport,
    deckId: p.deckId ?? null,
    deckIndex: p.deckIndex ?? null,   // ← the page number inside that deck
    stepCount: p.stepCount || 0,
    stepIndex: p.stepIndex || 0,
  }
}

/**
 * Persist a teaching session. What lands in Firestore:
 *   decks → [{ code, version, name, … }]  a reference per deck
 *   pages → [{ deckId, deckIndex, strokes, snap }]  page number + ink
 *   history index → meta/sessionHistory (one-doc list)
 *
 * reason "export"  → only exported pages/decks
 * reason "timeout" → all pages/decks
 */
export async function saveTeachingSession(batchId, boardState, opts = {}) {
  if (!batchId) throw new Error('batchId is required to save a session')
  const now = Date.now()
  const id = opts.sessionId || makeId('sess')
  const reason = opts.reason || 'manual'

  const sliced = boardForReason(boardState, reason, opts.exportedThrough ?? -1)
  const pagesSrc = sliced.pages
  const decksSrc = sliced.decks
  const exportedThrough = sliced.exportedThrough
  const pageCount = pagesSrc.length

  let status = opts.status || sliced.status
  if (!status) {
    if (pageCount === 0) status = 'active'
    else if (exportedThrough >= pageCount - 1) status = 'complete'
    else if (exportedThrough >= 0) status = 'partial'
    else status = 'active'
  }

  const decks = decksSrc.map((d) =>
    deckReference(d, pagesSrc.findIndex((p) => p.deckId === d.id)),
  )
  const pages = pagesSrc.map(pageRecord)

  // A deck the board holds but the registry never saw (an upload that failed to
  // register) would come back blank. Say so now, in the console, rather than at
  // the worst possible moment three weeks later.
  const orphan = decks.filter((d) => !d.code)
  if (orphan.length) {
    console.warn(
      'Session saved with unregistered decks — they will not reload:',
      orphan.map((d) => d.name),
    )
  }

  const title = opts.title || decks[0]?.name || `Session ${new Date(now).toLocaleString()}`
  const createdAt = opts.createdAt || now

  const base = {
    id,
    batchId,
    schema: 2,               // 2 = decks are code references, no inline HTML
    // Which coordinate system the ink is in (the panel's BOARD_V). v2 stores
    // board fractions; v1 stored raw pixels from whatever screen drew them.
    // This MUST round-trip: the panel divides a v1 payload down by the current
    // board, so a v2 board restored without its version is divided a second
    // time and every stroke collapses into a speck in the top-left corner.
    boardVersion: Number(boardState.v) || 1,
    status,
    title,
    pageCount,
    current: sliced.current,
    currentPage: sliced.current,
    exportedThrough,
    decks,
    deckNames: decks.map((d) => d.name),
    deckCodes: decks.map((d) => d.code).filter(Boolean),
    fileCount: decks.length,
    reason,
    createdAt,
    createdAtMs: createdAt,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
  }

  // Ink and frozen slides are the only bulk left. Almost always inline; a very
  // long lecture with many frozen slides spills into chunks/ instead of failing.
  const pagesJson = JSON.stringify(pages)
  if (pagesJson.length <= INLINE_PAGES_MAX) {
    await setDoc(sessionRef(batchId, id), { ...base, pages, pageChunks: 0 })
  } else {
    const parts = []
    for (let i = 0; i < pagesJson.length; i += CHUNK_CHARS) {
      parts.push(pagesJson.slice(i, i + CHUNK_CHARS))
    }

    // The chunks go FIRST, and the session document that points at them last.
    //
    // It used to be the other way round, and the order is the whole story: a
    // session doc saying `pageChunks: 12` is a promise that twelve chunks
    // exist. Written before them, any failure in between — a lecture theatre
    // dropping its wifi, or the batch below being too large — left that
    // promise permanently broken. readSessionPages then joins nothing, throws
    // inside JSON.parse, and returns []; the lecture shows up in history with
    // its real page count and opens completely empty. persistBoard logs the
    // throw to the console and the teacher is never told.
    //
    // Written in this order the worst case is a session doc that never
    // appears — the board is still on screen, still in the local snapshot,
    // and the next save writes it again. Nothing claims to hold work it lost.
    //
    // Chunks also go in batches of their own rather than one. Firestore caps
    // a write request at about 10 MiB, so at 700 KB a chunk the single batch
    // broke somewhere past fifteen of them — which is exactly a long, heavily
    // inked lecture, the one worth keeping most.
    const PER_BATCH = 8                                  // ≈5.6 MB per request
    for (let i = 0; i < parts.length; i += PER_BATCH) {
      const wb = writeBatch(db)
      parts.slice(i, i + PER_BATCH)
        .forEach((text, k) => wb.set(chunkRef(batchId, id, i + k), { i: i + k, text }))
      await wb.commit()
    }
    await setDoc(sessionRef(batchId, id), { ...base, pages: null, pageChunks: parts.length })
  }

  // The local snapshot keeps deck text so a crashed tab can restore instantly;
  // it is a cache, and it is keyed to this batch.
  const textByDeckId = new Map(decksSrc.map((d) => [d.id, d.text || '']))
  const snapshot = {
    id,
    batchId,
    v: base.boardVersion,
    status,
    title,
    updatedAt: now,
    createdAt,
    current: sliced.current,
    exportedThrough,
    decks: decks.map((d) => ({ ...d, text: textByDeckId.get(d.id) || '' })),
    pages,
    reason,
  }

  await upsertSessionHistory(batchId, snapshot)
  try {
    await saveSnapshotLocal(snapshot)
  } catch (err) {
    console.warn('Local session cache write failed:', err)
  }
  return snapshot
}

/** Pull `pages` back, whether it was inline or spilled into chunks/. */
async function readSessionPages(batchId, sessionId, data) {
  if (Array.isArray(data.pages)) return data.pages
  const n = data.pageChunks || 0
  if (!n) return []
  const snap = await getDocs(chunksCol(batchId, sessionId))
  const found = snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.i || 0) - (b.i || 0))

  // A gap here is not a parse problem, and reporting it as one is how a
  // half-written session used to read back as an ordinary empty board. Say
  // what actually happened, loudly enough to be found in a bug report.
  if (found.length !== n) {
    console.error(
      `Session ${sessionId}: expected ${n} page chunk${n === 1 ? '' : 's'}, found ${found.length}. ` +
      'The board this session recorded is incomplete and cannot be restored.')
    return []
  }

  try {
    return JSON.parse(found.map((p) => p.text || '').join(''))
  } catch (err) {
    console.error(`Session ${sessionId}: page chunks are present but do not parse.`, err)
    return []
  }
}

/**
 * Load a full session: the board from this batch, the deck HTML from the
 * content registry at the exact version each deck was taught at.
 */
export async function loadSessionForReview(batchId, sessionId) {
  if (!batchId || !sessionId) return null
  try {
    const sSnap = await getDoc(sessionRef(batchId, sessionId))
    if (sSnap.exists()) {
      const data = sSnap.data()
      const deckRefs = data.decks || []
      const pages = await readSessionPages(batchId, sessionId, data)

      // One fetch per distinct (code, version), shared across decks and cached
      // in IndexedDB — replaying last month's lecture is usually zero reads.
      const contents = await readContentMany(deckRefs)
      const missing = []
      const decks = deckRefs.map((d) => {
        const key = `${d.code}@${d.version || 'cur'}`
        const c = d.code ? contents.get(key) : null
        if (d.code && !c) missing.push(d.name || d.code)
        return {
          id: d.id,
          code: d.code || null,
          version: c?.version ?? d.version ?? null,
          name: d.name || 'Deck',
          tag: d.tag || null,
          count: d.count || c?.pageCount || 0,
          folderId: d.folderId || null,
          classId: d.classId || null,
          chapterId: d.chapterId || null,
          pageStart: d.pageStart ?? 0,
          text: c?.html || '',
        }
      })

      const snapshot = {
        id: sessionId,
        batchId,
        // Anything written before boards were versioned is v1 pixels.
        v: data.boardVersion || 1,
        status: data.status,
        title: data.title,
        createdAt: data.createdAtMs || data.createdAt || Date.now(),
        updatedAt: data.updatedAtMs || Date.now(),
        current: data.current ?? data.currentPage ?? -1,
        exportedThrough: data.exportedThrough ?? -1,
        decks,
        pages,
        reason: data.reason || 'manual',
        missingContent: missing,
      }
      try { await saveSnapshotLocal(snapshot) } catch { /* cache optional */ }
      return snapshot
    }
  } catch (err) {
    console.warn('Firestore session load failed, trying local cache:', err)
  }
  // Batch-scoped: a cached board from another batch is never a valid answer.
  return getSnapshotLocal(batchId, sessionId)
}

/**
 * The board to put back on screen when a lecture is resumed: THE WHOLE THING.
 *
 * This used to hand back only the unexported tail, renumbered from
 * `exportedThrough + 1` down to zero. A ten-page lesson where six pages had
 * already gone out as a PDF came back as a four-page board, and the six pages
 * — with the ink drawn over them — were reachable only through Old Sessions.
 * That is not how the lesson is taught: the earlier pages are what the class
 * refers back to, and their ink is part of the explanation.
 *
 * So every page and every deck comes back, in the numbering the session was
 * saved under, with `exportedThrough` intact. Nothing is renumbered, which
 * means the export mark still describes these exact pages and the caller can
 * inherit it as-is. The board opens on the first page that was NOT exported —
 * where the teacher actually stopped.
 *
 * Returns null only when there is nothing to put back (no pages at all).
 */
export function unfinishedRestorePayload(snapshot) {
  if (!snapshot?.pages?.length) return null
  const exportedThrough = snapshot.exportedThrough ?? -1

  const pages = snapshot.pages.map((p) => ({
    strokes: (p.strokes || []).map((s) => ({
      ...s,
      pts: (s.pts || []).map((pt) => ({ ...pt })),
    })),
    snap: p.snap ? { ...p.snap } : null,
    paper: p.paper || 'dots',
    skipExport: !!p.skipExport,
    deckId: p.deckId ?? null,
    deckIndex: p.deckIndex ?? null,
    stepCount: p.stepCount || 0,
    stepIndex: p.stepIndex || 0,
  }))

  // Every deck the board references — a page whose deck was filtered out
  // restores as ink floating over an empty slide.
  const usedDeckIds = new Set(pages.map((p) => p.deckId).filter((id) => id != null))
  const decks = (snapshot.decks || []).filter(
    (d) => usedDeckIds.has(d.id) || usedDeckIds.size === 0,
  )

  const firstUnexported = exportedThrough + 1
  return {
    sessionId: snapshot.id,
    batchId: snapshot.batchId,
    // Carried through, or the panel reads these fractions as pixels.
    v: snapshot.v || 1,
    decks,
    pages,
    // Land where the lecture stopped, with the exported pages behind it.
    current: Math.min(Math.max(0, firstUnexported), pages.length - 1),
    exportedThrough,
    sourceExportedThrough: exportedThrough,
    // Page numbers are the session's own, so the export mark still fits.
    renumbered: false,
  }
}

/** Latest unfinished session IN THIS BATCH — history is one read, then one load. */
export async function findUnfinishedSession(batchId) {
  if (!batchId) return null
  const history = await listSessionHistory(batchId)
  for (const entry of history) {
    if (entry.status === 'complete') continue
    const pageCount = entry.pageCount || 0
    const exportedThrough = entry.exportedThrough ?? -1
    if (pageCount > 0 && exportedThrough >= pageCount - 1) continue

    const snapshot = await loadSessionForReview(batchId, entry.id)
    if (!snapshot) continue
    if (snapshot.batchId && snapshot.batchId !== batchId) continue
    const payload = unfinishedRestorePayload(snapshot)
    if (payload) return { snapshot, payload }
  }

  // Local-only leftovers (never synced) — this batch's only.
  const locals = await listSnapshotsLocal(batchId)
  for (const snap of locals) {
    if (snap.status === 'complete') continue
    if (snap.batchId !== batchId) continue
    // Same test the history loop applies: a board that went out in full is
    // finished, even though the payload below would happily rebuild it.
    const n = snap.pages?.length || 0
    if (n > 0 && (snap.exportedThrough ?? -1) >= n - 1) continue
    const payload = unfinishedRestorePayload(snap)
    if (payload) return { snapshot: snap, payload }
  }
  return null
}

/**
 * What the "pick up where you left off?" prompt needs to say, in numbers.
 * Kept here so the host and the panel cannot disagree about the counts.
 */
export function restoreSummary(snapshot, payload) {
  const total = payload?.pages?.length || 0
  const exported = Math.min(Math.max((payload?.exportedThrough ?? -1) + 1, 0), total)
  return {
    title: snapshot?.title || 'your last session',
    total,
    exported,
    unexported: total - exported,
    deckNames: (payload?.decks || []).map((d) => d.name).filter(Boolean),
    at: snapshot?.updatedAt || snapshot?.createdAt || null,
  }
}

export function sessionStatusLabel(status) {
  switch (status) {
    case 'complete': return 'Exported'
    case 'partial': return 'Partially exported'
    case 'timeout': return 'Auto-saved (idle)'
    case 'active': return 'In progress'
    default: return status || 'Unknown'
  }
}

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
    await setDoc(sessionRef(batchId, id), { ...base, pages: null, pageChunks: parts.length })
    const wb = writeBatch(db)
    parts.forEach((text, i) => wb.set(chunkRef(batchId, id, i), { i, text }))
    await wb.commit()
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
  const text = snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.i || 0) - (b.i || 0))
    .map((p) => p.text || '')
    .join('')
  try {
    return JSON.parse(text)
  } catch (err) {
    console.warn('Session pages could not be parsed:', err)
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

export function unfinishedRestorePayload(snapshot) {
  if (!snapshot?.pages?.length) return null
  const exportedThrough = snapshot.exportedThrough ?? -1
  if (exportedThrough >= snapshot.pages.length - 1) return null

  const keepIdx = []
  for (let i = 0; i < snapshot.pages.length; i++) {
    if (i > exportedThrough) keepIdx.push(i)
  }
  if (!keepIdx.length) return null

  const neededDeckIds = new Set(
    keepIdx.map((i) => snapshot.pages[i].deckId).filter((id) => id != null),
  )
  const decks = (snapshot.decks || []).filter((d) => neededDeckIds.has(d.id))
  const pages = keepIdx.map((i) => {
    const p = snapshot.pages[i]
    return {
      strokes: (p.strokes || []).map((s) => ({
        ...s,
        pts: (s.pts || []).map((pt) => ({ ...pt })),
      })),
      snap: p.snap ? { ...p.snap } : null,
      paper: p.paper || 'dots',
      deckId: p.deckId ?? null,
      deckIndex: p.deckIndex ?? null,
      stepCount: p.stepCount || 0,
      stepIndex: p.stepIndex || 0,
    }
  })

  return {
    sessionId: snapshot.id,
    batchId: snapshot.batchId,
    // Carried through, or the panel reads these fractions as pixels.
    v: snapshot.v || 1,
    decks,
    pages,
    current: 0,
    sourceExportedThrough: exportedThrough,
    // These pages were renumbered from `exportedThrough + 1` down to 0, so the
    // source session's export mark no longer describes them at all.
    renumbered: true,
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
    const payload = unfinishedRestorePayload(snap)
    if (payload) return { snapshot: snap, payload }
  }
  return null
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

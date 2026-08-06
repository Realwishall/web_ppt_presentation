// Teaching session storage (Firestore-first):
//
//   batches/{batchId}/meta/sessionHistory
//       ← ONE document with lightweight entries for EVERY session
//         (id, title, status, times, pageCount, …). Old Sessions lists
//         everything with a single getDoc — even at ~1000 sessions.
//   batches/{batchId}/sessions/{sessionId}
//       ← board: pages + strokes + file refs (loaded only when opened)
//   batches/{batchId}/sessions/{sessionId}/files/{fileId}
//       ← immutable HTML snapshot of each deck used
//
// IndexedDB is only a local write-through cache for faster restore.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { makeId } from './content'

const IDB_NAME = 'lf-sessions'
const IDB_STORE = 'snapshots'
const IDB_VERSION = 1
/** Cap on entries in the single history doc (~0.5 KB each → well under 1 MB). */
const HISTORY_LIMIT = 1000
/** Keep each Firestore doc comfortably under the 1 MB ceiling. */
const FILE_CHUNK_CHARS = 700_000

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

export async function saveSnapshotLocal(snapshot) {
  const dbx = await openIdb()
  try {
    const tx = dbx.transaction(IDB_STORE, 'readwrite')
    await idbReq(tx.objectStore(IDB_STORE).put(snapshot))
  } finally {
    dbx.close()
  }
}

export async function getSnapshotLocal(sessionId) {
  const dbx = await openIdb()
  try {
    const tx = dbx.transaction(IDB_STORE, 'readonly')
    return (await idbReq(tx.objectStore(IDB_STORE).get(sessionId))) || null
  } finally {
    dbx.close()
  }
}

export async function listSnapshotsLocal(batchId) {
  const dbx = await openIdb()
  try {
    const tx = dbx.transaction(IDB_STORE, 'readonly')
    const rows = await idbReq(tx.objectStore(IDB_STORE).index('batchId').getAll(batchId))
    return (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } finally {
    dbx.close()
  }
}

function historyRef(batchId) {
  return doc(db, 'batches', batchId, 'meta', 'sessionHistory')
}

function sessionRef(batchId, sessionId) {
  return doc(db, 'batches', batchId, 'sessions', sessionId)
}

function fileRef(batchId, sessionId, fileId) {
  return doc(db, 'batches', batchId, 'sessions', sessionId, 'files', fileId)
}

function filePartRef(batchId, sessionId, fileId, part) {
  return doc(db, 'batches', batchId, 'sessions', sessionId, 'files', fileId, 'parts', String(part))
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
 * Full board/files are loaded later only when a row is opened.
 */
export async function listSessionHistory(batchId) {
  const snap = await getDoc(historyRef(batchId))
  if (!snap.exists()) return []
  const sessions = [...(snap.data().sessions || [])]
  sessions.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
  return sessions
}

/** @deprecated use listSessionHistory */
export const listSessionMetas = listSessionHistory

/** Write one deck HTML into the session's files/ folder (chunked if large). */
async function writeSessionFile(batchId, sessionId, file) {
  const text = file.text || ''
  const base = {
    id: file.id,
    name: file.name || 'Deck',
    tag: file.tag || null,
    count: file.count || 0,
    // Provenance only — never used to re-fetch live library content.
    sourceFolderId: file.sourceFolderId || null,
  }

  if (text.length <= FILE_CHUNK_CHARS) {
    await setDoc(fileRef(batchId, sessionId, file.id), {
      ...base,
      text,
      chunkCount: 1,
    })
    return
  }

  const parts = []
  for (let i = 0; i < text.length; i += FILE_CHUNK_CHARS) {
    parts.push(text.slice(i, i + FILE_CHUNK_CHARS))
  }
  await setDoc(fileRef(batchId, sessionId, file.id), {
    ...base,
    text: null,
    chunkCount: parts.length,
  })
  const batch = writeBatch(db)
  parts.forEach((chunk, i) => {
    batch.set(filePartRef(batchId, sessionId, file.id, i), { i, text: chunk })
  })
  await batch.commit()
}

async function readSessionFile(batchId, sessionId, fileId) {
  const fSnap = await getDoc(fileRef(batchId, sessionId, fileId))
  if (!fSnap.exists()) return null
  const data = fSnap.data()
  let text = data.text || ''
  const chunkCount = data.chunkCount || 1
  if (!text && chunkCount > 1) {
    const parts = await getDocs(collection(db, 'batches', batchId, 'sessions', sessionId, 'files', fileId, 'parts'))
    const ordered = parts.docs
      .map((d) => d.data())
      .sort((a, b) => (a.i || 0) - (b.i || 0))
    text = ordered.map((p) => p.text || '').join('')
  }
  return {
    id: data.id || fileId,
    name: data.name || 'Deck',
    tag: data.tag || null,
    count: data.count || 0,
    text,
    sourceFolderId: data.sourceFolderId || null,
  }
}

/**
 * Export saves: keep ONLY the pages/files included in that export.
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
 * Persist a teaching session:
 *  - each deck HTML → sessions/{id}/files/{fileId} (immutable copy)
 *  - board/pages/strokes → sessions/{id}
 *  - history index → meta/sessionHistory (one-doc list)
 *
 * reason "export"  → only exported pages/files
 * reason "timeout" → all pages/files
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

  // Snapshot every (included) deck into its own file document under this session.
  const decks = []
  for (const d of decksSrc) {
    const pageStart = pagesSrc.findIndex((p) => p.deckId === d.id)
    const fileId = d.fileId || `file_${d.id}`
    await writeSessionFile(batchId, id, {
      id: fileId,
      text: d.text || '',
      name: d.name || 'Deck',
      tag: d.tag || null,
      count: d.count || 0,
      sourceFolderId: d.folderId || null,
    })
    decks.push({
      id: d.id,
      fileId,
      name: d.name || 'Deck',
      tag: d.tag || null,
      count: d.count || 0,
      pageStart: pageStart < 0 ? 0 : pageStart,
    })
  }

  const pages = pagesSrc.map((p) => ({
    strokes: p.strokes || [],
    snap: p.snap || null,
    deckId: p.deckId ?? null,
    deckIndex: p.deckIndex ?? null,
    stepCount: p.stepCount || 0,
    stepIndex: p.stepIndex || 0,
  }))

  const title = opts.title || decks[0]?.name || `Session ${new Date(now).toLocaleString()}`
  const createdAt = opts.createdAt || now

  // Board doc — no HTML payloads (those live under files/).
  await setDoc(sessionRef(batchId, id), {
    id,
    batchId,
    status,
    title,
    pageCount,
    current: sliced.current,
    currentPage: sliced.current,
    exportedThrough,
    decks,
    deckNames: decks.map((d) => d.name),
    fileCount: decks.length,
    pages,
    reason,
    createdAt,
    createdAtMs: createdAt,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
  })

  const textByDeckId = new Map(decksSrc.map((d) => [d.id, d.text || '']))
  const snapshot = {
    id,
    batchId,
    status,
    title,
    updatedAt: now,
    createdAt,
    current: sliced.current,
    exportedThrough,
    decks: decks.map((d) => ({
      ...d,
      text: textByDeckId.get(d.id) || '',
    })),
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

/**
 * Load a full session (board + file HTML) from Firestore.
 * Uses IndexedDB only as a warm cache when the remote read is unavailable.
 */
export async function loadSessionForReview(batchId, sessionId) {
  try {
    const sSnap = await getDoc(sessionRef(batchId, sessionId))
    if (sSnap.exists()) {
      const data = sSnap.data()
      const decks = []
      for (const d of data.decks || []) {
        const fileId = d.fileId || `file_${d.id}`
        const file = await readSessionFile(batchId, sessionId, fileId)
        decks.push({
          id: d.id,
          fileId,
          name: d.name || file?.name || 'Deck',
          tag: d.tag || file?.tag || null,
          count: d.count || file?.count || 0,
          pageStart: d.pageStart ?? 0,
          text: file?.text || '',
        })
      }
      const snapshot = {
        id: sessionId,
        batchId,
        status: data.status,
        title: data.title,
        createdAt: data.createdAtMs || data.createdAt || Date.now(),
        updatedAt: data.updatedAtMs || Date.now(),
        current: data.current ?? data.currentPage ?? -1,
        exportedThrough: data.exportedThrough ?? -1,
        decks,
        pages: data.pages || [],
        reason: data.reason || 'manual',
      }
      try { await saveSnapshotLocal(snapshot) } catch { /* cache optional */ }
      return snapshot
    }
  } catch (err) {
    console.warn('Firestore session load failed, trying local cache:', err)
  }
  return getSnapshotLocal(sessionId)
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
      deckId: p.deckId ?? null,
      deckIndex: p.deckIndex ?? null,
      stepCount: p.stepCount || 0,
      stepIndex: p.stepIndex || 0,
    }
  })

  return {
    sessionId: snapshot.id,
    decks,
    pages,
    current: 0,
    sourceExportedThrough: exportedThrough,
  }
}

/** Latest unfinished session — history is one read, then one session load. */
export async function findUnfinishedSession(batchId) {
  const history = await listSessionHistory(batchId)
  for (const entry of history) {
    if (entry.status === 'complete') continue
    const pageCount = entry.pageCount || 0
    const exportedThrough = entry.exportedThrough ?? -1
    if (pageCount > 0 && exportedThrough >= pageCount - 1) continue

    const snapshot = await loadSessionForReview(batchId, entry.id)
    if (!snapshot) continue
    const payload = unfinishedRestorePayload(snapshot)
    if (payload) return { snapshot, payload }
  }

  // Local-only leftovers (never synced).
  const locals = await listSnapshotsLocal(batchId)
  for (const snap of locals) {
    if (snap.status === 'complete') continue
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

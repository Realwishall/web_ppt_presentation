// Teaching session history: Firestore holds a lightweight index per batch;
// IndexedDB holds the full board snapshot (deck HTML + stroke vectors).
// Stroke-heavy payloads routinely exceed Firestore's 1 MB doc limit, so the
// split keeps Old Sessions listable while still restoring ink locally.

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { makeId } from './content'

const IDB_NAME = 'lf-sessions'
const IDB_STORE = 'snapshots'
const IDB_VERSION = 1

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' })
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
  const db = await openIdb()
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    await idbReq(tx.objectStore(IDB_STORE).put(snapshot))
  } finally {
    db.close()
  }
}

export async function getSnapshotLocal(sessionId) {
  const db = await openIdb()
  try {
    const tx = db.transaction(IDB_STORE, 'readonly')
    return (await idbReq(tx.objectStore(IDB_STORE).get(sessionId))) || null
  } finally {
    db.close()
  }
}

export async function listSnapshotsLocal(batchId) {
  const db = await openIdb()
  try {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const store = tx.objectStore(IDB_STORE)
    const idx = store.index('batchId')
    const rows = await idbReq(idx.getAll(batchId))
    return (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } finally {
    db.close()
  }
}

/** Lightweight Firestore index entry — no HTML, no stroke points. */
function metaFromSnapshot(snap) {
  return {
    id: snap.id,
    batchId: snap.batchId,
    status: snap.status,
    title: snap.title || 'Teaching session',
    pageCount: snap.pages?.length || 0,
    currentPage: snap.current ?? -1,
    exportedThrough: snap.exportedThrough ?? -1,
    deckNames: (snap.decks || []).map((d) => d.name).filter(Boolean),
    folderSummaries: (snap.decks || []).map((d) => ({
      folderId: d.folderId || null,
      name: d.name || 'Deck',
      tag: d.tag || null,
      pageStart: d.pageStart ?? 0,
      pageCount: d.count || 0,
    })),
  }
}

export async function upsertSessionMeta(batchId, snap) {
  const meta = metaFromSnapshot(snap)
  const ref = doc(db, 'batches', batchId, 'sessions', snap.id)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    await updateDoc(ref, { ...meta, updatedAt: serverTimestamp() })
  } else {
    await setDoc(ref, { ...meta, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  }
  return meta
}

export async function listSessionMetas(batchId) {
  try {
    const q = query(
      collection(db, 'batches', batchId, 'sessions'),
      orderBy('updatedAt', 'desc'),
      limit(50),
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch {
    // Fallback if the composite index isn't ready yet — unsorted local read.
    const snap = await getDocs(collection(db, 'batches', batchId, 'sessions'))
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.updatedAt?.toMillis?.() || a.updatedAt || 0
        const tb = b.updatedAt?.toMillis?.() || b.updatedAt || 0
        return tb - ta
      })
  }
}

/** Persist a full board snapshot locally and mirror its index to Firestore. */
export async function saveTeachingSession(batchId, boardState, opts = {}) {
  if (!batchId) throw new Error('batchId is required to save a session')
  const now = Date.now()
  const id = opts.sessionId || makeId('sess')
  const exportedThrough = opts.exportedThrough ?? -1
  const pageCount = boardState.pages?.length || 0
  let status = opts.status
  if (!status) {
    if (pageCount === 0) status = 'active'
    else if (exportedThrough >= pageCount - 1) status = 'complete'
    else if (exportedThrough >= 0) status = 'partial'
    else status = 'active'
  }

  // Annotate each deck with where its pages sit in the flat page list.
  const decks = (boardState.decks || []).map((d) => {
    const pageStart = (boardState.pages || []).findIndex((p) => p.deckId === d.id)
    return {
      id: d.id,
      text: d.text,
      name: d.name || 'Deck',
      count: d.count,
      folderId: d.folderId || null,
      classId: d.classId || null,
      chapterId: d.chapterId || null,
      tag: d.tag || null,
      pageStart: pageStart < 0 ? 0 : pageStart,
    }
  })

  const snapshot = {
    id,
    batchId,
    status,
    title: opts.title || decks[0]?.name || `Session ${new Date(now).toLocaleString()}`,
    updatedAt: now,
    createdAt: opts.createdAt || now,
    current: boardState.current ?? -1,
    exportedThrough,
    decks,
    // Drop undo stacks — they are runtime-only and balloon the payload.
    pages: (boardState.pages || []).map((p) => ({
      strokes: p.strokes || [],
      snap: p.snap || null,
      deckId: p.deckId ?? null,
      deckIndex: p.deckIndex ?? null,
      stepCount: p.stepCount || 0,
      stepIndex: p.stepIndex || 0,
    })),
    reason: opts.reason || 'manual',
  }

  await saveSnapshotLocal(snapshot)
  try {
    await upsertSessionMeta(batchId, snapshot)
  } catch (err) {
    console.warn('Session meta write failed (local snapshot kept):', err)
  }
  return snapshot
}

/**
 * Build a restore payload from a saved snapshot: only decks/pages that were
 * not fully exported (or that were only partially exported), including strokes.
 */
export function unfinishedRestorePayload(snapshot) {
  if (!snapshot?.pages?.length) return null
  const exportedThrough = snapshot.exportedThrough ?? -1
  if (exportedThrough >= snapshot.pages.length - 1) return null // fully exported

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

/** Latest session for a batch that still has unexported (or partial) pages. */
export async function findUnfinishedSession(batchId) {
  const locals = await listSnapshotsLocal(batchId)
  for (const snap of locals) {
    if (snap.status === 'complete') continue
    const payload = unfinishedRestorePayload(snap)
    if (payload) return { snapshot: snap, payload }
  }
  // Firestore may know about a session whose local snapshot is gone — skip restore.
  return null
}

export async function loadSessionForReview(batchId, sessionId) {
  const local = await getSnapshotLocal(sessionId)
  if (local) return local
  return null
}

export function sessionStatusLabel(status) {
  switch (status) {
    case 'complete': return 'Exported'
    case 'partial': return 'Partially exported'
    case 'timeout': return 'Auto-saved (timeout)'
    case 'active': return 'In progress'
    default: return status || 'Unknown'
  }
}

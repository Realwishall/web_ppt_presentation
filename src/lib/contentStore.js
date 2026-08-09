// ─────────────────────────────────────────────────────────────────────────────
// THE CONTENT REGISTRY — one permanent home for every HTML deck THIS USER owns.
//
//   users/{uid}/content/{code}      { name, tag, visible, currentVersion, … }
//     └─ versions/{v}               { pageCount, chunkCount, text? }   IMMUTABLE
//          └─ parts/{i}             { i, text }        (only when text > 700 KB)
//
// The registry is per-user: a code is unique within one account, not across
// the deployment, so two teachers can independently hold the same code and
// never see each other's bytes. The local caches below are keyed by uid for
// exactly that reason.
//
// A `code` is minted once, when an HTML page file first enters the system, and
// never changes or disappears. Editing the deck writes a NEW version; nothing
// is ever overwritten, so a teaching session that pinned `code@2` keeps showing
// exactly the slides its ink was drawn over even after the folder is edited to
// version 7.
//
// Nothing here is ever hard-deleted. "Deleting" content flips `visible` to
// false: it leaves the Library, and every old session that references it keeps
// working. That is the whole point of the code — a session stores a reference,
// not a copy.
//
// Versions are immutable, so they are cached in IndexedDB forever and a second
// Teach of the same deck costs zero Firestore reads.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  runTransaction,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { ucol, udoc, uid } from './userScope'

/** Keep each Firestore doc comfortably under the 1 MB ceiling. */
const CHUNK_CHARS = 700_000

/** No 0/O/1/I/L — a code is meant to be read aloud and typed. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_GROUPS = 2
const CODE_GROUP_LEN = 4

const IDB_NAME = 'lf-content'
const IDB_STORE = 'versions'
const IDB_VERSION = 1

// ── code minting ────────────────────────────────────────────────────────────

function randomCode() {
  const bytes = new Uint8Array(CODE_GROUPS * CODE_GROUP_LEN)
  crypto.getRandomValues(bytes)
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  const groups = []
  for (let i = 0; i < CODE_GROUPS; i++) {
    groups.push(chars.slice(i * CODE_GROUP_LEN, (i + 1) * CODE_GROUP_LEN).join(''))
  }
  return groups.join('-')
}

/** A code nobody else holds. 31^8 ≈ 8.5e11, so the loop effectively runs once. */
export async function reserveContentCode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const existing = await getDoc(contentRef(code))
    if (!existing.exists()) return code
  }
  throw new Error('Could not mint a unique content code — try again.')
}

export function isContentCode(v) {
  return typeof v === 'string' && /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(v)
}

// ── refs ────────────────────────────────────────────────────────────────────

const contentRef = (code) => udoc('content', code)
const versionRef = (code, v) => udoc('content', code, 'versions', String(v))
const partRef = (code, v, i) => udoc('content', code, 'versions', String(v), 'parts', String(i))
const partsCol = (code, v) => ucol('content', code, 'versions', String(v), 'parts')

// ── page counting ───────────────────────────────────────────────────────────

/** How many `<section class="page">` slides this HTML holds. */
export function countPages(html) {
  if (!html) return 0
  try {
    return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.page').length
  } catch {
    return 0
  }
}

// ── IndexedDB cache for immutable versions ──────────────────────────────────

const memCache = new Map() // `${uid}:${code}@${v}` → { html, pageCount }

/**
 * The cache key for one immutable version.
 *
 * The uid is part of the key because codes are only unique *within* an
 * account: two teachers can each hold `AB23-CD45` pointing at completely
 * different decks. Without the prefix, whoever loaded theirs first would win
 * the cache and the other would be taught the wrong slides — silently, since
 * an immutable version is never revalidated.
 */
const cacheKey = (code, v) => `${uid()}:${code}@${v}`

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const dbx = req.result
      if (!dbx.objectStoreNames.contains(IDB_STORE)) {
        dbx.createObjectStore(IDB_STORE, { keyPath: 'key' })
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

async function cacheGet(key) {
  if (memCache.has(key)) return memCache.get(key)
  try {
    const dbx = await openIdb()
    try {
      const tx = dbx.transaction(IDB_STORE, 'readonly')
      const row = await idbReq(tx.objectStore(IDB_STORE).get(key))
      if (row) {
        const value = { html: row.html, pageCount: row.pageCount }
        memCache.set(key, value)
        return value
      }
    } finally { dbx.close() }
  } catch { /* cache is optional */ }
  return null
}

async function cachePut(key, value) {
  memCache.set(key, value)
  try {
    const dbx = await openIdb()
    try {
      const tx = dbx.transaction(IDB_STORE, 'readwrite')
      await idbReq(tx.objectStore(IDB_STORE).put({ key, ...value, at: Date.now() }))
    } finally { dbx.close() }
  } catch { /* cache is optional */ }
}

// ── writing ─────────────────────────────────────────────────────────────────

/** Write one version's HTML, chunking anything past the doc-size ceiling. */
async function writeVersionBytes(code, v, html, pageCount) {
  const text = html || ''
  if (text.length <= CHUNK_CHARS) {
    await setDoc(versionRef(code, v), {
      v,
      pageCount,
      chars: text.length,
      chunkCount: 1,
      text,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
    })
    return
  }
  const parts = []
  for (let i = 0; i < text.length; i += CHUNK_CHARS) parts.push(text.slice(i, i + CHUNK_CHARS))
  await setDoc(versionRef(code, v), {
    v,
    pageCount,
    chars: text.length,
    chunkCount: parts.length,
    text: null,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  })
  const batch = writeBatch(db)
  parts.forEach((chunk, i) => batch.set(partRef(code, v, i), { i, text: chunk }))
  await batch.commit()
}

/**
 * Register an HTML page file for the first time: mints a code, writes v1.
 * `home` is only provenance — where in the Library it was first filed.
 */
export async function createContent({ name, tag, html, home = {}, origin = 'library' }) {
  const code = await reserveContentCode()
  const pageCount = countPages(html)
  const now = Date.now()

  // The meta doc exists before the bytes so a crash mid-write cannot mint the
  // same code twice; currentVersion stays 0 until v1 is durable.
  await setDoc(contentRef(code), {
    code,
    name: (name || 'Untitled deck').trim(),
    tag: tag || null,
    origin,
    visible: true,
    currentVersion: 0,
    pendingVersion: 1,
    pageCount,
    homeClassId: home.classId || null,
    homeChapterId: home.chapterId || null,
    homeFolderId: home.folderId || null,
    createdAt: serverTimestamp(),
    createdAtMs: now,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
  })

  await writeVersionBytes(code, 1, html, pageCount)
  await updateDoc(contentRef(code), {
    currentVersion: 1,
    pageCount,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
  })

  await cachePut(cacheKey(code, 1), { html: html || '', pageCount })
  return { code, version: 1, pageCount }
}

/**
 * Edit = a new immutable version. Old versions stay exactly as they were, so
 * sessions pinned to them are untouched.
 */
export async function addContentVersion(code, html, meta = {}) {
  const pageCount = countPages(html)
  const now = Date.now()

  // Reserve the number first; currentVersion only advances once the bytes land.
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(contentRef(code))
    if (!snap.exists()) throw new Error(`Unknown content code ${code}`)
    const d = snap.data()
    const n = Math.max(d.currentVersion || 0, d.pendingVersion || 0) + 1
    tx.update(contentRef(code), { pendingVersion: n })
    return n
  })

  await writeVersionBytes(code, next, html, pageCount)

  const patch = {
    currentVersion: next,
    pageCount,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
  }
  if (meta.name != null) patch.name = String(meta.name).trim()
  if (meta.tag != null) patch.tag = meta.tag
  await updateDoc(contentRef(code), patch)

  await cachePut(cacheKey(code, next), { html: html || '', pageCount })
  return { code, version: next, pageCount }
}

/** Rename / retag without minting a version — the bytes did not change. */
export async function updateContentMeta(code, data) {
  return updateDoc(contentRef(code), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  })
}

/**
 * Soft delete. The bytes and every version stay; the deck simply leaves the
 * Library. Old sessions that reference this code keep replaying perfectly.
 */
export const setContentVisible = (code, visible) =>
  updateContentMeta(code, { visible: !!visible, hiddenAtMs: visible ? null : Date.now() })

// ── reading ─────────────────────────────────────────────────────────────────

export async function getContentMeta(code) {
  const snap = await getDoc(contentRef(code))
  return snap.exists() ? snap.data() : null
}

/**
 * The HTML for one pinned version. `version` omitted → whatever is current.
 * Immutable, so a hit in the local cache never needs revalidating.
 */
export async function readContent(code, version) {
  if (!code) return null

  let v = version
  if (!v) {
    const meta = await getContentMeta(code)
    if (!meta) return null
    v = meta.currentVersion || 1
  }

  const key = cacheKey(code, v)
  const cached = await cacheGet(key)
  if (cached) return { code, version: v, html: cached.html, pageCount: cached.pageCount }

  const vSnap = await getDoc(versionRef(code, v))
  if (!vSnap.exists()) {
    // A pinned version that vanished (or a code written by an older build):
    // fall back to current rather than showing the teacher an empty board.
    if (version) {
      const meta = await getContentMeta(code)
      const cur = meta?.currentVersion
      if (cur && cur !== v) {
        const fallback = await readContent(code, cur)
        return fallback ? { ...fallback, pinnedVersionMissing: v } : null
      }
    }
    return null
  }

  const data = vSnap.data()
  let html = data.text || ''
  if (!html && (data.chunkCount || 1) > 1) {
    const parts = await getDocs(partsCol(code, v))
    html = parts.docs
      .map((d) => d.data())
      .sort((a, b) => (a.i || 0) - (b.i || 0))
      .map((p) => p.text || '')
      .join('')
  }

  const value = { html, pageCount: data.pageCount || countPages(html) }
  await cachePut(key, value)
  return { code, version: v, ...value }
}

/** Resolve many (code, version) pairs at once, de-duplicated. */
export async function readContentMany(refs) {
  const wanted = new Map()
  for (const r of refs) {
    if (!r?.code) continue
    const key = `${r.code}@${r.version || 'cur'}`
    if (!wanted.has(key)) wanted.set(key, r)
  }
  const out = new Map()
  await Promise.all(
    [...wanted.entries()].map(async ([key, r]) => {
      try {
        out.set(key, await readContent(r.code, r.version))
      } catch (err) {
        console.warn(`Content ${key} failed to load:`, err)
        out.set(key, null)
      }
    }),
  )
  return out
}

/** Every registered deck, newest first. `includeHidden` shows soft-deleted ones. */
export async function listContent({ includeHidden = false } = {}) {
  const snap = await getDocs(ucol('content'))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => includeHidden || c.visible !== false)
    .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
}

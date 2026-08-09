// Data layer for the authoring model — ALL OF IT UNDER ONE USER:
//
//   users/{uid}/classes/{classId}
//     └─ chapters/{chapterId}      { name, svgIcon, info, visible }
//          └─ folders/{folderId}   { name, tag, code, version, pageCount, visible }
//
// Every path below is built with the helpers in userScope.js, so one teacher's
// classes, chapters, folders and batches are invisible to another teacher
// signed into the same deployment.
//
// A "folder" is a *shelf label*, not the document. The HTML itself lives once
// in the content registry under a permanent code (see contentStore.js); the
// folder holds `code` plus the version it currently points at. Teaching a
// folder resolves the code to HTML; a session then stores only the code, the
// version, the page number and the ink.
//
// Nothing in this tree is hard-deleted. Deleting flips `visible` to false, so
// a session recorded months ago still resolves every reference it holds.

import {
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { ucol, udoc } from './userScope'
import {
  createContent,
  addContentVersion,
  updateContentMeta,
  setContentVisible,
  readContent,
} from './contentStore'

export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// Tags used to divide folders by difficulty (library multi-filter).
export const FOLDER_TAGS = ['Basic', 'Level 1.5', 'Level 2', 'Level 2.5', 'Advance', 'Olympiad']

/** Where decks uploaded straight from a laptop are filed. */
export const UPLOAD_CLASS_NAME = 'Random'
export const UPLOAD_TAG = 'Uploaded'

// A neutral gradient tile used as the default chapter icon.
export const DEFAULT_CHAPTER_SVG =
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#g)"/><circle cx="24" cy="24" r="10" fill="none" stroke="#fff" stroke-width="2.5"/></svg>'

// Starter HTML for a new folder: a working 2-slide deck in the presenter's
// `<section class="page">` format, including a `.step` reveal and a
// `.clickable` element (which receives real clicks through the ink layer).
export function defaultFolderHtml(name = 'New folder') {
  return `<style>
  .page{font-family:system-ui,'Segoe UI',sans-serif;color:#0f172a;height:100%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:18px;text-align:center;padding:6vmin;
    background:radial-gradient(circle at 30% 20%,#eef2ff,#faf5ff)}
  .page h1{margin:0;font-size:7vmin;background:linear-gradient(90deg,#6366f1,#8b5cf6);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .page p{margin:0;font-size:3.2vmin;color:#475569;max-width:70ch}
  .tag{font:600 2vmin system-ui;letter-spacing:.08em;text-transform:uppercase;
    color:#6366f1;background:#eef2ff;padding:.5em 1em;border-radius:999px}
  .btn{border:0;padding:.6em 1.2em;border-radius:12px;background:#4f46e5;color:#fff;
    font:700 3vmin system-ui;cursor:pointer}
</style>

<section class="page">
  <span class="tag">${escapeHtml(name)}</span>
  <h1>Title slide</h1>
  <p class="step">This line appears when you press <b>Next</b> (it has class <code>step</code>).</p>
</section>

<section class="page">
  <h1>Interactive slide</h1>
  <button class="btn clickable" onclick="this.textContent='v = '+(9.8).toFixed(1)+' m/s'">Tap me</button>
  <p>Elements with class <code>clickable</code> receive real taps during teaching.</p>
</section>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// Derive a folder name from an HTML document: prefer its <title>, then the
// first <h1>, else the given fallback. Used when importing HTML by drag-drop
// or paste so the new folder is named after the document itself.
export function extractHtmlTitle(html, fallback = 'Imported HTML') {
  if (!html) return fallback
  try {
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const title = dom.querySelector('title')?.textContent?.trim()
    if (title) return title
    const h1 = dom.querySelector('h1')?.textContent?.trim()
    if (h1) return h1
  } catch { /* fall through to fallback */ }
  return (fallback || 'Imported HTML').trim() || 'Imported HTML'
}

const bySortOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || '')

/** Hidden rows are soft-deleted: they stay readable by old sessions. */
const isVisible = (r) => r.visible !== false

async function listCol(path, { includeHidden = false } = {}) {
  const snap = await getDocs(ucol(...path))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => includeHidden || isVisible(r))
    .sort(bySortOrder)
}

// ---------- classes ----------
export const listClasses = (opts) => listCol(['classes'], opts)

export async function createClass(name, order = 0) {
  const id = makeId('class')
  await setDoc(udoc('classes', id), {
    id, name: name.trim(), order, visible: true, createdAt: serverTimestamp(),
  })
  return id
}
export const renameClass = (id, name) => updateDoc(udoc('classes', id), { name: name.trim() })

/** Soft delete — the class leaves the panel, its content keeps resolving. */
export const deleteClass = (id) =>
  updateDoc(udoc('classes', id), { visible: false, hiddenAtMs: Date.now() })
export const restoreClass = (id) =>
  updateDoc(udoc('classes', id), { visible: true, hiddenAtMs: null })

// ---------- chapters ----------
export const listChapters = (classId, opts) => listCol(['classes', classId, 'chapters'], opts)

export async function createChapter(classId, { name, svgIcon, info }, order = 0) {
  const id = makeId('chap')
  await setDoc(udoc('classes', classId, 'chapters', id), {
    id,
    name: (name || '').trim(),
    svgIcon: svgIcon || DEFAULT_CHAPTER_SVG,
    info: (info || '').trim(),
    order,
    visible: true,
    createdAt: serverTimestamp(),
  })
  return id
}
export const updateChapter = (classId, chapterId, data) =>
  updateDoc(udoc('classes', classId, 'chapters', chapterId), data)
export const deleteChapter = (classId, chapterId) =>
  updateDoc(udoc('classes', classId, 'chapters', chapterId), {
    visible: false, hiddenAtMs: Date.now(),
  })
export const restoreChapter = (classId, chapterId) =>
  updateDoc(udoc('classes', classId, 'chapters', chapterId), { visible: true, hiddenAtMs: null })

// ---------- folders ----------
const folderRef = (classId, chapterId, folderId) =>
  udoc('classes', classId, 'chapters', chapterId, 'folders', folderId)

export const listFolders = (classId, chapterId, opts) =>
  listCol(['classes', classId, 'chapters', chapterId, 'folders'], opts)

/**
 * A new folder mints a content code for its HTML. The folder row afterwards
 * carries only the reference — `code` plus the `version` it points at.
 */
export async function createFolder(classId, chapterId, { name, tag, html }, order = 0) {
  const id = makeId('folder')
  const cleanName = (name || 'New folder').trim()
  const cleanTag = tag || FOLDER_TAGS[0]
  const body = html ?? defaultFolderHtml(cleanName)

  const { code, version, pageCount } = await createContent({
    name: cleanName,
    tag: cleanTag,
    html: body,
    home: { classId, chapterId, folderId: id },
    origin: 'library',
  })

  await setDoc(folderRef(classId, chapterId, id), {
    id,
    name: cleanName,
    tag: cleanTag,
    code,
    version,
    pageCount,
    order,
    visible: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id, code, version }
}

/** The HTML behind a folder row, at the version the folder points at. */
export async function readFolderHtml(folder) {
  if (!folder?.code) return ''
  const c = await readContent(folder.code, folder.version)
  return c?.html || ''
}

/**
 * Save an edit. Changing the HTML mints a NEW version and re-points the
 * folder at it — every session pinned to an earlier version is untouched.
 */
export async function updateFolder(classId, chapterId, folderId, data) {
  const { html, ...rest } = data
  const patch = { ...rest, updatedAt: serverTimestamp() }

  if (html != null) {
    const snap = await getDoc(folderRef(classId, chapterId, folderId))
    const folder = snap.exists() ? snap.data() : null
    if (folder?.code) {
      const { version, pageCount } = await addContentVersion(folder.code, html, {
        name: rest.name ?? folder.name,
        tag: rest.tag ?? folder.tag,
      })
      patch.version = version
      patch.pageCount = pageCount
    } else {
      // A row that predates the registry: mint its code now.
      const { code, version, pageCount } = await createContent({
        name: rest.name ?? folder?.name ?? 'Deck',
        tag: rest.tag ?? folder?.tag ?? FOLDER_TAGS[0],
        html,
        home: { classId, chapterId, folderId },
        origin: 'library',
      })
      patch.code = code
      patch.version = version
      patch.pageCount = pageCount
    }
  } else if (rest.name != null || rest.tag != null) {
    // Metadata-only edit — no new version, but keep the registry label in sync.
    const snap = await getDoc(folderRef(classId, chapterId, folderId))
    const code = snap.exists() ? snap.data().code : null
    if (code) {
      const meta = {}
      if (rest.name != null) meta.name = rest.name
      if (rest.tag != null) meta.tag = rest.tag
      await updateContentMeta(code, meta).catch(() => {})
    }
  }

  return updateDoc(folderRef(classId, chapterId, folderId), patch)
}

/**
 * Soft delete. The folder leaves the Library and its content is marked hidden,
 * but neither is removed: sessions that taught this deck still replay it.
 */
export async function deleteFolder(classId, chapterId, folderId) {
  const snap = await getDoc(folderRef(classId, chapterId, folderId))
  const code = snap.exists() ? snap.data().code : null
  await updateDoc(folderRef(classId, chapterId, folderId), {
    visible: false,
    hiddenAtMs: Date.now(),
  })
  if (code) await setContentVisible(code, false).catch(() => {})
}

export async function restoreFolder(classId, chapterId, folderId) {
  const snap = await getDoc(folderRef(classId, chapterId, folderId))
  const code = snap.exists() ? snap.data().code : null
  await updateDoc(folderRef(classId, chapterId, folderId), { visible: true, hiddenAtMs: null })
  if (code) await setContentVisible(code, true).catch(() => {})
}

// Persist a new folder order in one write: `orderedIds` is the list as the
// teacher arranged it, and each folder's `order` becomes its index (what
// `bySortOrder` reads back).
export function reorderFolders(classId, chapterId, orderedIds) {
  const batch = writeBatch(db)
  orderedIds.forEach((folderId, order) => {
    batch.update(folderRef(classId, chapterId, folderId), { order })
  })
  return batch.commit()
}

// ---------- uploaded decks: class "Random" → chapter "MM-YYYY" ----------

/** "08-2026" — the month a laptop upload arrived. */
export function uploadChapterName(when = new Date()) {
  return `${String(when.getMonth() + 1).padStart(2, '0')}-${when.getFullYear()}`
}

/**
 * Find (or create) the shelf that decks uploaded from a laptop are filed on:
 * class "Random", chapter "MM-YYYY" for the current month. Uploads are real
 * library rows — visible, editable, teachable again next week.
 */
export async function ensureUploadHome(when = new Date()) {
  const classes = await listClasses({ includeHidden: true })
  let cls = classes.find((c) => (c.name || '').trim().toLowerCase() === UPLOAD_CLASS_NAME.toLowerCase())
  if (!cls) {
    // Sorted last, so it never pushes the real classes down the panel.
    const id = await createClass(UPLOAD_CLASS_NAME, 9_000)
    cls = { id, name: UPLOAD_CLASS_NAME }
  } else if (cls.visible === false) {
    await restoreClass(cls.id)
  }

  const wantChapter = uploadChapterName(when)
  const chapters = await listChapters(cls.id, { includeHidden: true })
  let chapter = chapters.find((c) => (c.name || '').trim() === wantChapter)
  if (!chapter) {
    const id = await createChapter(
      cls.id,
      { name: wantChapter, info: 'Decks uploaded straight from a laptop', svgIcon: DEFAULT_CHAPTER_SVG },
      chapters.length,
    )
    chapter = { id, name: wantChapter }
  } else if (chapter.visible === false) {
    await restoreChapter(cls.id, chapter.id)
  }

  return { classId: cls.id, chapterId: chapter.id, chapterName: wantChapter }
}

/**
 * An HTML file dropped into the presenter's "Upload HTML" button. It gets a
 * code like anything else — so the session can reference it instead of
 * copying it — and a real home under Random / MM-YYYY.
 */
export async function registerUploadedDeck({ name, html }) {
  const home = await ensureUploadHome()
  const existing = await listFolders(home.classId, home.chapterId, { includeHidden: true })
  const cleanName = (name || 'Uploaded deck').trim()
  const { id, code, version } = await createFolder(
    home.classId,
    home.chapterId,
    { name: cleanName, tag: UPLOAD_TAG, html },
    existing.length,
  )
  return {
    id,
    code,
    version,
    name: cleanName,
    tag: UPLOAD_TAG,
    classId: home.classId,
    chapterId: home.chapterId,
  }
}

// ---------- batches ----------
export const listBatches = (opts) => listCol(['batches'], opts)

export async function createBatch(name) {
  const id = makeId('batch')
  await setDoc(udoc('batches', id), {
    id, name: name.trim(), visible: true, createdAt: serverTimestamp(),
  })
  return id
}

/** Soft delete — a removed batch keeps its session history intact. */
export const deleteBatch = (id) =>
  updateDoc(udoc('batches', id), { visible: false, hiddenAtMs: Date.now() })
export const restoreBatch = (id) =>
  updateDoc(udoc('batches', id), { visible: true, hiddenAtMs: null })

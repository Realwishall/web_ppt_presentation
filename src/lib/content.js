// Data layer for the new authoring model:
//
//   classes/{classId}
//     └─ chapters/{chapterId}      { name, svgIcon, info }
//          └─ folders/{folderId}   { name, tag, html }
//
// A "folder" stores one single-page HTML document (its own CSS & JS inline).
// That HTML is what the presenter loads when you Teach — the same
// `<section class="page">` format the presenter already understands.

import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// Tags used to divide folders by difficulty (for future filtering).
export const FOLDER_TAGS = ['Basic', 'Level 1.5', 'Level 2', 'Level 2.5', 'Advance', 'Olympiad']

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

async function listCol(path) {
  const snap = await getDocs(collection(db, ...path))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(bySortOrder)
}

// ---------- classes ----------
export const listClasses = () => listCol(['classes'])

export async function createClass(name, order = 0) {
  const id = makeId('class')
  await setDoc(doc(db, 'classes', id), { id, name: name.trim(), order, createdAt: serverTimestamp() })
  return id
}
export const renameClass = (id, name) => updateDoc(doc(db, 'classes', id), { name: name.trim() })
export const deleteClass = (id) => deleteDoc(doc(db, 'classes', id))

// ---------- chapters ----------
export const listChapters = (classId) => listCol(['classes', classId, 'chapters'])

export async function createChapter(classId, { name, svgIcon, info }, order = 0) {
  const id = makeId('chap')
  await setDoc(doc(db, 'classes', classId, 'chapters', id), {
    id,
    name: (name || '').trim(),
    svgIcon: svgIcon || DEFAULT_CHAPTER_SVG,
    info: (info || '').trim(),
    order,
    createdAt: serverTimestamp(),
  })
  return id
}
export const updateChapter = (classId, chapterId, data) =>
  updateDoc(doc(db, 'classes', classId, 'chapters', chapterId), data)
export const deleteChapter = (classId, chapterId) =>
  deleteDoc(doc(db, 'classes', classId, 'chapters', chapterId))

// ---------- folders ----------
export const listFolders = (classId, chapterId) =>
  listCol(['classes', classId, 'chapters', chapterId, 'folders'])

export async function createFolder(classId, chapterId, { name, tag, html }, order = 0) {
  const id = makeId('folder')
  const cleanName = (name || 'New folder').trim()
  await setDoc(doc(db, 'classes', classId, 'chapters', chapterId, 'folders', id), {
    id,
    name: cleanName,
    tag: tag || FOLDER_TAGS[0],
    html: html ?? defaultFolderHtml(cleanName),
    order,
    updatedAt: serverTimestamp(),
  })
  return id
}
export const updateFolder = (classId, chapterId, folderId, data) =>
  updateDoc(doc(db, 'classes', classId, 'chapters', chapterId, 'folders', folderId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
export const deleteFolder = (classId, chapterId, folderId) =>
  deleteDoc(doc(db, 'classes', classId, 'chapters', chapterId, 'folders', folderId))

// ---------- batches ----------
export const listBatches = () => listCol(['batches'])

export async function createBatch(name) {
  const id = makeId('batch')
  await setDoc(doc(db, 'batches', id), { id, name: name.trim(), createdAt: serverTimestamp() })
  return id
}
export const deleteBatch = (id) => deleteDoc(doc(db, 'batches', id))

// Account-wide settings — everything the export pipeline needs that is NOT
// specific to one batch, held once per signed-in teacher:
//
//   users/{uid}/appSettings/curriculum                     { chapters[], rawMap }
//   users/{uid}/appSettings/exportPages                    { starts[], ends[], logoOnCovers }
//   users/{uid}/appSettings/exportPages/pages/{pageId}     { role, name, fit, html | chunks }
//   users/{uid}/appSettings/exportPages/pages/{pageId}/parts/{i}  ← chunks for big HTML
//   users/{uid}/appSettings/branding                       { logo…, anchor, offsetXPct, offsetYPct }
//   users/{uid}/appSettings/shortcuts                      { addPage{ key, ctrl, shift, alt, meta } }
//
// "Global" here means global to ONE ACCOUNT: one teacher runs every one of
// their batches off the same chapter map, the same cover pages and the same
// logo, so keeping a copy per batch was the actual bug. Another teacher signing
// into the same deployment gets their own set of all three — their logo never
// lands on your export.
//
// Only the roster and the "what did I type last export" memory stay per-batch.

import {
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { makeId } from './content'
import { ucol, udoc } from './userScope'

/** Firestore caps a document at 1 MB; stay well under it. */
const CHUNK_CHARS = 700_000
/** Hard ceiling for one uploaded Start/End page (~4 MB of HTML). */
export const MAX_PAGE_HTML_CHARS = 4_000_000
/** Longest edge, in px, a raster logo is downscaled to before storing. */
const LOGO_MAX_EDGE = 512
/** A stored logo data URL must fit in the branding doc with room to spare. */
export const MAX_LOGO_CHARS = 600_000
/** More cover pages than this is a mistake, not a workflow. */
export const MAX_COVER_PAGES = 12

const curriculumRef = () => udoc('appSettings', 'curriculum')
const pagesIndexRef = () => udoc('appSettings', 'exportPages')
const pagesCol = () => ucol('appSettings', 'exportPages', 'pages')
const pageRef = (pageId) => udoc('appSettings', 'exportPages', 'pages', pageId)
const partsCol = (pageId) => ucol('appSettings', 'exportPages', 'pages', pageId, 'parts')
const partRef = (pageId, i) =>
  udoc('appSettings', 'exportPages', 'pages', pageId, 'parts', String(i))
const brandingRef = () => udoc('appSettings', 'branding')
const shortcutsRef = () => udoc('appSettings', 'shortcuts')

/** Same key the presenter panel caches so a remapped N still works if Firestore is slow. */
export const ADD_PAGE_SHORTCUT_CACHE = 'lf-shortcut-add-page'

// ───────────────────────── chapter & topic map ─────────────────────────

/**
 * Parse a pasted "Chapter and Topic list Map" into chapters with topics.
 *
 * Deliberately forgiving — teachers paste from Word, PDF and WhatsApp, so all
 * of these land in the same shape:
 *
 *   1. Kinematics              │  Chapter 2 — Laws of Motion  │  Optics | Reflection, Refraction
 *      - Motion in 1D          │    1. Newton's laws          │
 *      • Relative motion       │    2. Friction               │
 *
 * A line is a TOPIC when it is indented, starts with a bullet, uses dotted
 * numbering (2.1), or follows a "Chapter | a, b, c" pipe list. Otherwise it
 * opens a new chapter. Numbers are taken from the text when present and
 * back-filled by position when not.
 */
export function parseChapterTopicMap(raw) {
  const lines = String(raw || '').split(/\r?\n/)
  const chapters = []
  let current = null

  const pushChapter = (number, name) => {
    const clean = (name || '').trim()
    if (!clean) return
    current = {
      id: makeId('chap'),
      number: number || chapters.length + 1,
      name: clean,
      topics: [],
    }
    chapters.push(current)
  }
  const pushTopic = (name) => {
    const clean = (name || '').replace(/^[-–—•*·\d.)\s]+/, '').trim()
    if (!clean) return
    if (!current) pushChapter(null, 'Untitled chapter')
    if (!current.topics.includes(clean)) current.topics.push(clean)
  }

  for (const line of lines) {
    if (!line.trim()) continue
    const indented = /^[ \t]{2,}/.test(line) || /^\t/.test(line)
    const body = line.trim()

    // "Optics | Reflection, Refraction" — chapter and topics on one line.
    const piped = body.match(/^(.+?)\s*[|:]\s*(.+)$/)

    const bulleted = /^[-–—•*·>]/.test(body)
    const dotted = /^\d+\.\d+/.test(body)
    const chapterWord = body.match(/^(?:chapter|ch\.?|unit)\s*(\d+)\s*[.):\-–—]?\s*(.*)$/i)
    const numbered = body.match(/^(\d+)\s*[.):\-–—]\s*(.+)$/)

    if (bulleted || dotted || (indented && !chapterWord)) {
      pushTopic(body)
      continue
    }
    if (chapterWord) {
      pushChapter(Number(chapterWord[1]), chapterWord[2] || `Chapter ${chapterWord[1]}`)
      continue
    }
    if (piped && !numbered) {
      pushChapter(null, piped[1])
      piped[2].split(/\s*[,;/]\s*/).forEach(pushTopic)
      continue
    }
    if (numbered) {
      const rest = numbered[2]
      const inner = rest.match(/^(.+?)\s*[|:]\s*(.+)$/)
      if (inner) {
        pushChapter(Number(numbered[1]), inner[1])
        inner[2].split(/\s*[,;/]\s*/).forEach(pushTopic)
      } else {
        pushChapter(Number(numbered[1]), rest)
      }
      continue
    }
    // A bare line with no marker: a chapter when nothing is open yet or the
    // open chapter already has topics, otherwise a topic of the open chapter.
    if (!current || current.topics.length) pushChapter(null, body)
    else pushTopic(body)
  }

  return normaliseChapters(chapters)
}

/** Fill gaps, coerce types and sort by chapter number. */
export function normaliseChapters(list) {
  return (Array.isArray(list) ? list : [])
    .map((c, i) => ({
      id: c.id || makeId('chap'),
      number: Number(c.number) > 0 ? Number(c.number) : i + 1,
      name: String(c.name || '').trim() || `Chapter ${i + 1}`,
      topics: [...new Set((c.topics || []).map((t) => String(t).trim()).filter(Boolean))],
    }))
    .sort((a, b) => a.number - b.number || a.name.localeCompare(b.name))
}

/** Render chapters back into the paste format, so the textarea round-trips. */
export function chaptersToMapText(chapters) {
  return normaliseChapters(chapters)
    .map((c) => [`${c.number}. ${c.name}`, ...c.topics.map((t) => `   - ${t}`)].join('\n'))
    .join('\n')
}

/** Merge two chapter lists by name — pasted topics land on existing chapters. */
export function mergeChapters(base, incoming) {
  const byName = new Map(
    normaliseChapters(base).map((c) => [c.name.toLowerCase(), { ...c, topics: [...c.topics] }]),
  )
  for (const p of normaliseChapters(incoming)) {
    const hit = byName.get(p.name.toLowerCase())
    if (hit) p.topics.forEach((t) => { if (!hit.topics.includes(t)) hit.topics.push(t) })
    else byName.set(p.name.toLowerCase(), p)
  }
  return normaliseChapters([...byName.values()])
}

export const EMPTY_CURRICULUM = { chapters: [], rawMap: '' }

export async function getCurriculum() {
  try {
    const snap = await getDoc(curriculumRef())
    if (!snap.exists()) return { ...EMPTY_CURRICULUM }
    const d = snap.data()
    return { chapters: normaliseChapters(d.chapters), rawMap: d.rawMap || '' }
  } catch (err) {
    console.warn('Curriculum read failed:', err)
    return { ...EMPTY_CURRICULUM }
  }
}

export async function saveCurriculum(patch) {
  const clean = { ...patch }
  if (clean.chapters) clean.chapters = normaliseChapters(clean.chapters)
  await setDoc(
    curriculumRef(),
    { ...clean, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
    { merge: true },
  )
}

// ───────────────────────── cover pages (many start / many end) ─────────────────────────

/** How an uploaded cover page is fitted onto the PDF sheet. */
export const FIT_MODES = [
  { id: 'fill', label: 'Fill page', hint: 'scale up until the sheet is covered — edges may crop' },
  { id: 'stretch', label: 'Stretch', hint: 'stretch to the exact sheet — may distort' },
  { id: 'contain', label: 'Fit inside', hint: 'whole page visible, may leave a band' },
]
export const DEFAULT_FIT = 'fill'

export const EMPTY_COVER_PAGES = { starts: [], ends: [], logoOnCovers: false }

const cleanFit = (f) => (FIT_MODES.some((m) => m.id === f) ? f : DEFAULT_FIT)

/** Read one page's HTML, re-joining its chunks when it was split. */
async function readPageHtml(pageId, d) {
  if (d.html) return d.html
  if (!(Number(d.chunks) > 1)) return ''
  const parts = await getDocs(partsCol(pageId))
  return parts.docs
    .map((p) => p.data())
    .sort((a, b) => (a.i || 0) - (b.i || 0))
    .map((p) => p.text || '')
    .join('')
}

/**
 * Every cover page, in the order they will be printed. One `getDocs` over the
 * pages collection plus one extra read per chunked page — cover pages are
 * uploaded rarely and read once per export, so whole-document reads win.
 */
export async function getCoverPages() {
  try {
    const [indexSnap, pageDocs] = await Promise.all([getDoc(pagesIndexRef()), getDocs(pagesCol())])
    const index = indexSnap.exists() ? indexSnap.data() : {}
    const byId = new Map()
    await Promise.all(
      pageDocs.docs.map(async (p) => {
        const d = p.data()
        byId.set(p.id, {
          id: p.id,
          name: d.name || 'page.html',
          role: d.role === 'end' ? 'end' : 'start',
          fit: cleanFit(d.fit),
          enabled: d.enabled !== false,
          html: await readPageHtml(p.id, d),
        })
      }),
    )
    // The index doc owns the order; anything it forgot is appended so an
    // interrupted save can never make a page invisible.
    const take = (role, ids) => {
      const out = []
      const seen = new Set()
      for (const id of Array.isArray(ids) ? ids : []) {
        const hit = byId.get(id)
        if (hit && hit.role === role) { out.push(hit); seen.add(id) }
      }
      for (const [id, page] of byId) if (page.role === role && !seen.has(id)) out.push(page)
      return out
    }
    return {
      starts: take('start', index.starts),
      ends: take('end', index.ends),
      logoOnCovers: !!index.logoOnCovers,
    }
  } catch (err) {
    console.warn('Cover pages read failed:', err)
    return { ...EMPTY_COVER_PAGES }
  }
}

/**
 * Write the whole cover-page set: the ordered index, one document per page and
 * chunk documents for anything over CHUNK_CHARS. Pages that are gone from the
 * lists are deleted, chunk-and-all, so a shorter re-upload can never be
 * concatenated onto the tail of the previous one.
 */
export async function saveCoverPages(pages) {
  const starts = (pages.starts || []).slice(0, MAX_COVER_PAGES)
  const ends = (pages.ends || []).slice(0, MAX_COVER_PAGES)
  const all = [
    ...starts.map((p) => ({ ...p, role: 'start' })),
    ...ends.map((p) => ({ ...p, role: 'end' })),
  ]
  for (const p of all) {
    if ((p.html || '').length > MAX_PAGE_HTML_CHARS) {
      throw new Error(`"${p.name || 'page'}" is too large (max 4 MB of HTML).`)
    }
  }

  const existing = await getDocs(pagesCol())
  const keep = new Set(all.map((p) => p.id))
  const stale = existing.docs.filter((d) => !keep.has(d.id))

  // Chunk documents live under each page, so they have to be cleared before a
  // page is rewritten (or removed with it).
  const clearParts = async (pageId) => {
    const parts = await getDocs(partsCol(pageId))
    if (!parts.size) return
    const wb = writeBatch(db)
    parts.docs.forEach((p) => wb.delete(p.ref))
    await wb.commit()
  }
  await Promise.all([
    ...stale.map(async (d) => { await clearParts(d.id); await deleteDoc(d.ref) }),
    ...all.map(async (p) => {
      await clearParts(p.id)
      const text = p.html || ''
      const base = {
        name: p.name || 'page.html',
        role: p.role,
        fit: cleanFit(p.fit),
        enabled: p.enabled !== false,
        chars: text.length,
        updatedAtMs: Date.now(),
      }
      if (text.length <= CHUNK_CHARS) {
        await setDoc(pageRef(p.id), { ...base, html: text, chunks: text ? 1 : 0 })
        return
      }
      const parts = []
      for (let i = 0; i < text.length; i += CHUNK_CHARS) parts.push(text.slice(i, i + CHUNK_CHARS))
      await setDoc(pageRef(p.id), { ...base, html: '', chunks: parts.length })
      const wb = writeBatch(db)
      parts.forEach((chunk, i) => wb.set(partRef(p.id, i), { i, text: chunk }))
      await wb.commit()
    }),
  ])

  await setDoc(
    pagesIndexRef(),
    {
      starts: starts.map((p) => p.id),
      ends: ends.map((p) => p.id),
      logoOnCovers: !!pages.logoOnCovers,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    },
    { merge: true },
  )
}

/**
 * How many printed sheets one uploaded cover file will produce.
 *
 * These pages are usually authored like decks — several
 * `<section class="slide">` in one file with an `@media print` rule that gives
 * each its own page — so one file is legitimately more than one cover, and the
 * export splits it. Shown in the panel so the count is never a surprise.
 */
export function countCoverSheets(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    for (const sel of ['.slide', '.page']) {
      const n = doc.querySelectorAll(sel).length
      if (n > 1) return n
    }
  } catch { /* an unparseable file is one sheet like anything else */ }
  return 1
}

/** A picked .html file → a cover-page record ready to drop into a list. */
export async function fileToCoverPage(file, role) {
  if (!file) throw new Error('No file chosen')
  if (file.size > MAX_PAGE_HTML_CHARS) throw new Error('That file is larger than 4 MB.')
  const text = await file.text()
  if (!/<[a-z!]/i.test(text)) throw new Error(`${file.name} does not look like HTML.`)
  return {
    id: makeId('cover'),
    name: file.name,
    role: role === 'end' ? 'end' : 'start',
    fit: DEFAULT_FIT,
    enabled: true,
    html: text,
  }
}

// ───────────────────────── global branding (logo) ─────────────────────────

/**
 * Where the logo sits on an exported sheet. The anchor picks the corner /
 * edge it hangs off; the two offsets nudge it inward from that anchor as a
 * percentage of the sheet, so one setting looks the same on any board size.
 */
export const LOGO_ANCHORS = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-center', label: 'Top center' },
  { id: 'top-right', label: 'Top right' },
  { id: 'middle-left', label: 'Middle left' },
  { id: 'center', label: 'Center' },
  { id: 'middle-right', label: 'Middle right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-center', label: 'Bottom center' },
  { id: 'bottom-right', label: 'Bottom right' },
]

export const EMPTY_BRANDING = {
  enabled: false,
  dataUrl: '',
  fileName: '',
  sizePct: 8,          // logo box width as a % of the sheet width
  opacity: 100,
  anchor: 'top-left',
  offsetXPct: 1.8,     // inward nudge from the anchor edge, % of sheet width
  offsetYPct: 1.8,     // …and % of sheet height
}

const cleanAnchor = (a) => (LOGO_ANCHORS.some((x) => x.id === a) ? a : 'top-left')
const clampPct = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(45, Math.max(-10, n)) : fallback
}

/**
 * Turn the stored anchor + offsets into the CSS box the presenter and the
 * panel preview both draw with. Percentages, so it is resolution-free.
 *
 * Exported (rather than inlined twice) because the live preview in the panel
 * and the printed badge must agree — a preview that lies is worse than none.
 */
export function logoBoxStyle(branding) {
  const b = { ...EMPTY_BRANDING, ...(branding || {}) }
  const anchor = cleanAnchor(b.anchor)
  const [vert, horz] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-')
  const x = clampPct(b.offsetXPct, EMPTY_BRANDING.offsetXPct)
  const y = clampPct(b.offsetYPct, EMPTY_BRANDING.offsetYPct)
  const style = { width: `${Number(b.sizePct) || EMPTY_BRANDING.sizePct}%`, opacity: (Number(b.opacity) || 100) / 100 }
  const shift = []

  if (horz === 'left') style.left = `${x}%`
  else if (horz === 'right') style.right = `${x}%`
  else { style.left = '50%'; shift.push('translateX(-50%)') }

  if (vert === 'top') style.top = `${y}%`
  else if (vert === 'bottom') style.bottom = `${y}%`
  else { style.top = '50%'; shift.push('translateY(-50%)') }

  if (shift.length) style.transform = shift.join(' ')
  return style
}

export async function getBranding() {
  try {
    const snap = await getDoc(brandingRef())
    if (!snap.exists()) return { ...EMPTY_BRANDING }
    const d = snap.data()
    return {
      enabled: !!d.enabled,
      dataUrl: d.dataUrl || '',
      fileName: d.fileName || '',
      sizePct: Number(d.sizePct) > 0 ? Number(d.sizePct) : EMPTY_BRANDING.sizePct,
      opacity: Number(d.opacity) > 0 ? Number(d.opacity) : 100,
      anchor: cleanAnchor(d.anchor),
      offsetXPct: clampPct(d.offsetXPct, EMPTY_BRANDING.offsetXPct),
      offsetYPct: clampPct(d.offsetYPct, EMPTY_BRANDING.offsetYPct),
    }
  } catch (err) {
    // Branding is global; a rules gap must not break the whole settings panel.
    console.warn('Branding read failed:', err)
    return { ...EMPTY_BRANDING }
  }
}

export async function saveBranding(branding) {
  if ((branding.dataUrl || '').length > MAX_LOGO_CHARS) {
    throw new Error('Logo is too large after processing — try a smaller or simpler image.')
  }
  await setDoc(brandingRef(), {
    enabled: !!branding.enabled,
    dataUrl: branding.dataUrl || '',
    fileName: branding.fileName || '',
    sizePct: Number(branding.sizePct) || EMPTY_BRANDING.sizePct,
    opacity: Number(branding.opacity) || 100,
    anchor: cleanAnchor(branding.anchor),
    offsetXPct: clampPct(branding.offsetXPct, EMPTY_BRANDING.offsetXPct),
    offsetYPct: clampPct(branding.offsetYPct, EMPTY_BRANDING.offsetYPct),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Turn a picked image file into a data URL small enough to live in Firestore
 * and to be inlined into every exported sheet.
 *
 * SVG is kept as vector (it prints sharp at any size). Everything raster is
 * drawn onto a canvas capped at LOGO_MAX_EDGE and re-encoded as PNG, which
 * preserves transparency — a JPEG logo would otherwise print a white block
 * over the dark board.
 */
export function fileToLogoDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file chosen'))
    if (!/^image\//i.test(file.type) && !/\.(svg|png|jpe?g|webp|gif|avif)$/i.test(file.name)) {
      return reject(new Error('That file is not an image.'))
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const src = String(reader.result || '')
      if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) return resolve(src)
      const img = new Image()
      img.onerror = () => reject(new Error('That image could not be decoded.'))
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(img.width || 1, img.height || 1))
        const w = Math.max(1, Math.round((img.width || LOGO_MAX_EDGE) * scale))
        const h = Math.max(1, Math.round((img.height || LOGO_MAX_EDGE) * scale))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        try {
          resolve(c.toDataURL('image/png'))
        } catch {
          resolve(src)
        }
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}

// ───────────────────────── presenter shortcuts ─────────────────────────

/**
 * Keys the board already uses for navigation / dialogs, so they cannot be
 * rebound as "add a blank page". Letters that pick tools (P/E/L/…) are
 * allowed — binding add-page to P simply takes precedence over the pen.
 */
export const BLOCKED_BIND_KEYS = new Set([
  'escape', 'tab', 'enter', 'backspace', 'delete',
  'arrowleft', 'arrowright', 'arrowup', 'arrowdown',
  'pageup', 'pagedown', 'space', 'home', 'end',
])

export const DEFAULT_ADD_PAGE_SHORTCUT = {
  key: 'n', ctrl: false, shift: false, alt: false, meta: false,
}

export const EMPTY_SHORTCUTS = {
  addPage: { ...DEFAULT_ADD_PAGE_SHORTCUT },
}

export function eventKeyName(e) {
  if (e.key === ' ' || e.key === 'Spacebar') return 'space'
  return String(e.key || '').toLowerCase()
}

export function normaliseShortcut(o) {
  if (!o || typeof o.key !== 'string' || !o.key) return { ...DEFAULT_ADD_PAGE_SHORTCUT }
  return {
    key: String(o.key).toLowerCase(),
    ctrl: !!o.ctrl,
    shift: !!o.shift,
    alt: !!o.alt,
    meta: !!o.meta,
  }
}

export function shortcutLabel(s) {
  const sc = normaliseShortcut(s)
  const bits = []
  if (sc.ctrl) bits.push('Ctrl')
  if (sc.alt) bits.push('Alt')
  if (sc.shift) bits.push('Shift')
  if (sc.meta) bits.push('Cmd')
  const k = !sc.key ? '?' : (sc.key.length === 1 ? sc.key.toUpperCase() : sc.key)
  bits.push(k)
  return bits.join('+')
}

export function matchesShortcut(e, s) {
  const sc = normaliseShortcut(s)
  if (!sc.key) return false
  return eventKeyName(e) === sc.key
    && !!e.ctrlKey === !!sc.ctrl
    && !!e.shiftKey === !!sc.shift
    && !!e.altKey === !!sc.alt
    && !!e.metaKey === !!sc.meta
}

/**
 * Turn a keydown into a bindable shortcut, or explain why that key is reserved.
 * Keep this in step with public/presenter.html (applyCapturedShortcut).
 */
export function shortcutFromKeydown(e) {
  const name = eventKeyName(e)
  if (
    BLOCKED_BIND_KEYS.has(name)
    || name === 'control' || name === 'shift' || name === 'alt' || name === 'meta'
  ) {
    return { ok: false, error: 'That key is reserved — pick a letter or digit.' }
  }
  if (name === 'z' && (e.ctrlKey || e.metaKey)) {
    return { ok: false, error: 'Ctrl+Z is undo — pick another shortcut.' }
  }
  return {
    ok: true,
    shortcut: {
      key: name,
      ctrl: !!e.ctrlKey,
      shift: !!e.shiftKey,
      alt: !!e.altKey,
      meta: !!e.metaKey,
    },
  }
}

export function cacheAddPageShortcut(s) {
  try {
    localStorage.setItem(ADD_PAGE_SHORTCUT_CACHE, JSON.stringify(normaliseShortcut(s)))
  } catch { /* private mode / blocked storage */ }
}

export function readCachedAddPageShortcut() {
  try {
    const raw = localStorage.getItem(ADD_PAGE_SHORTCUT_CACHE)
    if (!raw) return null
    return normaliseShortcut(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function getShortcuts() {
  try {
    const snap = await getDoc(shortcutsRef())
    if (snap.exists() && snap.data().addPage) {
      const addPage = normaliseShortcut(snap.data().addPage)
      cacheAddPageShortcut(addPage)
      return { addPage }
    }
  } catch (err) {
    console.warn('Shortcuts read failed:', err)
  }
  const cached = readCachedAddPageShortcut()
  const addPage = cached || { ...DEFAULT_ADD_PAGE_SHORTCUT }
  // A remap that only lived on this browser (the old presenter-settings
  // store) becomes account-wide the first time Global settings or Teach
  // reads it, so the teacher does not have to bind the key twice.
  const remapped = cached && (
    cached.key !== DEFAULT_ADD_PAGE_SHORTCUT.key
    || cached.ctrl || cached.shift || cached.alt || cached.meta
  )
  if (remapped) saveShortcuts({ addPage }).catch(() => {})
  return { addPage }
}

export async function saveShortcuts(patch) {
  const addPage = normaliseShortcut(patch?.addPage)
  cacheAddPageShortcut(addPage)
  await setDoc(
    shortcutsRef(),
    { addPage, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
    { merge: true },
  )
}

// ───────────────────────── export variable substitution ─────────────────────────

/** Every placeholder the Starting / Ending pages may contain. */
export const EXPORT_VARIABLES = [
  { key: 'BATCH_CODE', label: 'Batch code', hint: 'e.g. JEE-2027-A' },
  { key: 'CHAPTER_NUMBER', label: 'Chapter number', hint: 'e.g. 4' },
  { key: 'CHAPTER_NAME', label: 'Chapter name', hint: 'filled from the chapter you pick' },
  { key: 'LECTURE_NUMBER', label: 'Lecture number', hint: '1 – 40' },
  { key: 'TOPIC_LIST', label: 'Topics, comma separated', hint: 'Friction, Pulleys' },
  { key: 'TOPIC_LIST_HTML', label: 'Topics as a <ul> list', hint: 'drop into a styled box' },
  { key: 'TOPIC_COUNT', label: 'How many topics', hint: 'e.g. 3' },
  { key: 'DATE', label: "Today's date", hint: 'local format' },
  { key: 'PAGE_COUNT', label: 'Board pages exported', hint: 'excludes these covers' },
]

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

/**
 * Build the {{NAME}} → value table from what the teacher typed at export.
 *
 * Every text value is HTML-escaped: these land inside an uploaded page, so a
 * topic like "Pulleys & <strings>" or a batch code with a quote in it would
 * otherwise break the markup (or the attribute it sits in). TOPIC_LIST_HTML
 * is the deliberate exception — it *is* markup, built here from escaped parts.
 */
export function buildVariableMap(values = {}) {
  const topics = (values.topics || []).map((t) => String(t).trim()).filter(Boolean)
  return {
    BATCH_CODE: escapeHtml(values.batchCode || ''),
    CHAPTER_NUMBER: values.chapterNumber == null ? '' : String(values.chapterNumber),
    CHAPTER_NAME: escapeHtml(values.chapterName || ''),
    LECTURE_NUMBER: values.lectureNumber == null ? '' : String(values.lectureNumber),
    TOPIC_LIST: escapeHtml(topics.join(', ')),
    TOPIC_LIST_HTML: topics.length
      ? `<ul>${topics.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
      : '',
    TOPIC_COUNT: String(topics.length),
    DATE: escapeHtml(values.date || new Date().toLocaleDateString()),
    PAGE_COUNT: values.pageCount == null ? '' : String(values.pageCount),
  }
}

/**
 * Replace {{VARIABLE}} in an uploaded page. Whitespace inside the braces is
 * tolerated and matching is case-insensitive, because these files are written
 * by hand. An unknown placeholder is left visible rather than silently
 * blanked — a wrong variable name should be obvious in the PDF, not invisible.
 */
export function substituteVariables(html, values) {
  const map = buildVariableMap(values)
  const upper = {}
  for (const [k, v] of Object.entries(map)) upper[k.toUpperCase()] = v
  return String(html || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name) => {
    const hit = upper[name.toUpperCase()]
    return hit === undefined ? whole : hit
  })
}

/** Which placeholders an uploaded page actually uses — shown in the panel. */
export function findPlaceholders(html) {
  const found = new Set()
  String(html || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, name) => {
    found.add(name.toUpperCase())
    return _
  })
  return [...found]
}

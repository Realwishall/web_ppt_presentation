import RUNTIME from './deckNotesRuntime.js?raw'

/**
 * NOTES MODE — storage, formatting and iframe glue.
 *
 * A "note" is a line of text plus the slide it was written against. That pair
 * is the whole point: the export is meant to be pasted into another AI prompt,
 * and a note without its slide number is context-free to the model reading it.
 *
 * Notes live in this browser (localStorage), keyed by the deck's permanent
 * content code — so re-opening the same deck brings back what you wrote, and a
 * new version of the deck keeps the notes taken against it.
 */

const STORE_KEY = 'lf-deck-notes:v1'
const MAX_BYTES = 4_000_000 // localStorage is ~5 MB; stop well short of the wall

/* ── identity ───────────────────────────────────────────────────────────── */

/**
 * Which bucket a folder's notes live in.
 *
 * The content `code` is preferred because it is permanent and survives edits,
 * re-tagging and renames. A deck that somehow has no code (an unregistered
 * upload) falls back to its row id, and finally to its name — never to
 * nothing, which would make every unnamed deck share one bucket.
 */
export function deckNoteKey(folder) {
  if (!folder) return 'unknown'
  return folder.code || folder.id || folder.folderId || `name:${folder.name || 'deck'}`
}

export function makeNoteId() {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/* ── storage ────────────────────────────────────────────────────────────── */

function readAll() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // Corrupt or unavailable storage must never take the notes screen down —
    // the teacher can still write, they just start from empty.
    return {}
  }
}

function writeAll(all) {
  try {
    const text = JSON.stringify(all)
    if (text.length > MAX_BYTES) return false
    localStorage.setItem(STORE_KEY, text)
    return true
  } catch {
    return false
  }
}

/** Everything stored for one deck: `{ notes: [], draft: {text, slide}, meta }`. */
export function loadDeckNotes(key) {
  const entry = readAll()[key]
  return {
    notes: Array.isArray(entry?.notes) ? entry.notes : [],
    draft: entry?.draft && typeof entry.draft === 'object' ? entry.draft : null,
    updatedAt: entry?.updatedAt || null,
  }
}

/** Write one deck's notes back, leaving every other deck's bucket untouched. */
export function saveDeckNotes(key, { notes, draft, meta }) {
  const all = readAll()
  all[key] = {
    ...(all[key] || {}),
    notes: notes || [],
    draft: draft && draft.text ? draft : null,
    meta: meta || all[key]?.meta || null,
    updatedAt: Date.now(),
  }
  return writeAll(all)
}

export function clearDeckNotes(key) {
  const all = readAll()
  delete all[key]
  return writeAll(all)
}

/** Every deck that has notes on this machine — used by the "all decks" export. */
export function listDeckNoteBuckets() {
  const all = readAll()
  return Object.entries(all)
    .filter(([, v]) => (v?.notes || []).length)
    .map(([key, v]) => ({
      key,
      meta: v.meta || null,
      count: v.notes.length,
      updatedAt: v.updatedAt || 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/* ── formatting ─────────────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0')

function stamp(ms) {
  const d = new Date(ms || Date.now())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The deliverable.
 *
 * Markdown, grouped by slide, with each slide's number AND title in the
 * heading — so the model on the other end can tell "slide 7" from "the slide
 * about friction" without being handed the deck. Notes keep the order they
 * were written in within a slide, and slides come out in deck order rather
 * than in the order they happened to be visited.
 */
export function formatNotesForAI(notes, { deckName, code, version, slideCount, pages } = {}) {
  const list = [...(notes || [])].filter((n) => n.text?.trim())
  if (!list.length) return ''

  const bySlide = new Map()
  for (const n of list) {
    const slide = Number(n.slide) > 0 ? Number(n.slide) : 1
    if (!bySlide.has(slide)) bySlide.set(slide, [])
    bySlide.get(slide).push(n)
  }

  const head = [
    `# Slide notes — ${deckName || 'Deck'}`,
    '',
    `- Deck: **${deckName || 'Untitled'}**${code ? ` (\`${code}\`${version ? ` v${version}` : ''})` : ''}`,
    slideCount ? `- Slides in deck: ${slideCount}` : null,
    `- Notes: ${list.length} across ${bySlide.size} slide${bySlide.size === 1 ? '' : 's'}`,
    `- Exported: ${stamp()}`,
    '',
    '> Each heading below is the slide the note was written on. Use the slide',
    '> number to tie a note back to its page in the deck.',
    '',
    '---',
    '',
  ].filter(Boolean)

  const body = []
  for (const slide of [...bySlide.keys()].sort((a, b) => a - b)) {
    const title = pages?.[slide - 1]?.title
    body.push(`## Slide ${slide}${slideCount ? ` of ${slideCount}` : ''}${title ? ` — ${title}` : ''}`)
    body.push('')
    for (const n of bySlide.get(slide)) {
      // A multi-line note stays one bullet: continuation lines are indented so
      // the markdown does not silently split it into separate points.
      const text = n.text.trim().split('\n').map((l, i) => (i ? `  ${l}` : l)).join('\n')
      body.push(`- ${text}`)
    }
    body.push('')
  }

  return `${head.join('\n')}${body.join('\n')}`.trim() + '\n'
}

/** Plain-text variant for pasting somewhere that eats markdown. */
export function formatNotesPlain(notes, meta) {
  return formatNotesForAI(notes, meta)
    .replace(/^#+ /gm, '')
    .replace(/^> ?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
}

/** A deck name is free text; a download filename is not. */
export function notesFileName(name) {
  const clean = String(name || 'deck')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 100)
  return `${clean || 'deck'} — slide notes`
}

/* ── iframe glue ────────────────────────────────────────────────────────── */

/**
 * The document handed to the notes iframe: the deck exactly as authored,
 * followed by the read-only notes runtime. Same contract as
 * `buildEditorSrcdoc` — including the `</script>` escape, so a future edit to
 * the runtime cannot truncate the tag it is embedded in.
 */
export function buildNotesSrcdoc(deckHtml) {
  const safe = RUNTIME.replace(/<\/script/gi, '<\\/script')
  return `${deckHtml}\n<script data-lfn-own="1">\n${safe}\n</script>`
}

/** Slide titles read out of the deck source — a fallback if the frame is slow. */
export function parsePages(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return [...doc.querySelectorAll('.page')].map((pg, i) => {
      const h = pg.querySelector('h1,h2,.title,.heading')
      const t = (h?.textContent || pg.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      return { index: i, title: t || `Slide ${i + 1}`, stepCount: pg.querySelectorAll('.step').length }
    })
  } catch {
    return []
  }
}

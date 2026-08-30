// Reading a *folder* of HTML decks that the teacher dropped or picked.
//
// Two browser APIs hand us the same thing in different shapes:
//   • <input type="file" webkitdirectory>  → File.webkitRelativePath
//   • dragging folders onto a dropzone     → DataTransferItem.webkitGetAsEntry()
// Both are normalised here into a flat list of { file, path }, where `path` is
// POSIX-ish and relative to whatever was dropped.
//
// The chapter split is one rule:
//
//   a directory that DIRECTLY holds .html files becomes one chapter,
//   named after that directory.
//
// So dropping a parent folder files each of its subfolders as its own chapter,
// and dropping several folders at once files each of them as a chapter. Loose
// files that sit outside any folder are ignored — those are what the plain
// file import on the deck screen is for.

export const isHtmlFile = (f) =>
  /\.html?$/i.test(f?.name || '') || f?.type === 'text/html'

const MAX_DEPTH = 8 // a deck tree that deep is a mistake, not a chapter

/** Files from an `<input webkitdirectory>` pick. */
export function filesFromInput(fileList) {
  return [...(fileList || [])]
    .filter(isHtmlFile)
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

/**
 * Files from a drop. A dropped folder arrives as a FileSystemDirectoryEntry
 * and has to be walked — `dataTransfer.files` alone would give us the folder
 * itself with none of its contents. Returns [] when the drop carried no
 * directory at all, so the caller can fall back to its plain-file import.
 */
export async function filesFromDrop(dataTransfer) {
  const entries = [...(dataTransfer?.items || [])]
    .map((it) => (it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean)
  if (!entries.some((e) => e.isDirectory)) return []

  const out = []
  for (const entry of entries) await walk(entry, '', out, 0)
  return out
}

async function walk(entry, prefix, out, depth) {
  if (!entry || depth > MAX_DEPTH) return
  const path = prefix ? `${prefix}/${entry.name}` : entry.name

  if (entry.isFile) {
    const file = await new Promise((res) => entry.file(res, () => res(null)))
    if (file && isHtmlFile(file)) out.push({ file, path })
    return
  }
  if (!entry.isDirectory) return

  // readEntries() hands back one page at a time and signals the end with [].
  const reader = entry.createReader()
  for (;;) {
    const batch = await new Promise((res) => reader.readEntries(res, () => res([])))
    if (!batch.length) break
    for (const child of batch) await walk(child, path, out, depth + 1)
  }
}

// 2 before 10, and case-insensitive — folder trees are numbered by hand.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Turn the flat list into the chapters it implies:
 * `[{ name, files: [{ file, path }] }]`, decks in natural path order.
 */
export function groupIntoChapters(entries) {
  const byChapter = new Map()
  for (const e of entries || []) {
    const parts = String(e.path || '').split('/').filter(Boolean)
    if (parts.length < 2) continue // a loose file, not inside any folder
    const chapter = parts[parts.length - 2]
    if (!byChapter.has(chapter)) byChapter.set(chapter, [])
    byChapter.get(chapter).push(e)
  }
  return [...byChapter.entries()]
    .map(([name, files]) => ({
      name,
      files: files.sort((a, b) => collator.compare(a.path, b.path)),
    }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

export const countFiles = (plan) =>
  (plan || []).reduce((n, g) => n + g.files.length, 0)

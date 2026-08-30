import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FolderPlus, Plus, Trash2, ChevronRight, Layers, FolderOpen, Pencil, Loader2,
  UploadCloud, ClipboardPaste, FileCode2, X, Play, ChevronUp, ChevronDown, GripVertical,
  Download, Wand2, NotebookPen, FolderUp, FolderTree, CheckCheck,
} from 'lucide-react'
import ChapterIcon from './ChapterIcon'
import FolderEditor from './FolderEditor'
import {
  FOLDER_TAGS, DEFAULT_CHAPTER_SVG, extractHtmlTitle,
  listClasses, createClass, deleteClass,
  listChapters, createChapter, deleteChapter, ensureChapter,
  listFolders, createFolder, deleteFolder, updateFolder, reorderFolders,
  readFolderHtml,
} from '../lib/content'
import { filesFromDrop, filesFromInput, groupIntoChapters, countFiles } from '../lib/folderImport'

// Left half of the dashboard: author Classes → Chapters → Folders.
// A folder holds one single-page HTML doc that the presenter can load.
export default function ContentPanel() {
  const [cls, setCls] = useState(null) // selected class {id,name}
  const [chapter, setChapter] = useState(null) // selected chapter

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        cls={cls}
        chapter={chapter}
        onRoot={() => { setCls(null); setChapter(null) }}
        onClass={() => setChapter(null)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!cls && <ClassList onOpen={setCls} />}
        {cls && !chapter && <ChapterList cls={cls} onOpen={setChapter} />}
        {cls && chapter && <FolderList cls={cls} chapter={chapter} />}
      </div>
    </div>
  )
}

function PanelHeader({ cls, chapter, onRoot, onClass }) {
  return (
    <div className="shrink-0 border-b border-white/8 px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-400">
        <Layers className="h-4 w-4" /> Content creation
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-sm">
        <Crumb label="Classes" onClick={onRoot} active={!cls} />
        {cls && (<><Sep /><Crumb label={cls.name} onClick={onClass} active={!chapter} /></>)}
        {chapter && (<><Sep /><Crumb label={chapter.name} active /></>)}
      </div>
    </div>
  )
}
const Sep = () => <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
function Crumb({ label, onClick, active }) {
  return (
    <button
      onClick={onClick}
      disabled={active}
      className={`max-w-[14rem] truncate rounded px-1.5 py-0.5 ${
        active ? 'font-semibold text-slate-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------- Classes ----------------
function ClassList({ onOpen }) {
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setItems(await listClasses()), [])
  useEffect(() => { load() }, [load])

  async function add(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await createClass(name, items?.length || 0)
      setName('')
      await load()
    } finally { setBusy(false) }
  }
  async function remove(id, e) {
    if (!e?.shiftKey && !confirm('Hide this class? Its chapters and decks leave the panel but are kept, so old sessions still open.')) return
    await deleteClass(id)
    await load()
  }

  if (items === null) return <Spinner />
  return (
    <div>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="New class name (e.g. Class 11)"
          className={inputCls}
        />
        <AddBtn busy={busy} />
      </form>
      {items.length === 0 && <Empty icon={Layers} text="No classes yet. Create your first class above." />}
      <ul className="space-y-2">
        {items.map((c) => (
          <Row key={c.id} onOpen={() => onOpen(c)} onDelete={(e) => remove(c.id, e)}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-400">
              <Layers className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold text-slate-100">{c.name}</span>
          </Row>
        ))}
      </ul>
    </div>
  )
}

// ---------------- Chapters ----------------
function ChapterList({ cls, onOpen }) {
  const [items, setItems] = useState(null)
  const [form, setForm] = useState(null) // {name, svgIcon, info} or null
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setItems(await listChapters(cls.id)), [cls.id])
  useEffect(() => { load() }, [load])

  async function save(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    try {
      await createChapter(cls.id, form, items?.length || 0)
      setForm(null)
      await load()
    } finally { setBusy(false) }
  }
  async function remove(id, e) {
    if (!e?.shiftKey && !confirm('Hide this chapter and its folders? Nothing is erased — old sessions keep working.')) return
    await deleteChapter(cls.id, id)
    await load()
  }

  if (items === null) return <Spinner />
  return (
    <div>
      <div className="mb-4">
        {form ? (
          <form onSubmit={save} className="rounded-xl border border-indigo-500/25 bg-indigo-500/8 p-4">
            <div className="grid gap-3">
              <Labeled label="Name">
                <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Kinematics" className={inputCls} />
              </Labeled>
              <Labeled label="Info">
                <input value={form.info} onChange={(e) => setForm({ ...form, info: e.target.value })}
                  placeholder="One-line description of the chapter" className={inputCls} />
              </Labeled>
              <Labeled label="SVG icon (inline)">
                <div className="flex items-start gap-3">
                  <textarea rows={3} value={form.svgIcon} onChange={(e) => setForm({ ...form, svgIcon: e.target.value })}
                    className={`${inputCls} font-mono text-xs`} />
                  <ChapterIcon svg={form.svgIcon} size={44} />
                </div>
              </Labeled>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <GhostBtn onClick={() => setForm(null)}>Cancel</GhostBtn>
              <SolidBtn busy={busy} type="submit">Save chapter</SolidBtn>
            </div>
          </form>
        ) : (
          <button onClick={() => setForm({ name: '', svgIcon: DEFAULT_CHAPTER_SVG, info: '' })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110">
            <Plus className="h-4 w-4" /> New chapter
          </button>
        )}
      </div>
      <ChapterFolderImport cls={cls} onImported={load} />

      {items.length === 0 && !form && <Empty icon={FolderOpen} text="No chapters in this class yet." />}
      <ul className="space-y-2">
        {items.map((c) => (
          <Row key={c.id} onOpen={() => onOpen(c)} onDelete={(e) => remove(c.id, e)}>
            <ChapterIcon svg={c.svgIcon} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-100">{c.name}</span>
              {c.info && <span className="block truncate text-sm text-slate-400">{c.info}</span>}
            </span>
          </Row>
        ))}
      </ul>
    </div>
  )
}

// ---------- Import a folder of decks ----------
// Drop (or browse to) a folder: every directory inside it that directly holds
// .html files becomes one chapter, named after that directory, with one deck
// per file. Drop several folders at once and each of them is a chapter.
//
// Nothing is written until the teacher has seen the plan and pressed Import —
// folder trees are messy, and an import that guessed wrong is tedious to undo.
function ChapterFolderImport({ cls, onImported }) {
  const [plan, setPlan] = useState(null) // [{name, files}] awaiting confirmation
  const [tag, setTag] = useState(FOLDER_TAGS[0])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // {done, total, label}
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const inputRef = useRef(null)

  // React has no JSX prop for these, and they are what turns the file picker
  // into a folder picker.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.setAttribute('webkitdirectory', '')
    el.setAttribute('directory', '')
  }, [])

  function accept(entries) {
    setErr(''); setDone('')
    const groups = groupIntoChapters(entries)
    if (!groups.length) {
      setPlan(null)
      setErr(entries.length
        ? "Those .html files aren't inside a folder — a chapter takes its name from the folder holding the decks."
        : 'No .html files found in there.')
      return
    }
    setPlan(groups)
  }

  async function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    try {
      accept(await filesFromDrop(e.dataTransfer))
    } catch (e2) {
      setErr(e2.message || 'Could not read that folder.')
    }
  }

  function rename(i, name) {
    setPlan((prev) => prev.map((g, k) => (k === i ? { ...g, name } : g)))
  }
  function drop(i) {
    setPlan((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : null))
  }

  async function run() {
    if (!plan?.length) return
    const total = countFiles(plan)
    const chapters = plan.length
    setBusy(true); setErr(''); setDone('')
    setProgress({ done: 0, total, label: '' })
    let n = 0
    try {
      for (const group of plan) {
        const ch = await ensureChapter(cls.id, group.name, { info: 'Imported from a folder' })
        // Append to whatever the chapter already holds, so a re-import of a
        // folder into an existing chapter doesn't fight it for order 0.
        const existing = await listFolders(cls.id, ch.id, { includeHidden: true })
        let order = existing.length
        for (const { file } of group.files) {
          const html = await file.text()
          const deckName = extractHtmlTitle(html, file.name.replace(/\.html?$/i, ''))
          await createFolder(cls.id, ch.id, { name: deckName, tag, html }, order++)
          n += 1
          setProgress({ done: n, total, label: `${ch.name} · ${deckName}` })
        }
      }
      setPlan(null)
      setDone(`Imported ${total} deck${total === 1 ? '' : 's'} into ${chapters} chapter${chapters === 1 ? '' : 's'}.`)
    } catch (e) {
      setErr(`${e.message || 'Import failed.'} ${n} of ${total} decks were saved before it stopped.`)
    } finally {
      setBusy(false)
      setProgress(null)
      await onImported?.()
    }
  }

  return (
    <div className="mb-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition ${
          dragOver ? 'border-indigo-400 bg-indigo-500/10 text-indigo-300' : 'border-white/15 text-slate-400 hover:border-indigo-400/50 hover:bg-white/4'
        }`}>
        <FolderUp className="h-5 w-5" />
        <span><b>Drop a folder</b> of decks — or <span className="text-indigo-400 underline">browse</span></span>
        <span className="text-xs text-slate-500">
          Each folder that holds .html files becomes a chapter with that folder's name
        </span>
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => { accept(filesFromInput(e.target.files)); e.target.value = '' }} />
      </label>

      {plan && (
        <div className="mt-2 rounded-xl border border-indigo-500/25 bg-indigo-500/8 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-400">
            <FolderTree className="h-3.5 w-3.5" />
            {plan.length} chapter{plan.length === 1 ? '' : 's'} · {countFiles(plan)} deck{countFiles(plan) === 1 ? '' : 's'}
            <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
              <span className="text-slate-400">Tag every deck</span>
              <select value={tag} onChange={(e) => setTag(e.target.value)} disabled={busy}
                className="rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-400 [&>option]:bg-slate-900">
                {FOLDER_TAGS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </span>
          </div>

          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {plan.map((g, i) => (
              <li key={`${g.name}-${i}`} className="flex items-center gap-2">
                <input value={g.name} onChange={(e) => rename(i, e.target.value)} disabled={busy}
                  title="Chapter name — edit it before importing"
                  className={`${inputCls} min-w-0 flex-1 py-1.5`} />
                <span className="shrink-0 text-xs text-slate-400">
                  {g.files.length} deck{g.files.length === 1 ? '' : 's'}
                </span>
                <IconBtn onClick={() => drop(i)} disabled={busy} danger title="Leave this folder out">
                  <X className="h-4 w-4" />
                </IconBtn>
              </li>
            ))}
          </ul>

          {progress && (
            <div className="mt-2">
              <div className="h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-indigo-400 transition-all"
                  style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }} />
              </div>
              <p className="mt-1 truncate text-xs text-slate-400">
                {progress.done}/{progress.total} — {progress.label}
              </p>
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <GhostBtn onClick={() => { setPlan(null); setErr('') }} disabled={busy}>Cancel</GhostBtn>
            <SolidBtn busy={busy} type="button" onClick={run}
              disabled={busy || !plan.some((g) => g.name.trim())}>
              <FolderPlus className="h-4 w-4" /> Import
            </SolidBtn>
          </div>
        </div>
      )}

      {err && <div className="mt-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-400">{err}</div>}
      {done && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          <CheckCheck className="h-4 w-4 shrink-0" /> {done}
        </div>
      )}
    </div>
  )
}

// ---------------- Folders ----------------
function FolderList({ cls, chapter }) {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [tag, setTag] = useState(FOLDER_TAGS[0])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // folder being edited
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteHtml, setPasteHtml] = useState('')
  const [dragId, setDragId] = useState(null) // folder being dragged
  const [drop, setDrop] = useState(null) // {id, edge:'top'|'bottom'} — where it would land
  const [dlId, setDlId] = useState(null) // folder whose HTML is being fetched for download
  const pressRef = useRef(null) // what the pointer went down on, to veto drags off a control

  const load = useCallback(async () => setItems(await listFolders(cls.id, chapter.id)), [cls.id, chapter.id])
  useEffect(() => { load() }, [load])

  async function add(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await createFolder(cls.id, chapter.id, { name, tag }, items?.length || 0)
      setName('')
      await load()
    } finally { setBusy(false) }
  }

  // Create one folder per HTML file, naming each from its <title>.
  async function importFiles(fileList) {
    const files = [...fileList].filter((f) => /\.html?$/i.test(f.name) || f.type === 'text/html')
    if (!files.length) { setErr('Please drop .html files only.'); return }
    setBusy(true); setErr('')
    try {
      let order = items?.length || 0
      for (const file of files) {
        const html = await file.text()
        const folderName = extractHtmlTitle(html, file.name.replace(/\.html?$/i, ''))
        await createFolder(cls.id, chapter.id, { name: folderName, tag, html }, order++)
      }
      await load()
    } catch (e) {
      setErr(e.message || 'Import failed.')
    } finally { setBusy(false) }
  }

  // Create a folder from pasted HTML, named from its <title>.
  async function importPasted() {
    const html = pasteHtml.trim()
    if (!html) return
    setBusy(true); setErr('')
    try {
      const folderName = extractHtmlTitle(html, 'Pasted HTML')
      await createFolder(cls.id, chapter.id, { name: folderName, tag, html }, items?.length || 0)
      setPasteHtml(''); setPasteOpen(false)
      await load()
    } catch (e) {
      setErr(e.message || 'Import failed.')
    } finally { setBusy(false) }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files)
  }

  async function remove(id, e) {
    if (!e?.shiftKey && !confirm('Hide this folder? The HTML is kept under its content code, so sessions that taught it still replay.')) return
    await deleteFolder(cls.id, chapter.id, id)
    await load()
  }

  // Reorder: show the new order at once, then write every folder's index.
  // If the write fails we fall back to what the server actually has.
  async function move(from, to) {
    if (from === to || to < 0 || to >= items.length) return
    const next = [...items]
    next.splice(to, 0, ...next.splice(from, 1))
    setItems(next.map((f, i) => ({ ...f, order: i })))
    setErr('')
    try {
      await reorderFolders(cls.id, chapter.id, next.map((f) => f.id))
    } catch (e) {
      setErr(e.message || 'Could not save the new order.')
      await load()
    }
  }
  // Drop the dragged row into the gap the indicator is showing: above the
  // hovered row for the top edge, below it for the bottom one.
  function dropHere() {
    if (!dragId || !drop) return
    const from = items.findIndex((f) => f.id === dragId)
    let to = items.findIndex((f) => f.id === drop.id)
    if (from < 0 || to < 0) return
    if (drop.edge === 'bottom') to += 1
    if (from < to) to -= 1 // the row leaves its old slot before it is re-inserted
    move(from, to)
  }

  // Save this folder's deck to the teacher's laptop as one self-contained
  // .html file — the same bytes the presenter loads, at the version the folder
  // currently points at.
  async function download(folder) {
    if (dlId) return
    setDlId(folder.id); setErr('')
    let url = ''
    try {
      const html = await readFolderHtml(folder)
      if (!html) throw new Error('This folder has no HTML to download yet.')
      url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${htmlFileName(folder.name)}.html`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      setErr(e.message || 'Download failed.')
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setDlId(null)
    }
  }

  async function changeTag(id, tagValue) {
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, tag: tagValue } : f)))
    setErr('')
    try {
      await updateFolder(cls.id, chapter.id, id, { tag: tagValue })
    } catch (e) {
      setErr(e.message || 'Could not change the tag.')
      await load()
    }
  }

  if (items === null) return <Spinner />
  return (
    <div>
      <form onSubmit={add} className="mb-3 flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="New folder name" className={`${inputCls} min-w-[10rem] flex-1`} />
        <select value={tag} onChange={(e) => setTag(e.target.value)} className={selectCls}>
          {FOLDER_TAGS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <AddBtn busy={busy} icon={FolderPlus} />
      </form>

      {/* Two more ways to add: drag-drop .html files, or paste HTML.
          Both name the folder from the document's <title>. */}
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label
          onDragOver={(e) => { if (dragId) return; e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition ${
            dragOver ? 'border-indigo-400 bg-indigo-500/10 text-indigo-300' : 'border-white/15 text-slate-400 hover:border-indigo-400/50 hover:bg-white/4'
          }`}>
          <UploadCloud className="h-5 w-5" />
          <span><b>Drag &amp; drop</b> or <span className="text-indigo-400 underline">browse</span> .html files</span>
          <span className="text-xs text-slate-500">Folder name comes from the file's title</span>
          <input type="file" accept=".html,.htm,text/html" multiple className="hidden"
            onChange={(e) => { if (e.target.files?.length) importFiles(e.target.files); e.target.value = '' }} />
        </label>
        <button type="button" onClick={() => { setPasteOpen((v) => !v); setErr('') }}
          className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition ${
            pasteOpen ? 'border-indigo-400 bg-indigo-500/10 text-indigo-300' : 'border-white/15 text-slate-400 hover:border-indigo-400/50 hover:bg-white/4'
          }`}>
          <ClipboardPaste className="h-5 w-5" />
          <span><b>Paste HTML</b> to create a folder</span>
          <span className="text-xs text-slate-500">Folder name comes from the pasted title</span>
        </button>
      </div>

      {pasteOpen && (
        <div className="mb-3 rounded-xl border border-indigo-500/25 bg-indigo-500/8 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-400">
            <FileCode2 className="h-3.5 w-3.5" /> Paste HTML
            <button type="button" onClick={() => { setPasteOpen(false); setPasteHtml('') }}
              className="ml-auto rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"><X className="h-4 w-4" /></button>
          </div>
          <textarea value={pasteHtml} onChange={(e) => setPasteHtml(e.target.value)} spellCheck={false}
            rows={6} placeholder="Paste your HTML here…"
            className={`${inputCls} resize-y font-mono text-xs`} />
          <div className="mt-2 flex justify-end">
            <SolidBtn busy={busy} type="button" onClick={importPasted} disabled={busy || !pasteHtml.trim()}>
              <FolderPlus className="h-4 w-4" /> Create folder
            </SolidBtn>
          </div>
        </div>
      )}

      {err && <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-400">{err}</div>}

      {items.length === 0 && <Empty icon={FolderOpen} text="No folders yet. Each folder holds one HTML deck." />}
      {items.length > 1 && (
        <p className="mb-2 text-xs text-slate-500">Drag a row to reorder it — or use its arrows. The tag is editable in place.</p>
      )}
      <ul className="space-y-2">
        {items.map((f, i) => (
          <li key={f.id}
            draggable
            onPointerDown={(e) => { pressRef.current = e.target }}
            onDragStart={(e) => {
              // A press that began on a control (tag select, Edit, Delete) is
              // that control's, not a reorder.
              if (pressRef.current?.closest?.('button,select,input,textarea')) { e.preventDefault(); return }
              setDragId(f.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', f.id)
            }}
            onDragEnd={() => { setDragId(null); setDrop(null) }}
            onDragOver={(e) => {
              if (!dragId) return // an .html file drag, not a row
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const box = e.currentTarget.getBoundingClientRect()
              const edge = e.clientY < box.top + box.height / 2 ? 'top' : 'bottom'
              setDrop((v) => (v?.id === f.id && v.edge === edge ? v : { id: f.id, edge }))
            }}
            onDrop={(e) => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); dropHere(); setDrop(null) }}
            className={`glass relative flex items-center gap-3 rounded-xl border p-3 transition hover:border-white/15 ${
              dragId === f.id ? 'opacity-40' : ''
            }`}>
            {/* where the row would land */}
            {dragId && dragId !== f.id && drop?.id === f.id && (
              <span className={`pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-indigo-400 ${
                drop.edge === 'top' ? '-top-1' : '-bottom-1'
              }`} />
            )}
            <span title="Drag to reorder"
              className="flex shrink-0 cursor-grab flex-col items-center text-slate-600 active:cursor-grabbing">
              <MoveBtn onClick={() => move(i, i - 1)} disabled={i === 0} title="Move up"><ChevronUp className="h-4 w-4" /></MoveBtn>
              <GripVertical className="h-3.5 w-3.5" />
              <MoveBtn onClick={() => move(i, i + 1)} disabled={i === items.length - 1} title="Move down"><ChevronDown className="h-4 w-4" /></MoveBtn>
            </span>
            <button onClick={() => navigate('/teach', { state: { folder: { ...f, classId: cls.id, chapterId: chapter.id } } })}
              title="Preview in presentation view"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-400 transition hover:bg-violet-600 hover:text-white">
              <Play className="h-5 w-5" />
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-100">{f.name}</span>
              {f.code && (
                <span className="mr-1.5 inline-block font-mono text-[11px] text-slate-500"
                  title="Permanent content code — sessions reference this instead of copying the HTML">
                  {f.code}<span className="text-slate-600"> ·v{f.version || 1}</span>
                </span>
              )}
              <select value={f.tag || FOLDER_TAGS[0]} onChange={(e) => changeTag(f.id, e.target.value)}
                title="Change tag"
                className="mt-0.5 cursor-pointer rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-400 outline-none transition hover:border-indigo-400/50 hover:text-slate-200 focus:border-indigo-400 [&>option]:bg-slate-900">
                {/* keep a tag that predates FOLDER_TAGS selectable rather than silently rewriting it */}
                {(FOLDER_TAGS.includes(f.tag) || !f.tag ? FOLDER_TAGS : [f.tag, ...FOLDER_TAGS])
                  .map((t) => <option key={t}>{t}</option>)}
              </select>
            </span>
            <IconBtn onClick={() => download(f)} disabled={dlId === f.id}
              title="Download this deck as a .html file">
              {dlId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </IconBtn>
            {/* Two ways in, on purpose. "Edit HTML" is the raw document —
                right for a typo or a hand-written rule. "Edit Live" opens the
                deck at presentation proportions with editing controls, which
                is what you want for anything you'd otherwise have to guess at:
                type sizes, deleting furniture, resequencing the reveal. */}
            <button onClick={() => navigate('/edit', { state: { folder: { ...f, classId: cls.id, chapterId: chapter.id } } })}
              title="Open this deck in the live presentation editor"
              className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110">
              <Wand2 className="h-3.5 w-3.5" /> Edit Live
            </button>
            {/* Notes mode: same slides, same proportions, no board tools —
                just a note box that stamps every line with the slide it was
                written on, for feeding back into a prompt later. */}
            <button onClick={() => navigate('/notes', { state: { folder: { ...f, classId: cls.id, chapterId: chapter.id } } })}
              title="Record Text — take notes against each slide, then copy them out with their slide numbers"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/20 hover:text-white">
              <NotebookPen className="h-3.5 w-3.5" /> Record Text
            </button>
            <button onClick={() => setEditing(f)}
              title="Edit the raw HTML in a code pane"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-indigo-400/40 hover:bg-white/10 hover:text-white">
              <Pencil className="h-3.5 w-3.5" /> Edit HTML
            </button>
            <IconBtn onClick={(e) => remove(f.id, e)} danger title="Hide folder (content is kept)"><Trash2 className="h-4 w-4" /></IconBtn>
          </li>
        ))}
      </ul>

      {editing && (
        <FolderEditor
          classId={cls.id} chapterId={chapter.id} folder={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }}
        />
      )}
    </div>
  )
}

export function TagBadge({ tag }) {
  return (
    <span className="mt-0.5 inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-400">
      {tag}
    </span>
  )
}

// ---------------- shared bits ----------------
const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/25'
const selectCls =
  'rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 [&>option]:bg-slate-900'

function Row({ children, onOpen, onDelete }) {
  return (
    <li className="glass flex items-center gap-3 rounded-xl border p-3 transition hover:border-indigo-400/30 hover:bg-white/6">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {children}
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
      </button>
      <IconBtn onClick={onDelete} danger title="Delete"><Trash2 className="h-4 w-4" /></IconBtn>
    </li>
  )
}
// One nudge of a folder up or down; the pair also doubles as the drag handle.
function MoveBtn({ children, onClick, disabled, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="rounded p-0.5 transition hover:bg-white/10 hover:text-slate-200 disabled:opacity-25 disabled:hover:bg-transparent">
      {children}
    </button>
  )
}
function IconBtn({ children, onClick, danger, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={`rounded-lg p-2 text-slate-500 transition disabled:opacity-50 ${danger ? 'hover:bg-red-500/10 hover:text-red-400' : 'hover:bg-white/10 hover:text-slate-200'}`}>
      {children}
    </button>
  )
}
// A folder name is free text; a download filename is not.
function htmlFileName(name) {
  const clean = String(name || 'deck')
    .replace(/[<>:"/\\|?*]/g, '-') // characters Windows and macOS reject in a filename
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '') // a leading dot hides the file; a trailing one breaks Windows
    .trim()
    .slice(0, 120)
  return clean || 'deck'
}
function AddBtn({ busy, icon: Icon = Plus }) {
  return (
    <button type="submit" disabled={busy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />} Add
    </button>
  )
}
function SolidBtn({ children, busy, disabled, ...p }) {
  return (
    <button {...p} disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60">
      {busy && <Loader2 className="h-4 w-4 animate-spin" />} {children}
    </button>
  )
}
function GhostBtn({ children, ...p }) {
  return (
    <button type="button" {...p}
      className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/10 hover:text-slate-200">
      {children}
    </button>
  )
}
function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}
function Empty({ icon: Icon, text }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
      <Icon className="mx-auto mb-2 h-7 w-7 text-slate-600" />
      {text}
    </div>
  )
}
function Spinner() {
  return <div className="grid place-items-center py-16 text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
}

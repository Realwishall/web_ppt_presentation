import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FolderPlus, Plus, Trash2, ChevronRight, Layers, FolderOpen, Pencil, Loader2,
  UploadCloud, ClipboardPaste, FileCode2, X, Play,
} from 'lucide-react'
import ChapterIcon from './ChapterIcon'
import FolderEditor from './FolderEditor'
import {
  FOLDER_TAGS, DEFAULT_CHAPTER_SVG, extractHtmlTitle,
  listClasses, createClass, deleteClass,
  listChapters, createChapter, deleteChapter,
  listFolders, createFolder, deleteFolder,
} from '../lib/content'

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
    if (!e?.shiftKey && !confirm('Delete this class and everything inside it? (Chapters/folders are not auto-deleted from storage.)')) return
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
    if (!e?.shiftKey && !confirm('Delete this chapter and its folders?')) return
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
    if (!e?.shiftKey && !confirm('Delete this folder and its HTML?')) return
    await deleteFolder(cls.id, chapter.id, id)
    await load()
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
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
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
      <ul className="space-y-2">
        {items.map((f) => (
          <li key={f.id}
            className="glass flex items-center gap-3 rounded-xl border p-3 transition hover:border-white/15">
            <button onClick={() => navigate('/teach', { state: { folder: f } })}
              title="Preview in presentation view"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-400 transition hover:bg-violet-600 hover:text-white">
              <Play className="h-5 w-5" />
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-100">{f.name}</span>
              <TagBadge tag={f.tag} />
            </span>
            <button onClick={() => setEditing(f)}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500">
              <Pencil className="h-3.5 w-3.5" /> Edit HTML
            </button>
            <IconBtn onClick={(e) => remove(f.id, e)} danger title="Delete folder"><Trash2 className="h-4 w-4" /></IconBtn>
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
function IconBtn({ children, onClick, danger, title }) {
  return (
    <button onClick={onClick} title={title}
      className={`rounded-lg p-2 text-slate-500 transition ${danger ? 'hover:bg-red-500/10 hover:text-red-400' : 'hover:bg-white/10 hover:text-slate-200'}`}>
      {children}
    </button>
  )
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

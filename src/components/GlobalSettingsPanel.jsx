import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Globe, X, Loader2, Plus, Trash2, BookOpen, FileUp, Image as ImageIcon,
  Save, ClipboardPaste, Check, AlertTriangle, Tag, Eye, ArrowUp, ArrowDown,
  Power, Keyboard,
} from 'lucide-react'
import { makeId } from '../lib/content'
import {
  getCurriculum, saveCurriculum, mergeChapters,
  getCoverPages, saveCoverPages, fileToCoverPage, countCoverSheets,
  getBranding, saveBranding, fileToLogoDataUrl, logoBoxStyle,
  parseChapterTopicMap, chaptersToMapText, normaliseChapters,
  EXPORT_VARIABLES, findPlaceholders, substituteVariables,
  FIT_MODES, LOGO_ANCHORS, MAX_COVER_PAGES,
  EMPTY_CURRICULUM, EMPTY_COVER_PAGES, EMPTY_BRANDING, EMPTY_SHORTCUTS,
  getShortcuts, saveShortcuts, shortcutLabel, shortcutFromKeydown,
  DEFAULT_ADD_PAGE_SHORTCUT,
} from '../lib/globalSettings'

const TABS = [
  { id: 'chapters', label: 'Chapters & Topics', icon: BookOpen },
  { id: 'covers', label: 'Start & End Pages', icon: FileUp },
  { id: 'branding', label: 'Logo', icon: ImageIcon },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
]

/**
 * Global settings — one modal for everything shared by every batch of THIS
 * account: the chapter & topic map, the cover pages wrapped around every
 * export, the logo stamped on every sheet, and presenter keyboard shortcuts.
 * Each tab owns its own Firestore document so a slow tab never blocks the
 * others and a save touches only what changed. Nothing auto-saves: teaching
 * data is worth an explicit click.
 */
export default function GlobalSettingsPanel({ onClose }) {
  const [tab, setTab] = useState('chapters')

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="m-auto flex h-[88vh] w-[95vw] max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1524] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-4 py-3">
          <Globe className="h-4 w-4 text-violet-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-100">Global settings</div>
            <div className="truncate text-xs text-slate-500">Shared by every batch in your account — chapters, covers, logo, shortcuts</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/8 px-3 py-2">
          {TABS.map((t) => {
            const on = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  on
                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'chapters' && <ChaptersTab />}
          {tab === 'covers' && <CoversTab />}
          {tab === 'branding' && <BrandingTab />}
          {tab === 'shortcuts' && <ShortcutsTab />}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── shared bits ─────────────────────────── */

function useDoc(loader, empty, deps) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const reload = useCallback(() => {
    setData(null)
    loader()
      .then(setData)
      .catch((e) => { setErr(e.message || 'Could not load.'); setData({ ...empty }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(reload, [reload])
  return [data, setData, err, setErr, reload]
}

function SaveBar({ onSave, busy, dirty, saved, error, children }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-4 flex items-center gap-3 border-t border-white/8 bg-[#0f1524]/95 px-4 py-3 backdrop-blur">
      <div className="min-w-0 flex-1 text-xs">
        {error
          ? <span className="inline-flex items-center gap-1.5 text-red-400"><AlertTriangle className="h-3.5 w-3.5" />{error}</span>
          : saved
            ? <span className="inline-flex items-center gap-1.5 text-emerald-400"><Check className="h-3.5 w-3.5" />Saved</span>
            : <span className="text-slate-500">{children}</span>}
      </div>
      <button
        onClick={onSave}
        disabled={busy || !dirty}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
      </button>
    </div>
  )
}

function Spinner() {
  return <div className="grid place-items-center py-16 text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
}

const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/25'

/* ─────────────────────────── Chapters & topics ─────────────────────────── */

function ChaptersTab() {
  const [data, setData, loadErr] = useDoc(() => getCurriculum(), EMPTY_CURRICULUM, [])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [mapText, setMapText] = useState('')
  const [newName, setNewName] = useState('')
  const mapSeeded = useRef(false)

  // Seed the textarea from Firestore exactly once. Re-seeding on every `data`
  // change would wipe whatever the teacher is halfway through typing.
  useEffect(() => {
    if (!data || mapSeeded.current) return
    mapSeeded.current = true
    setMapText(data.rawMap || chaptersToMapText(data.chapters))
  }, [data])
  useEffect(() => { if (!saved) return undefined; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t) }, [saved])

  const recognised = useMemo(() => parseChapterTopicMap(mapText).length, [mapText])
  if (!data) return <Spinner />

  const chapters = data.chapters
  const patch = (next) => { setData({ ...data, chapters: normaliseChapters(next) }); setDirty(true) }

  function applyMap(replace) {
    const parsed = parseChapterTopicMap(mapText)
    if (!parsed.length) { setErr('Nothing recognised in that paste — check the format hint below.'); return }
    setErr('')
    setData({
      ...data,
      chapters: replace ? parsed : mergeChapters(chapters, parsed),
      rawMap: mapText,
    })
    setDirty(true)
    setShowMap(false)
  }

  async function save() {
    setBusy(true); setErr('')
    try {
      await saveCurriculum({ chapters: data.chapters, rawMap: mapText })
      setDirty(false); setSaved(true)
    } catch (e) { setErr(e.message || 'Save failed.') } finally { setBusy(false) }
  }

  return (
    <div>
      {loadErr && <Banner tone="red">{loadErr}</Banner>}
      <Banner tone="violet">
        One chapter &amp; topic map for <b>all</b> batches. The export form reads it to fill{' '}
        <code className="rounded bg-black/40 px-1">{'{{CHAPTER_NAME}}'}</code> and the topic chips.
      </Banner>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-[16rem] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!newName.trim()) return
            patch([...chapters, { id: makeId('chap'), number: chapters.length + 1, name: newName, topics: [] }])
            setNewName('')
          }}
        >
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="New chapter name (e.g. Laws of Motion)" className={inputCls} />
          <button type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-violet-400/40 hover:text-white">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
        <button onClick={() => setShowMap((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            showMap ? 'bg-violet-600 text-white' : 'border border-white/10 text-slate-300 hover:border-violet-400/40 hover:text-white'
          }`}>
          <ClipboardPaste className="h-4 w-4" /> Paste chapter &amp; topic map
        </button>
      </div>

      {showMap && (
        <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
          <textarea
            value={mapText}
            onChange={(e) => setMapText(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={'1. Kinematics\n   - Motion in one dimension\n   - Relative velocity\n2. Laws of Motion\n   - Newton’s laws\n   - Friction\n\nOptics | Reflection, Refraction, Lenses'}
            className={`${inputCls} font-mono text-xs leading-relaxed`}
          />
          <p className="mt-2 text-xs text-slate-500">
            Numbered or plain lines become chapters; indented, bulleted or <code className="text-slate-400">1.1</code>-style
            lines become their topics. A <code className="text-slate-400">Chapter | a, b, c</code> line works too.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => applyMap(false)}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500">
              Merge into list
            </button>
            <button onClick={() => applyMap(true)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-red-400/40 hover:text-red-300">
              Replace list
            </button>
            <span className="self-center text-xs text-slate-500">{recognised} chapter(s) recognised</span>
          </div>
        </div>
      )}

      {!chapters.length ? (
        <Empty icon={BookOpen} text="No chapters yet. Add one above, or paste your chapter & topic map." />
      ) : (
        <ul className="space-y-2">
          {chapters.map((c, i) => (
            <ChapterRow
              key={c.id}
              chapter={c}
              onChange={(next) => patch(chapters.map((x, j) => (j === i ? next : x)))}
              onDelete={() => patch(chapters.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}

      <SaveBar onSave={save} busy={busy} dirty={dirty} saved={saved} error={err}>
        {chapters.length} chapter{chapters.length === 1 ? '' : 's'} ·{' '}
        {chapters.reduce((n, c) => n + c.topics.length, 0)} topics · used by every batch's export form
      </SaveBar>
    </div>
  )
}

function ChapterRow({ chapter, onChange, onDelete }) {
  const [topic, setTopic] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-xl border border-white/10 bg-white/4 p-3">
      <div className="flex items-center gap-2">
        <input
          type="number" min={1} max={99} value={chapter.number}
          onChange={(e) => onChange({ ...chapter, number: Number(e.target.value) || 1 })}
          className="w-14 shrink-0 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-center text-sm text-slate-100 outline-none focus:border-violet-400"
        />
        <input
          value={chapter.name}
          onChange={(e) => onChange({ ...chapter, name: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-slate-100 outline-none focus:border-white/10 focus:bg-black/25"
        />
        <button onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-xs font-semibold text-slate-400 transition hover:border-violet-400/40 hover:text-violet-300">
          {chapter.topics.length} topic{chapter.topics.length === 1 ? '' : 's'}
        </button>
        <button onClick={onDelete} title="Delete chapter"
          className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="mt-2 border-t border-white/8 pt-2">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chapter.topics.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-xs text-slate-300">
                <Tag className="h-3 w-3 text-violet-400" />{t}
                <button onClick={() => onChange({ ...chapter, topics: chapter.topics.filter((x) => x !== t) })}
                  className="text-slate-500 hover:text-red-400"><X className="h-3 w-3" /></button>
              </span>
            ))}
            {!chapter.topics.length && <span className="text-xs text-slate-500">No topics yet.</span>}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const clean = topic.trim()
              if (!clean || chapter.topics.includes(clean)) return
              onChange({ ...chapter, topics: [...chapter.topics, clean] })
              setTopic('')
            }}
          >
            <input value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder="Add a topic" className={`${inputCls} py-1.5 text-xs`} />
            <button type="submit" className="shrink-0 rounded-lg border border-white/10 px-2.5 text-xs font-semibold text-slate-300 hover:border-violet-400/40 hover:text-white">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </li>
  )
}

/* ─────────────────────────── Start & End pages ─────────────────────────── */

function CoversTab() {
  const [data, setData, loadErr] = useDoc(() => getCoverPages(), EMPTY_COVER_PAGES, [])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(null)   // a page record | null

  useEffect(() => { if (!saved) return undefined; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t) }, [saved])
  // Scanning every uploaded file for {{PLACEHOLDERS}} once per change, not
  // once per row of the variable table below.
  const used = useMemo(() => {
    const set = new Set()
    for (const p of [...(data?.starts || []), ...(data?.ends || [])]) {
      findPlaceholders(p.html).forEach((v) => set.add(v))
    }
    return set
  }, [data])
  if (!data) return <Spinner />

  const patch = (next) => { setData({ ...data, ...next }); setDirty(true); setErr('') }

  async function add(role, files) {
    const key = role === 'end' ? 'ends' : 'starts'
    const list = [...data[key]]
    const problems = []
    for (const file of Array.from(files || [])) {
      if (list.length >= MAX_COVER_PAGES) { problems.push(`only ${MAX_COVER_PAGES} ${key} pages fit`); break }
      try { list.push(await fileToCoverPage(file, role)) }
      catch (e) { problems.push(e.message || `${file.name} could not be read`) }
    }
    patch({ [key]: list })
    // patch() clears the error banner, so a rejection has to be reported after it.
    if (problems.length) setErr(problems.join(' · '))
  }

  function edit(role, i, next) {
    const key = role === 'end' ? 'ends' : 'starts'
    patch({ [key]: data[key].map((p, j) => (j === i ? { ...p, ...next } : p)) })
  }
  function remove(role, i) {
    const key = role === 'end' ? 'ends' : 'starts'
    patch({ [key]: data[key].filter((_, j) => j !== i) })
  }
  function move(role, i, delta) {
    const key = role === 'end' ? 'ends' : 'starts'
    const list = [...data[key]]
    const to = i + delta
    if (to < 0 || to >= list.length) return
    ;[list[i], list[to]] = [list[to], list[i]]
    patch({ [key]: list })
  }

  async function save() {
    setBusy(true); setErr('')
    try { await saveCoverPages(data); setDirty(false); setSaved(true) }
    catch (e) { setErr(e.message || 'Save failed.') } finally { setBusy(false) }
  }

  const liveStarts = data.starts.filter((p) => p.enabled !== false).length
  const liveEnds = data.ends.filter((p) => p.enabled !== false).length

  return (
    <div>
      {loadErr && <Banner tone="red">{loadErr}</Banner>}
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        These HTML pages wrap <b className="text-slate-300">every PDF exported from presentation mode</b> — all the
        Starting Pages first, in this order, then the board, then all the Ending Pages. Each one is scaled to
        fill the whole PDF sheet. Put <code className="rounded bg-black/40 px-1 text-violet-300">{'{{VARIABLE}}'}</code>{' '}
        placeholders anywhere in them and their values are filled in from the form shown when you click Export.
      </p>

      <PageList
        role="start" title="Starting Pages" pages={data.starts}
        onAdd={(files) => add('start', files)}
        onEdit={(i, next) => edit('start', i, next)}
        onRemove={(i) => remove('start', i)}
        onMove={(i, d) => move('start', i, d)}
        onPreview={setPreview}
      />
      <div className="h-4" />
      <PageList
        role="end" title="Ending Pages" pages={data.ends}
        onAdd={(files) => add('end', files)}
        onEdit={(i, next) => edit('end', i, next)}
        onRemove={(i) => remove('end', i)}
        onMove={(i, d) => move('end', i, d)}
        onPreview={setPreview}
      />

      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/4 px-3 py-2.5 text-sm text-slate-300">
        <input type="checkbox" checked={data.logoOnCovers}
          onChange={(e) => patch({ logoOnCovers: e.target.checked })}
          className="h-4 w-4 accent-violet-500" />
        Also stamp the global logo on these cover pages
        <span className="text-xs text-slate-500">(off by default — covers usually carry their own branding)</span>
      </label>

      <div className="mt-5 rounded-xl border border-white/10 bg-white/4 p-3">
        <SectionTitle icon={Tag}>Available variables</SectionTitle>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {EXPORT_VARIABLES.map((v) => {
            const inUse = used.has(v.key)
            return (
              <div key={v.key} className="flex items-baseline gap-2 text-xs">
                <code className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${
                  inUse ? 'bg-emerald-500/15 text-emerald-300' : 'bg-black/40 text-violet-300'
                }`}>
                  {`{{${v.key}}}`}
                </code>
                <span className="min-w-0 text-slate-400">{v.label}</span>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Green = found in one of your uploaded pages. An unknown placeholder is left as-is in the PDF so a typo is visible.
        </p>
      </div>

      {preview && (
        <PreviewModal
          title={`${preview.name} (sample values)`}
          html={substituteVariables(preview.html, {
            batchCode: 'JEE-2027-A', chapterNumber: 4, chapterName: 'Laws of Motion',
            lectureNumber: 7, topics: ['Friction', 'Pulley systems', 'Free-body diagrams'],
            pageCount: 12,
          })}
          onClose={() => setPreview(null)}
        />
      )}

      <SaveBar onSave={save} busy={busy} dirty={dirty} saved={saved} error={err}>
        {liveStarts} start page{liveStarts === 1 ? '' : 's'} · {liveEnds} end page{liveEnds === 1 ? '' : 's'} added to every export
      </SaveBar>
    </div>
  )
}

function PageList({ role, title, pages, onAdd, onEdit, onRemove, onMove, onPreview }) {
  const ref = useRef(null)
  return (
    <div className="rounded-xl border border-white/10 bg-white/4 p-3">
      <div className="mb-2 flex items-center gap-2">
        <FileUp className="h-4 w-4 text-violet-400" />
        <span className="flex-1 text-sm font-semibold text-slate-200">{title}</span>
        <span className="text-xs text-slate-500">{pages.length}/{MAX_COVER_PAGES}</span>
      </div>

      {!pages.length ? (
        <p className="mb-2 rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-xs text-slate-500">
          None yet — the PDF will start straight on the board.
        </p>
      ) : (
        <ul className="mb-2 space-y-2">
          {pages.map((p, i) => {
            const kb = Math.max(1, Math.round((p.html || '').length / 1024))
            const vars = findPlaceholders(p.html)
            const sheets = countCoverSheets(p.html)
            const off = p.enabled === false
            return (
              <li key={p.id} className={`rounded-lg border border-white/10 bg-black/20 p-2.5 ${off ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-violet-500/15 text-xs font-bold text-violet-300">
                    {i + 1}
                  </span>
                  <input
                    value={p.name}
                    onChange={(e) => onEdit(i, { name: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-100 outline-none focus:border-white/10 focus:bg-black/25"
                  />
                  {sheets > 1 && (
                    <span title={`This file holds ${sheets} slides — each becomes its own PDF page`}
                      className="shrink-0 rounded-full border border-violet-400/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                      {sheets} sheets
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-slate-500">{kb} KB</span>
                  <button onClick={() => onMove(i, -1)} disabled={i === 0} title="Move up"
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200 disabled:opacity-25">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onMove(i, 1)} disabled={i === pages.length - 1} title="Move down"
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200 disabled:opacity-25">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onEdit(i, { enabled: off })} title={off ? 'Include in exports' : 'Skip in exports'}
                    className={`shrink-0 rounded p-1 hover:bg-white/10 ${off ? 'text-slate-500' : 'text-emerald-400'}`}>
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onPreview(p)} title="Preview with sample values"
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onRemove(i)} title="Remove"
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-8">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                    Fit
                    <select
                      value={p.fit || 'fill'}
                      onChange={(e) => onEdit(i, { fit: e.target.value })}
                      className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-violet-400"
                    >
                      {FIT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </label>
                  <span className="text-[11px] text-slate-600">
                    {FIT_MODES.find((m) => m.id === (p.fit || 'fill'))?.hint}
                  </span>
                  {vars.map((v) => (
                    <span key={v} className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">{`{{${v}}}`}</span>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Snapshot the FileList BEFORE resetting the input: e.target.files is a
          live view of the input, so clearing .value first hands onAdd an empty
          list and the upload silently does nothing. */}
      <input ref={ref} type="file" accept=".html,.htm,text/html" multiple className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || [])
          e.target.value = ''
          onAdd(picked)
        }} />
      <button onClick={() => ref.current?.click()} disabled={pages.length >= MAX_COVER_PAGES}
        className="w-full rounded-lg border border-dashed border-white/15 px-3 py-3 text-xs text-slate-400 transition hover:border-violet-400/40 hover:text-slate-200 disabled:opacity-40">
        <Plus className="mr-1 inline h-3.5 w-3.5" />
        Add {role === 'end' ? 'an ending' : 'a starting'} page (HTML)
      </button>
    </div>
  )
}

function PreviewModal({ title, html, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex bg-slate-950/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="m-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1524]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
          <Eye className="h-4 w-4 text-violet-400" />
          <span className="flex-1 truncate text-sm font-semibold text-slate-100">{title}</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* sandbox without allow-scripts: this is an untrusted uploaded file */}
        <iframe title={title} sandbox="" srcDoc={html || '<p style="font:14px sans-serif;padding:2rem">Nothing uploaded yet.</p>'}
          className="min-h-0 flex-1 border-0 bg-white" />
      </div>
    </div>
  )
}

/* ─────────────────────────── Branding (global logo) ─────────────────────────── */

function BrandingTab() {
  const [data, setData, loadErr] = useDoc(() => getBranding(), EMPTY_BRANDING, [])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const ref = useRef(null)

  useEffect(() => { if (!saved) return undefined; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t) }, [saved])
  if (!data) return <Spinner />

  const patch = (next) => { setData({ ...data, ...next }); setDirty(true); setErr('') }

  async function pick(file) {
    if (!file) return
    try {
      const dataUrl = await fileToLogoDataUrl(file)
      patch({ dataUrl, fileName: file.name, enabled: true })
    } catch (e) { setErr(e.message || 'Could not use that image.') }
  }

  async function save() {
    setBusy(true); setErr('')
    try { await saveBranding(data); setDirty(false); setSaved(true) }
    catch (e) { setErr(e.message || 'Save failed.') } finally { setBusy(false) }
  }

  const anchorLabel = LOGO_ANCHORS.find((a) => a.id === data.anchor)?.label || 'Top left'
  // A centered axis has nothing to nudge away from — grey that slider out
  // rather than letting it move a logo that is pinned to the middle.
  const xCentered = data.anchor === 'center' || data.anchor.endsWith('-center')
  const yCentered = data.anchor === 'center' || data.anchor.startsWith('middle-')

  return (
    <div>
      {loadErr && <Banner tone="red">{loadErr}</Banner>}
      <Banner tone="violet">
        This logo is an <b>account-wide</b> setting — it appears on exports from every one of your batches, not just one.
      </Banner>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/4 px-3 py-2.5 text-sm text-slate-200">
            <input type="checkbox" checked={data.enabled} onChange={(e) => patch({ enabled: e.target.checked })}
              className="h-4 w-4 accent-violet-500" />
            Stamp this logo on every exported slide
          </label>

          <input ref={ref} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f) }} />
          <button onClick={() => ref.current?.click()}
            className="mt-3 w-full rounded-lg border border-dashed border-white/15 px-3 py-5 text-xs text-slate-400 transition hover:border-violet-400/40 hover:text-slate-200">
            {data.dataUrl ? `Replace image — ${data.fileName || 'logo'}` : 'Upload a logo image (PNG, JPEG, SVG, WebP…)'}
          </button>
          <p className="mt-1.5 text-xs text-slate-500">
            SVG is kept as vector; raster images are downscaled to 512 px and re-encoded as transparent PNG so a
            JPEG never prints a white box over the dark board.
          </p>

          <div className="mt-4">
            <SectionTitle icon={ImageIcon}>Position</SectionTitle>
            <div className="flex flex-wrap items-start gap-4">
              <div className="grid w-[7.5rem] shrink-0 grid-cols-3 gap-1">
                {LOGO_ANCHORS.map((a) => {
                  const on = data.anchor === a.id
                  return (
                    <button key={a.id} title={a.label} onClick={() => patch({ anchor: a.id })}
                      className={`grid aspect-square place-items-center rounded-md border text-[9px] transition ${
                        on
                          ? 'border-violet-400 bg-violet-600/30 text-violet-200'
                          : 'border-white/10 bg-black/25 text-slate-600 hover:border-violet-400/40'
                      }`}>
                      <span className={`block h-1.5 w-1.5 rounded-sm ${on ? 'bg-violet-300' : 'bg-slate-600'}`} />
                    </button>
                  )
                })}
              </div>
              <div className="min-w-[12rem] flex-1 space-y-3">
                <Slider label="Nudge X" suffix="% of width" min={-5} max={45} value={data.offsetXPct}
                  onChange={(v) => patch({ offsetXPct: v })} step={0.5} disabled={xCentered} />
                <Slider label="Nudge Y" suffix="% of height" min={-5} max={45} value={data.offsetYPct}
                  onChange={(v) => patch({ offsetYPct: v })} step={0.5} disabled={yCentered} />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              The nudge pushes the logo inward from the anchor you picked. A centered axis ignores its nudge.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            <Slider label="Size" suffix="% of sheet width" min={3} max={30} value={data.sizePct}
              onChange={(v) => patch({ sizePct: v })} />
            <Slider label="Opacity" suffix="%" min={10} max={100} value={data.opacity}
              onChange={(v) => patch({ opacity: v })} />
          </div>
        </div>

        <div className="sm:w-72">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</div>
          <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10"
            style={{ background: 'linear-gradient(#0d1424,#0b101d)' }}>
            <span className="absolute inset-0 grid place-items-center text-xs text-slate-600">
              {data.dataUrl ? (data.enabled ? 'exported slide' : 'disabled') : 'no logo'}
            </span>
            {data.dataUrl && data.enabled ? (
              <img src={data.dataUrl} alt="Logo preview"
                style={{ position: 'absolute', objectFit: 'contain', maxHeight: '22%', ...logoBoxStyle(data) }} />
            ) : null}
          </div>
          {data.dataUrl && (
            <button onClick={() => patch({ dataUrl: '', fileName: '', enabled: false })}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" /> Remove logo
            </button>
          )}
        </div>
      </div>

      <SaveBar onSave={save} busy={busy} dirty={dirty} saved={saved} error={err}>
        {anchorLabel} of every exported sheet · applies to all batches
      </SaveBar>
    </div>
  )
}

/* ─────────────────────────── Shortcuts ─────────────────────────── */

function ShortcutsTab() {
  const [data, setData, loadErr] = useDoc(() => getShortcuts(), EMPTY_SHORTCUTS, [])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [bindErr, setBindErr] = useState('')

  useEffect(() => { if (!saved) return undefined; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t) }, [saved])

  useEffect(() => {
    if (!capturing) return undefined
    const onKey = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(false)
        setBindErr('')
        return
      }
      const result = shortcutFromKeydown(e)
      if (!result.ok) { setBindErr(result.error); return }
      setData((prev) => ({ ...(prev || EMPTY_SHORTCUTS), addPage: result.shortcut }))
      setDirty(true)
      setCapturing(false)
      setBindErr('')
      setErr('')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, setData])

  if (!data) return <Spinner />

  async function save() {
    setBusy(true); setErr('')
    try {
      await saveShortcuts(data)
      setDirty(false); setSaved(true)
    } catch (e) { setErr(e.message || 'Save failed.') } finally { setBusy(false) }
  }

  const label = shortcutLabel(data.addPage)

  return (
    <div>
      {loadErr && <Banner tone="red">{loadErr}</Banner>}
      <Banner tone="violet">
        These keys apply in <b>presentation mode</b> on every machine you sign into. Default for a new blank page is <b>N</b>.
      </Banner>

      <div className="rounded-xl border border-white/10 bg-white/4 p-3">
        <SectionTitle icon={Keyboard}>Add a blank page</SectionTitle>
        <p className="mb-3 text-xs text-slate-400">
          Press this key during the lesson to insert a blank page after the current one.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <kbd className={`grid min-w-[2.75rem] place-items-center rounded-lg border px-3 py-2 text-sm font-bold tracking-wide ${
            capturing
              ? 'border-violet-400 bg-violet-500/20 text-violet-100'
              : 'border-white/15 bg-black/30 text-slate-100'
          }`}>
            {capturing ? '…' : label}
          </kbd>
          <button
            type="button"
            onClick={() => { setCapturing((v) => !v); setBindErr('') }}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              capturing
                ? 'bg-violet-600 text-white'
                : 'border border-white/10 text-slate-300 hover:border-violet-400/40 hover:text-white'
            }`}
          >
            {capturing ? 'Listening…' : 'Change shortcut'}
          </button>
          <button
            type="button"
            onClick={() => {
              setCapturing(false)
              setBindErr('')
              setData({ ...data, addPage: { ...DEFAULT_ADD_PAGE_SHORTCUT } })
              setDirty(true)
            }}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            Reset to N
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {capturing
            ? 'Press the key you want — Esc to cancel. Ctrl / Shift / Alt / Cmd can be held as modifiers.'
            : 'Arrows, Space, Page Up/Down and Enter stay reserved for moving through the lesson.'}
        </p>
        {bindErr && <p className="mt-1.5 text-xs text-red-400">{bindErr}</p>}
      </div>

      <SaveBar onSave={save} busy={busy} dirty={dirty} saved={saved} error={err}>
        Add blank page is {label} · used by every presentation
      </SaveBar>
    </div>
  )
}

function Slider({ label, suffix, min, max, value, onChange, step = 1, disabled }) {
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-slate-300">{label}</span>
        <span className="text-slate-500">{value}{suffix ? ` ${suffix}` : ''}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-500" />
    </div>
  )
}

/* ─────────────────────────── small shared UI ─────────────────────────── */

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-400">
      <Icon className="h-3.5 w-3.5" /> {children}
    </div>
  )
}

function Banner({ tone, children }) {
  const cls = tone === 'red'
    ? 'border-red-500/25 bg-red-500/10 text-red-300'
    : tone === 'emerald'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
      : 'border-violet-500/25 bg-violet-500/10 text-violet-200'
  return <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>
}

function Empty({ icon: Icon, text }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
      <Icon className="mx-auto mb-2 h-7 w-7 text-slate-600" />
      {text}
    </div>
  )
}

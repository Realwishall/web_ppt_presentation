import { useEffect, useMemo, useState } from 'react'
import { X, Save, Loader2, Eye, Code2, Hash } from 'lucide-react'
import { FOLDER_TAGS, updateFolder, readFolderHtml } from '../lib/content'

// Full-screen drawer to edit a folder's single-page HTML (with its CSS & JS
// inline). Left = code, right = live sandboxed preview. The HTML uses the
// presenter's `<section class="page">` format, so what you preview here is
// what the presenter loads when you Teach.
export default function FolderEditor({ classId, chapterId, folder, onClose, onSaved }) {
  const [name, setName] = useState(folder.name || '')
  const [tag, setTag] = useState(folder.tag || FOLDER_TAGS[0])
  // The folder row holds a code, not the document. Fetch the version it points
  // at; a save writes a NEW version, so any session pinned to this one is safe.
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    readFolderHtml(folder)
      .then((text) => { if (alive) { setHtml(text); setPreview(text) } })
      .catch((e) => { if (alive) setErr(e.message || 'Could not load this deck.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.id, folder.code, folder.version])

  // Debounce the preview so typing stays smooth.
  const [preview, setPreview] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setPreview(html), 250)
    return () => clearTimeout(t)
  }, [html])

  // Wrap the authored HTML in a minimal doc, showing only the first `.page`
  // so the preview mirrors a single slide.
  const srcDoc = useMemo(() => wrapPreview(preview), [preview])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    if (!name.trim()) { setErr('Folder name is required.'); return }
    if (loading) { setErr('Still loading this deck — wait a moment.'); return }
    setSaving(true)
    setErr('')
    try {
      // Only send `html` when it actually changed: an untouched save should
      // rename the folder, not mint a pointless new version of the document.
      const patch = { name: name.trim(), tag }
      if (dirty) patch.html = html
      await updateFolder(classId, chapterId, folder.id, patch)
      onSaved()
    } catch (e) {
      setErr(e.message || 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm">
      <div className="m-auto flex h-[92vh] w-[96vw] max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f1a] shadow-2xl shadow-black/60">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/8 px-4 py-3">
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            className="min-w-[8rem] flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-sm font-semibold text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/25"
          />
          <select value={tag} onChange={(e) => setTag(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400 [&>option]:bg-slate-900">
            {FOLDER_TAGS.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button onClick={save} disabled={saving || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 transition hover:bg-white/10 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {err && <div className="border-b border-red-500/25 bg-red-500/10 px-4 py-2 text-sm text-red-400">{err}</div>}

        {/* body: code + preview */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          <div className="flex min-h-0 flex-col border-r border-white/8">
            <PaneLabel icon={Code2} text="HTML · CSS · JS (one page)" />
            {folder.code && (
              <div className="flex items-center gap-1.5 border-b border-white/8 bg-black/20 px-4 py-1.5 font-mono text-[11px] text-slate-500">
                <Hash className="h-3 w-3" />
                <span className="text-slate-300">{folder.code}</span>
                <span>· v{folder.version || 1}</span>
                {dirty && <span className="text-amber-400">· saving creates v{(folder.version || 1) + 1}</span>}
              </div>
            )}
            <textarea
              value={loading ? 'Loading…' : html}
              readOnly={loading}
              onChange={(e) => { setHtml(e.target.value); setDirty(true) }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-[#05070d] p-4 font-mono text-xs leading-relaxed text-slate-100 outline-none"
            />
          </div>
          <div className="flex min-h-0 flex-col">
            <PaneLabel icon={Eye} text="Live preview (first slide)" />
            <div className="min-h-0 flex-1 bg-black/30 p-3">
              <iframe title="Folder preview" sandbox="allow-scripts"
                srcDoc={srcDoc} className="h-full w-full rounded-lg border border-white/10 bg-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PaneLabel({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-white/8 bg-white/4 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
      <Icon className="h-3.5 w-3.5" /> {text}
    </div>
  )
}

// Show only the first `.page` (or the whole doc if there are none), so the
// preview looks like a single presenter slide.
function wrapPreview(text) {
  const css = `*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,sans-serif}
    .page{display:none!important}.page:first-of-type{display:block!important;height:100%}`
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>${css}</style></head><body>${text}</body></html>`
}

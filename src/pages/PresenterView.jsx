import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Library, X, ChevronRight, Layers, FolderOpen, Loader2,
} from 'lucide-react'
import { listClasses, listChapters, listFolders } from '../lib/content'
import ChapterIcon from '../components/ChapterIcon'
import { TagBadge } from '../components/ContentPanel'

// Full-screen host for the standalone presenter panel (public/presenter.html).
// The board gets the whole viewport — no header of our own — so the panel's
// own control strip asks us for the three things it can't do from inside a
// sandboxed iframe: open the Library picker, navigate back out, and release
// full screen. Decks come from Firestore, never from an uploaded file.
export default function PresenterView() {
  const navigate = useNavigate()
  const location = useLocation()
  const iframeRef = useRef(null)
  const [libOpen, setLibOpen] = useState(false)
  // A folder passed via navigation state (e.g. the "Preview" button on the
  // content panel) is auto-loaded once the presenter iframe is ready.
  const pendingFolder = useRef(location.state?.folder || null)

  const post = useCallback((msg) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  // Post a folder's HTML into the presenter iframe as a new deck.
  const loadFolder = useCallback((folder) => {
    post({ type: 'lf-load-deck', text: folder.html || '', name: folder.name || 'Folder' })
    setLibOpen(false)
  }, [post])

  // When the iframe finishes loading, flush any folder queued from navigation.
  const onIframeLoad = useCallback(() => {
    post({ type: 'lf-fs-state', on: !!document.fullscreenElement })
    if (pendingFolder.current) {
      loadFolder(pendingFolder.current)
      pendingFolder.current = null
    }
  }, [loadFolder, post])

  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const d = e.data || {}
      if (d.type === 'lf-open-library') {
        setLibOpen(true)
        post({ type: 'lf-library-ack' })   // tells the panel not to fall back
      } else if (d.type === 'lf-exit') {
        navigate(-1)
      } else if (d.type === 'lf-fullscreen' && !d.on && document.fullscreenElement) {
        // the panel's own exitFullscreen() was refused — we own the iframe,
        // so release it from up here instead
        document.exitFullscreen().catch(() => {})
      }
    }
    // whoever ends up owning the request, the panel is told the truth
    const onFsChange = () => post({ type: 'lf-fs-state', on: !!document.fullscreenElement })
    window.addEventListener('message', onMessage)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [navigate, post])

  return (
    <div className="fixed inset-0 z-50 bg-[#0b0f19]">
      <iframe
        ref={iframeRef}
        title="Presenter panel"
        src="/presenter.html"
        allow="fullscreen"
        onLoad={onIframeLoad}
        className="h-full w-full border-0"
      />

      {libOpen && <LibraryPicker onClose={() => setLibOpen(false)} onPick={loadFolder} />}
    </div>
  )
}

// Drill-down picker over every class → chapter → folder in Firestore.
function LibraryPicker({ onClose, onPick }) {
  const [cls, setCls] = useState(null)
  const [chapter, setChapter] = useState(null)

  return (
    <div className="absolute inset-0 z-10 flex bg-slate-900/70 backdrop-blur-sm" onClick={onClose}>
      <div className="m-auto flex h-[80vh] w-[92vw] max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Library className="h-4 w-4 text-violet-600" />
          <div className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            <Crumb label="Classes" onClick={() => { setCls(null); setChapter(null) }} active={!cls} />
            {cls && (<><ChevronRight className="h-3.5 w-3.5 text-slate-300" /><Crumb label={cls.name} onClick={() => setChapter(null)} active={!chapter} /></>)}
            {chapter && (<><ChevronRight className="h-3.5 w-3.5 text-slate-300" /><Crumb label={chapter.name} active /></>)}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!cls && <ClassPicker onOpen={setCls} />}
          {cls && !chapter && <ChapterPicker cls={cls} onOpen={setChapter} />}
          {cls && chapter && <FolderPicker cls={cls} chapter={chapter} onPick={onPick} />}
        </div>
      </div>
    </div>
  )
}

function useList(fn, deps) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let active = true
    fn().then((r) => { if (active) setItems(r) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return items
}

function ClassPicker({ onOpen }) {
  const items = useList(() => listClasses(), [])
  if (items === null) return <Spinner />
  if (!items.length) return <Empty text="No classes yet. Create content from the dashboard first." />
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <PickRow key={c.id} onClick={() => onOpen(c)}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Layers className="h-4.5 w-4.5" /></span>
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{c.name}</span>
        </PickRow>
      ))}
    </ul>
  )
}

function ChapterPicker({ cls, onOpen }) {
  const items = useList(() => listChapters(cls.id), [cls.id])
  if (items === null) return <Spinner />
  if (!items.length) return <Empty text="No chapters in this class." />
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <PickRow key={c.id} onClick={() => onOpen(c)}>
          <ChapterIcon svg={c.svgIcon} size={36} />
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{c.name}</span>
        </PickRow>
      ))}
    </ul>
  )
}

function FolderPicker({ cls, chapter, onPick }) {
  const items = useList(() => listFolders(cls.id, chapter.id), [cls.id, chapter.id])
  if (items === null) return <Spinner />
  if (!items.length) return <Empty text="No folders in this chapter." />
  return (
    <ul className="space-y-2">
      {items.map((f) => (
        <PickRow key={f.id} onClick={() => onPick(f)}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-600"><FolderOpen className="h-4.5 w-4.5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-slate-900">{f.name}</span>
            <TagBadge tag={f.tag} />
          </span>
          <span className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white">Load</span>
        </PickRow>
      ))}
    </ul>
  )
}

function PickRow({ children, onClick }) {
  return (
    <li>
      <button onClick={onClick}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-violet-200 hover:shadow-md">
        {children}
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </button>
    </li>
  )
}
function Crumb({ label, onClick, active }) {
  return (
    <button onClick={onClick} disabled={active}
      className={`max-w-[12rem] truncate rounded px-1.5 py-0.5 ${active ? 'font-semibold text-slate-900' : 'text-slate-500 hover:bg-slate-100'}`}>
      {label}
    </button>
  )
}
function Spinner() {
  return <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
}
function Empty({ text }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{text}</div>
}

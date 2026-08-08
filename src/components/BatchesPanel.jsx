import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GraduationCap, Presentation, History, Settings, Plus, Trash2, Loader2, Users,
  X, Clock, FileText, Sparkles,
} from 'lucide-react'
import { listBatches, createBatch, deleteBatch } from '../lib/content'
import {
  listSessionHistory,
  loadSessionForReview,
  sessionStatusLabel,
} from '../lib/sessions'
import BatchSettingsPanel from './BatchSettingsPanel'

// Right half of the dashboard: every batch with Teach / Old Session / Setting.
export default function BatchesPanel() {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [sessionsFor, setSessionsFor] = useState(null) // batch {id,name} or null
  const [settingsFor, setSettingsFor] = useState(null) // batch {id,name} or null

  const load = useCallback(async () => setItems(await listBatches()), [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), 2200)
    return () => clearTimeout(t)
  }, [note])

  async function add(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try { await createBatch(name); setName(''); await load() } finally { setBusy(false) }
  }
  async function remove(id) {
    if (!confirm('Delete this batch?')) return
    await deleteBatch(id)
    await load()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-white/8 px-5 py-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-400">
          <GraduationCap className="h-4 w-4" /> Batches
        </div>
        <form onSubmit={add} className="mt-2.5 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="New batch name (e.g. JEE 2026 A)"
            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/25" />
          <button type="submit" disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {note && (
          <div className="mb-3 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-sm text-violet-300">{note}</div>
        )}
        {items === null ? (
          <div className="grid place-items-center py-16 text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
            <Users className="mx-auto mb-2 h-7 w-7 text-slate-600" />
            No batches yet. Add one above.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((b) => (
              <li key={b.id} className="glass rounded-2xl border p-4 transition hover:border-violet-400/25">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25">
                    <GraduationCap className="h-5 w-5" />
                  </span>
                  <h3 className="min-w-0 flex-1 truncate font-semibold text-slate-100">{b.name || b.id}</h3>
                  <button onClick={() => remove(b.id)} title="Delete batch"
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ActionBtn primary icon={Presentation} label="Teach"
                    onClick={() => navigate(`/teach?batch=${encodeURIComponent(b.id)}`)} />
                  {/* Same presenter, but ?fresh=1 tells it to skip the
                      auto-restore of the last session's unexported pages. */}
                  <ActionBtn icon={Sparkles} label="Fresh teach"
                    title="Open the teaching panel on an empty board — do not reload the last session"
                    onClick={() => navigate(`/teach?batch=${encodeURIComponent(b.id)}&fresh=1`)} />
                  <ActionBtn icon={History} label="Old session"
                    onClick={() => setSessionsFor(b)} />
                  <ActionBtn icon={Settings} label="Setting"
                    onClick={() => setSettingsFor(b)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sessionsFor && (
        <OldSessionsModal
          batch={sessionsFor}
          onClose={() => setSessionsFor(null)}
          onOpen={(sessionId) => {
            setSessionsFor(null)
            navigate(`/teach?batch=${encodeURIComponent(sessionsFor.id)}`, {
              state: { batchId: sessionsFor.id, reviewSession: sessionId },
            })
          }}
        />
      )}

      {settingsFor && (
        <BatchSettingsPanel batch={settingsFor} onClose={() => setSettingsFor(null)} />
      )}
    </div>
  )
}

function OldSessionsModal({ batch, onClose, onOpen }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [opening, setOpening] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // Single getDoc: batches/{batchId}/meta/sessionHistory
        const sessions = await listSessionHistory(batch.id)
        if (alive) setRows(sessions)
      } catch (e) {
        console.warn(e)
        if (alive) {
          setRows([])
          setErr(e.message || 'Could not load session history.')
        }
      }
    })()
    return () => { alive = false }
  }, [batch.id])

  async function openSession(row) {
    setOpening(row.id)
    setErr('')
    try {
      const full = await loadSessionForReview(batch.id, row.id)
      if (!full?.pages?.length && !full?.decks?.length) {
        setErr('This session has no saved board data.')
        return
      }
      onOpen(row.id)
    } catch (e) {
      setErr(e.message || 'Could not open this session.')
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="m-auto flex max-h-[85vh] w-[92vw] max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1524] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
          <History className="h-4 w-4 text-violet-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-100">Old sessions</div>
            <div className="truncate text-xs text-slate-500">
              {batch.name}
              {rows && ` · ${rows.length} session${rows.length === 1 ? '' : 's'} · newest first`}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {err && (
            <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
          )}
          {rows === null ? (
            <div className="grid place-items-center py-12 text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
              <FileText className="mx-auto mb-2 h-7 w-7 text-slate-600" />
              No saved sessions yet. Export during Teach to create one.
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => {
                const when = formatWhen(r.updatedAtMs || r.updatedAt)
                const pages = r.pageCount || 0
                const busy = opening === r.id
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => openSession(r)}
                      disabled={!!opening}
                      className="flex w-full flex-col gap-1 rounded-xl border border-white/10 bg-white/4 p-3 text-left transition hover:border-violet-400/40 hover:bg-white/8 disabled:opacity-60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-semibold text-slate-100">
                          {r.title || 'Teaching session'}
                        </span>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin text-violet-400" /> : <StatusPill status={r.status} />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{when}</span>
                        <span>{pages} page{pages === 1 ? '' : 's'}</span>
                        {r.reason === 'export' && <span>Exported pages only</span>}
                        {r.reason === 'timeout' && <span>Full board (auto-save)</span>}
                        {r.fileCount > 0 && <span>{r.fileCount} file{r.fileCount === 1 ? '' : 's'} saved</span>}
                      </div>
                      {!!r.deckNames?.length && (
                        <div className="truncate text-xs text-slate-400">
                          {r.deckNames.join(' · ')}
                        </div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const label = sessionStatusLabel(status)
  const tone = status === 'complete'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : status === 'timeout'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-violet-500/30 bg-violet-500/10 text-violet-300'
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  )
}

function formatWhen(v) {
  if (!v) return 'Unknown time'
  const ms = v?.toMillis?.() || (typeof v === 'number' ? v : Date.parse(v))
  if (!ms || Number.isNaN(ms)) return 'Unknown time'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return 'Unknown time'
  }
}

function ActionBtn({ icon: Icon, label, onClick, primary, title }) {
  return (
    <button onClick={onClick} title={title || label}
      className={`inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-xs font-semibold transition ${
        primary
          ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 hover:brightness-110'
          : 'border border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/5 hover:text-slate-200'
      }`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  )
}

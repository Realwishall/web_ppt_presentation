import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GraduationCap, Presentation, History, Settings, Plus, Trash2, Loader2, Users,
} from 'lucide-react'
import { listBatches, createBatch, deleteBatch } from '../lib/content'

// Right half of the dashboard: every batch with three actions.
// Teach opens the presenter; Old Session and Setting are stubbed for later.
export default function BatchesPanel() {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

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
                <div className="grid grid-cols-3 gap-2">
                  <ActionBtn primary icon={Presentation} label="Teach"
                    onClick={() => navigate(`/teach?batch=${encodeURIComponent(b.id)}`)} />
                  <ActionBtn icon={History} label="Old session"
                    onClick={() => setNote('Old sessions are coming soon.')} />
                  <ActionBtn icon={Settings} label="Setting"
                    onClick={() => setNote('Batch settings are coming soon.')} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ActionBtn({ icon: Icon, label, onClick, primary }) {
  return (
    <button onClick={onClick}
      className={`inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-xs font-semibold transition ${
        primary
          ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 hover:brightness-110'
          : 'border border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/5 hover:text-slate-200'
      }`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Settings, X, Loader2, Plus, Trash2, Users, Save, ClipboardPaste, Check,
  AlertTriangle, FileText, History, RotateCcw, Globe,
} from 'lucide-react'
import { makeId } from '../lib/content'
import {
  getRoster, saveRoster, summariseMarks,
  getBatchSettings, clearExportMemory,
  EMPTY_ROSTER, EMPTY_SETTINGS,
} from '../lib/batchSettings'

const TABS = [
  { id: 'students', label: 'Students & Marks', icon: Users },
  { id: 'memory', label: 'Export memory', icon: History },
]

/**
 * Batch → "Setting". Only what is genuinely per-batch lives here: the roster
 * with its marks table, and the memory of what was typed at the last export
 * (which drives the pre-fill and the lecture counter).
 *
 * The chapter & topic map, the Start/End pages and the logo moved to
 * Global settings — one copy, shared by every batch.
 */
export default function BatchSettingsPanel({ batch, onClose }) {
  const [tab, setTab] = useState('students')

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="m-auto flex h-[88vh] w-[95vw] max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1524] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-4 py-3">
          <Settings className="h-4 w-4 text-violet-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-100">Batch settings</div>
            <div className="truncate text-xs text-slate-500">{batch.name || batch.id}</div>
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
          {tab === 'students' && <StudentsTab batchId={batch.id} />}
          {tab === 'memory' && <ExportMemoryTab batchId={batch.id} />}
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

/* ─────────────────────────── Students & Marks ─────────────────────────── */

function StudentsTab({ batchId }) {
  const [data, setData, loadErr] = useDoc(() => getRoster(batchId), EMPTY_ROSTER, [batchId])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [studentName, setStudentName] = useState('')
  const [studentRoll, setStudentRoll] = useState('')
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [testName, setTestName] = useState('')
  const [testMax, setTestMax] = useState(100)
  const [testDate, setTestDate] = useState('')

  useEffect(() => { if (!saved) return undefined; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t) }, [saved])

  const summary = useMemo(() => (data ? summariseMarks(data) : []), [data])
  if (!data) return <Spinner />

  const { students, tests, marks } = data
  const patch = (next) => { setData({ ...data, ...next }); setDirty(true) }

  function addStudent(e) {
    e.preventDefault()
    if (!studentName.trim()) return
    patch({ students: [...students, { id: makeId('stu'), name: studentName.trim(), roll: studentRoll.trim() }] })
    setStudentName(''); setStudentRoll('')
  }

  function addBulkStudents() {
    // One student per line: "Name" or "Roll, Name" / "Roll<TAB>Name".
    const rows = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!rows.length) return
    const added = rows.map((row) => {
      const m = row.match(/^([\w\-/]+)\s*[,\t|]\s*(.+)$/)
      return m
        ? { id: makeId('stu'), roll: m[1], name: m[2].trim() }
        : { id: makeId('stu'), roll: '', name: row }
    })
    patch({ students: [...students, ...added] })
    setBulk(''); setShowBulk(false)
  }

  function addTest(e) {
    e.preventDefault()
    if (!testName.trim()) return
    patch({ tests: [...tests, { id: makeId('test'), name: testName.trim(), date: testDate, maxMarks: Number(testMax) || 100 }] })
    setTestName(''); setTestDate('')
  }

  function setMark(testId, studentId, value) {
    const row = { ...(marks[testId] || {}) }
    if (value === '') delete row[studentId]
    else row[studentId] = Number(value)
    patch({ marks: { ...marks, [testId]: row } })
  }

  async function save() {
    setBusy(true); setErr('')
    try { await saveRoster(batchId, data); setDirty(false); setSaved(true) }
    catch (e) { setErr(e.message || 'Save failed.') } finally { setBusy(false) }
  }

  return (
    <div>
      {loadErr && <Banner tone="red">{loadErr}</Banner>}

      <SectionTitle icon={Users}>Students</SectionTitle>
      <form onSubmit={addStudent} className="mb-2 flex flex-wrap gap-2">
        <input value={studentRoll} onChange={(e) => setStudentRoll(e.target.value)}
          placeholder="Roll" className={`${inputCls} w-24 shrink-0`} />
        <input value={studentName} onChange={(e) => setStudentName(e.target.value)}
          placeholder="Student name" className={`${inputCls} min-w-[12rem] flex-1`} />
        <button type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-violet-400/40 hover:text-white">
          <Plus className="h-4 w-4" /> Add
        </button>
        <button type="button" onClick={() => setShowBulk((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-violet-400/40 hover:text-white">
          <ClipboardPaste className="h-4 w-4" /> Paste list
        </button>
      </form>

      {showBulk && (
        <div className="mb-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} spellCheck={false}
            placeholder={'One per line:\n101, Aarav Sharma\n102, Diya Patel\nRohan Verma'}
            className={`${inputCls} font-mono text-xs`} />
          <button onClick={addBulkStudents}
            className="mt-2 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500">
            Add {bulk.split(/\r?\n/).filter((l) => l.trim()).length} student(s)
          </button>
        </div>
      )}

      {!students.length ? (
        <Empty icon={Users} text="No students yet." />
      ) : (
        <ul className="mb-5 grid gap-1.5 sm:grid-cols-2">
          {summary.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/4 px-2.5 py-1.5">
              <input value={s.roll} onChange={(e) => patch({ students: students.map((x, j) => (j === i ? { ...x, roll: e.target.value } : x)) })}
                placeholder="—" className="w-14 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-400 outline-none focus:border-white/10 focus:bg-black/25" />
              <input value={s.name} onChange={(e) => patch({ students: students.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-100 outline-none focus:border-white/10 focus:bg-black/25" />
              {s.percent != null && (
                <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {s.percent}%
                </span>
              )}
              <button onClick={() => patch({ students: students.filter((_, j) => j !== i) })}
                className="shrink-0 rounded p-1 text-slate-600 hover:bg-red-500/10 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle icon={FileText}>Tests</SectionTitle>
      <form onSubmit={addTest} className="mb-3 flex flex-wrap gap-2">
        <input value={testName} onChange={(e) => setTestName(e.target.value)}
          placeholder="Test name (e.g. Weekly Test 3)" className={`${inputCls} min-w-[12rem] flex-1`} />
        <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)}
          className={`${inputCls} w-40 shrink-0`} />
        <input type="number" min={1} value={testMax} onChange={(e) => setTestMax(e.target.value)}
          title="Maximum marks" className={`${inputCls} w-24 shrink-0`} />
        <button type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-violet-400/40 hover:text-white">
          <Plus className="h-4 w-4" /> Add test
        </button>
      </form>

      {!tests.length || !students.length ? (
        <Empty icon={FileText} text={
          !students.length ? 'Add students first, then a test, to enter marks.' : 'No tests yet — add one to start entering marks.'
        } />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-white/5">
                <th className="sticky left-0 z-10 bg-[#141b2d] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Student
                </th>
                {tests.map((t, i) => (
                  <th key={t.id} className="min-w-[7rem] px-2 py-2 text-center text-xs font-semibold text-slate-300">
                    <div className="flex items-center justify-center gap-1">
                      <span className="truncate" title={t.name}>{t.name}</span>
                      <button onClick={() => patch({ tests: tests.filter((_, j) => j !== i) })}
                        className="rounded p-0.5 text-slate-600 hover:text-red-400"><X className="h-3 w-3" /></button>
                    </div>
                    <div className="text-[10px] font-normal text-slate-500">
                      /{t.maxMarks}{t.date ? ` · ${t.date}` : ''}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.id} className="border-t border-white/8">
                  <td className="sticky left-0 z-10 max-w-[10rem] truncate bg-[#0f1524] px-3 py-1.5 text-slate-200">
                    {s.roll && <span className="mr-1.5 text-xs text-slate-500">{s.roll}</span>}{s.name}
                  </td>
                  {tests.map((t) => (
                    <td key={t.id} className="px-1 py-1 text-center">
                      <input
                        type="number" min={0} max={t.maxMarks}
                        value={marks[t.id]?.[s.id] ?? ''}
                        onChange={(e) => setMark(t.id, s.id, e.target.value)}
                        placeholder="—"
                        className="w-16 rounded border border-white/10 bg-black/25 px-1 py-1 text-center text-sm text-slate-100 outline-none focus:border-violet-400"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-center text-xs">
                    {s.taken
                      ? <span className="text-slate-300">{s.total}<span className="text-slate-600">/{s.outOf}</span> <span className="text-emerald-400">{s.percent}%</span></span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SaveBar onSave={save} busy={busy} dirty={dirty} saved={saved} error={err}>
        {students.length} student{students.length === 1 ? '' : 's'} · {tests.length} test{tests.length === 1 ? '' : 's'}
      </SaveBar>
    </div>
  )
}

/* ─────────────────────────── Export memory ─────────────────────────── */

/**
 * What this batch's export form will pre-fill next time. Read-only on
 * purpose: it is written by exporting, and the only sensible edit is to throw
 * it away — which restarts the lecture counter at 1.
 */
function ExportMemoryTab({ batchId }) {
  const [data, setData, loadErr, , reload] = useDoc(
    () => getBatchSettings(batchId), EMPTY_SETTINGS, [batchId],
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!data) return <Spinner />
  const last = data.lastExport || {}
  const has = !!(last.batchCode || last.chapterNumber != null || last.lectureNumber != null)

  async function reset() {
    setBusy(true); setErr('')
    try { await clearExportMemory(batchId); setData(null); reload() }
    catch (e) { setErr(e.message || 'Could not reset.') } finally { setBusy(false) }
  }

  return (
    <div>
      {loadErr && <Banner tone="red">{loadErr}</Banner>}
      <Banner tone="violet">
        <Globe className="mr-1 inline h-3.5 w-3.5" />
        Chapters &amp; topics, the Start/End pages and the logo are now in <b>Global settings</b> (top right of the
        dashboard) — one copy for every batch. Only the roster and this pre-fill are per-batch.
      </Banner>

      {!has ? (
        <Empty icon={History} text="Nothing remembered yet — the first export from this batch fills this in." />
      ) : (
        <>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Fact label="Batch code" value={last.batchCode || '—'} />
            <Fact label="Chapter" value={
              last.chapterNumber != null
                ? `${last.chapterNumber}${last.chapterName ? `. ${last.chapterName}` : ''}`
                : '—'
            } />
            <Fact label="Lecture used" value={last.lectureNumber != null ? String(last.lectureNumber) : '—'} />
            <Fact label="Next lecture offered" value={
              last.lectureNumber != null ? String(Math.min(40, Number(last.lectureNumber) + 1)) : '1'
            } />
            <Fact label="Topics" value={(last.topics || []).join(', ') || '—'} wide />
            <Fact label="Last export" value={last.atMs ? new Date(last.atMs).toLocaleString() : '—'} wide />
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            The export form opens with these values filled in and the lecture number one higher. Pick a different
            chapter in that form and the lecture number drops back to 1 automatically.
          </p>
        </>
      )}

      {err && <Banner tone="red">{err}</Banner>}
      <button onClick={reset} disabled={busy || !has}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        Reset — next export starts at lecture 1
      </button>
    </div>
  )
}

function Fact({ label, value, wide }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/4 px-3 py-2 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-100">{value}</dd>
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

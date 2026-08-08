// Per-batch settings (Batch → "Setting"):
//
//   batches/{batchId}/meta/settings      { lastExport{…}, chapters[] ← legacy }
//   batches/{batchId}/meta/roster        { students[], tests[], marks{} }
//   batches/{batchId}/meta/exportPages   { startHtml, endHtml, … }  ← legacy
//
// Only two things are genuinely per-batch: the roster, and the memory of what
// the teacher typed the last time they exported (so the next export pre-fills
// and the lecture counter can advance). The chapter & topic map, the cover
// pages and the logo are GLOBAL and live in src/lib/globalSettings.js.
//
// The legacy fields above are still read — a batch that was configured before
// the split keeps working, and `migrateFromBatches()` lifts it into the global
// docs the first time the Global settings panel is opened.
//
// Everything is a small number of whole-document reads/writes: these panels
// are opened rarely and edited in bursts, so a doc-per-concern beats a
// collection of tiny docs both in cost and in code.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { makeId } from './content'
import {
  getBranding,
  getCoverPages,
  getCurriculum,
  normaliseChapters,
  DEFAULT_FIT,
} from './globalSettings'

const settingsRef = (batchId) => doc(db, 'batches', batchId, 'meta', 'settings')
const rosterRef = (batchId) => doc(db, 'batches', batchId, 'meta', 'roster')
const legacyPagesRef = (batchId) => doc(db, 'batches', batchId, 'meta', 'exportPages')

// ───────────────────────── settings doc (export memory) ─────────────────────────

export const EMPTY_LAST_EXPORT = {
  batchCode: '',
  chapterNumber: null,
  chapterName: '',
  lectureNumber: null,
  topics: [],
  atMs: null,
}

export const EMPTY_SETTINGS = { chapters: [], rawMap: '', lastExport: { ...EMPTY_LAST_EXPORT } }

export async function getBatchSettings(batchId) {
  if (!batchId) return { ...EMPTY_SETTINGS }
  const snap = await getDoc(settingsRef(batchId))
  if (!snap.exists()) return { ...EMPTY_SETTINGS }
  const d = snap.data()
  return {
    // Legacy — kept so a pre-split batch still has chapters until migration.
    chapters: normaliseChapters(d.chapters),
    rawMap: d.rawMap || '',
    lastExport: {
      batchCode: d.lastExport?.batchCode || '',
      chapterNumber: d.lastExport?.chapterNumber ?? null,
      chapterName: d.lastExport?.chapterName || '',
      lectureNumber: d.lastExport?.lectureNumber ?? null,
      topics: Array.isArray(d.lastExport?.topics) ? d.lastExport.topics : [],
      atMs: d.lastExport?.atMs ?? null,
    },
  }
}

export async function saveBatchSettings(batchId, patch) {
  if (!batchId) throw new Error('batchId is required')
  const clean = { ...patch }
  if (clean.chapters) clean.chapters = normaliseChapters(clean.chapters)
  await setDoc(
    settingsRef(batchId),
    { batchId, ...clean, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
    { merge: true },
  )
}

/**
 * Remember what the teacher typed at export time so the next export can
 * pre-fill it — including the chapter, which is what tells the next export
 * whether the lecture counter should advance or restart at 1.
 */
export async function rememberExportValues(batchId, values) {
  if (!batchId || !values) return
  await setDoc(
    settingsRef(batchId),
    {
      batchId,
      lastExport: {
        batchCode: values.batchCode || '',
        chapterNumber: values.chapterNumber ?? null,
        chapterName: values.chapterName || '',
        lectureNumber: values.lectureNumber ?? null,
        topics: Array.isArray(values.topics) ? values.topics : [],
        atMs: Date.now(),
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

/** Forget the pre-fill for this batch — the next export starts from scratch. */
export async function clearExportMemory(batchId) {
  if (!batchId) throw new Error('batchId is required')
  await setDoc(
    settingsRef(batchId),
    { batchId, lastExport: { ...EMPTY_LAST_EXPORT }, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

// ───────────────────────── students, tests & marks ─────────────────────────

export const EMPTY_ROSTER = { students: [], tests: [], marks: {} }

export async function getRoster(batchId) {
  if (!batchId) return { ...EMPTY_ROSTER }
  const snap = await getDoc(rosterRef(batchId))
  if (!snap.exists()) return { ...EMPTY_ROSTER }
  const d = snap.data()
  return {
    students: (d.students || []).map((s, i) => ({
      id: s.id || makeId('stu'),
      name: s.name || `Student ${i + 1}`,
      roll: s.roll || '',
    })),
    tests: (d.tests || []).map((t, i) => ({
      id: t.id || makeId('test'),
      name: t.name || `Test ${i + 1}`,
      date: t.date || '',
      maxMarks: Number(t.maxMarks) > 0 ? Number(t.maxMarks) : 100,
    })),
    // marks[testId][studentId] = number | null
    marks: d.marks || {},
  }
}

export async function saveRoster(batchId, roster) {
  if (!batchId) throw new Error('batchId is required')
  // Drop marks for tests/students that no longer exist so the doc cannot grow
  // unbounded as the roster churns over a year.
  const testIds = new Set((roster.tests || []).map((t) => t.id))
  const studentIds = new Set((roster.students || []).map((s) => s.id))
  const marks = {}
  for (const [testId, row] of Object.entries(roster.marks || {})) {
    if (!testIds.has(testId)) continue
    const kept = {}
    for (const [studentId, score] of Object.entries(row || {})) {
      if (studentIds.has(studentId) && score !== null && score !== '') kept[studentId] = Number(score)
    }
    marks[testId] = kept
  }
  await setDoc(rosterRef(batchId), {
    batchId,
    students: roster.students || [],
    tests: roster.tests || [],
    marks,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  })
}

/** Per-student totals and percentage across every test that has a score. */
export function summariseMarks(roster) {
  const { students = [], tests = [], marks = {} } = roster || {}
  return students.map((s) => {
    let got = 0
    let max = 0
    let taken = 0
    for (const t of tests) {
      const v = marks[t.id]?.[s.id]
      if (v == null || v === '') continue
      got += Number(v) || 0
      max += Number(t.maxMarks) || 0
      taken += 1
    }
    return {
      ...s,
      total: got,
      outOf: max,
      taken,
      percent: max > 0 ? Math.round((got / max) * 1000) / 10 : null,
    }
  })
}

// ───────────────────────── what the presenter needs at export time ─────────────────────────

/** A pre-split batch's single Starting/Ending page, as cover-page records. */
async function legacyBatchCovers(batchId) {
  if (!batchId) return { starts: [], ends: [], logoOnCovers: false }
  try {
    const snap = await getDoc(legacyPagesRef(batchId))
    if (!snap.exists()) return { starts: [], ends: [], logoOnCovers: false }
    const d = snap.data()
    const make = (html, name, role) =>
      html ? [{ id: `${role}_legacy`, name: name || `${role}.html`, role, fit: DEFAULT_FIT, enabled: true, html }] : []
    return {
      starts: make(d.startHtml, d.startName, 'start'),
      ends: make(d.endHtml, d.endName, 'end'),
      logoOnCovers: !!d.logoOnCovers,
    }
  } catch (err) {
    console.warn('Legacy cover page read failed:', err)
    return { starts: [], ends: [], logoOnCovers: false }
  }
}

/**
 * One call for everything the presenter iframe needs at export time.
 *
 * Global first, per-batch only as a fallback: a batch that was configured
 * before chapters and cover pages became global keeps exporting exactly as it
 * did, and stops using its own copy the moment the global one is filled in.
 */
export async function loadPresenterExportConfig(batchId) {
  const [settings, curriculum, covers, branding] = await Promise.all([
    getBatchSettings(batchId),
    getCurriculum(),
    getCoverPages(),
    getBranding(),
  ])

  let { starts, ends, logoOnCovers } = covers
  if (!starts.length && !ends.length) {
    const legacy = await legacyBatchCovers(batchId)
    starts = legacy.starts
    ends = legacy.ends
    logoOnCovers = logoOnCovers || legacy.logoOnCovers
  }

  const chapters = curriculum.chapters.length ? curriculum.chapters : settings.chapters

  return {
    chapters,
    lastExport: settings.lastExport,
    // Only enabled pages are sent — the panel toggles a page off without
    // making the teacher delete and re-upload it next week.
    startPages: starts.filter((p) => p.enabled !== false && p.html),
    endPages: ends.filter((p) => p.enabled !== false && p.html),
    logoOnCovers,
    logo: branding.enabled && branding.dataUrl ? branding : null,
  }
}

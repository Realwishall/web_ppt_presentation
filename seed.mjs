/**
 * Seed script for PhysicsBoard.
 *
 * Writes the active batch, ~35 master chapters (Class 11 & 12) each with a
 * unique inline-SVG gradient icon and a one-line description, plus two topics
 * per chapter and a couple of demo slides per topic, using Firestore
 * writeBatch (chunked to stay under the 500-op limit).
 *
 * Firestore rules only allow the admin UID to write, so this script signs in
 * with an admin email/password before writing.
 *
 * Usage:
 *   1. Fill .env (see .env.example) with your VITE_FIREBASE_* values.
 *   2. Provide admin credentials via env:
 *        SEED_ADMIN_EMAIL=...  SEED_ADMIN_PASSWORD=...
 *      (PowerShell:  $env:SEED_ADMIN_EMAIL="you@x.com"; $env:SEED_ADMIN_PASSWORD="..." )
 *   3. node seed.mjs      (or:  npm run seed)
 */
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  writeBatch,
} from 'firebase/firestore'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'

// --- tiny .env loader (so we don't need a dependency) ---
function loadEnv() {
  try {
    const raw = readFileSync(new URL('./.env', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env file — rely on real environment */
  }
}
loadEnv()

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
}

const BATCH_ID = 'batch_jee_2026_a'

// -------------------- chapter catalogue --------------------
// [class, title, glyph, one-line description]
const CHAPTERS_11 = [
  ['Basic Maths & Vectors', '√', 'Algebra, calculus & vector tools you need for physics.'],
  ['Units & Dimensions', 'μ', 'SI units, dimensional analysis and error estimation.'],
  ['Kinematics', 'v', 'Describing motion: displacement, velocity and acceleration.'],
  ['Motion in a Plane', '↗', 'Projectiles and relative motion in two dimensions.'],
  ['Laws of Motion', 'F', "Newton's laws, free-body diagrams and equilibrium."],
  ['Friction', '▦', 'Static and kinetic friction on surfaces and inclines.'],
  ['Work, Energy & Power', 'W', 'Work–energy theorem and conservation of energy.'],
  ['Circular Motion', '⟳', 'Centripetal force, banking and vertical circles.'],
  ['Centre of Mass & Collisions', '⊕', 'Momentum, centre of mass and collision types.'],
  ['Rotational Motion', 'ω', 'Torque, moment of inertia and angular momentum.'],
  ['Gravitation', 'g', "Newton's gravity, orbits and Kepler's laws."],
  ['Mechanical Properties of Solids', '⊓', 'Stress, strain and elastic moduli of materials.'],
  ['Mechanical Properties of Fluids', '≈', 'Pressure, buoyancy, viscosity and Bernoulli.'],
  ['Thermal Properties of Matter', '°', 'Heat, expansion, calorimetry and heat transfer.'],
  ['Thermodynamics', 'Δ', 'Laws of thermodynamics and heat engines.'],
  ['Kinetic Theory of Gases', '⚛', 'Molecular model of gases and the gas laws.'],
  ['Oscillations (SHM)', '∿', 'Simple harmonic motion, springs and pendulums.'],
  ['Waves', '〜', 'Wave motion, superposition and standing waves.'],
  ['Sound Waves', '♪', 'Sound, resonance, beats and the Doppler effect.'],
]
const CHAPTERS_12 = [
  ['Electrostatics', '+', 'Charges, fields, potential and Gauss’s law.'],
  ['Capacitance', 'C', 'Capacitors, dielectrics and energy storage.'],
  ['Current Electricity', 'I', "Ohm's law, circuits and Kirchhoff's rules."],
  ['Moving Charges & Magnetism', 'B', 'Magnetic force, fields and Ampère’s law.'],
  ['Magnetism & Matter', 'M', 'Bar magnets, magnetic materials and the Earth’s field.'],
  ['Electromagnetic Induction', 'Φ', "Faraday's and Lenz's laws of induction."],
  ['Alternating Current', '∼', 'AC circuits, reactance, resonance and transformers.'],
  ['Electromagnetic Waves', 'λ', 'The EM spectrum and properties of EM waves.'],
  ['Ray Optics', '▷', 'Reflection, refraction, lenses and instruments.'],
  ['Wave Optics', ')', 'Interference, diffraction and polarisation.'],
  ['Dual Nature of Radiation', 'h', 'Photoelectric effect and matter waves.'],
  ['Atoms', '☉', 'Bohr model and atomic spectra.'],
  ['Nuclei', '☢', 'Radioactivity, binding energy, fission & fusion.'],
  ['Semiconductor Electronics', 'Si', 'Diodes, transistors and logic gates.'],
  ['Communication Systems', '((', 'Modulation and the basics of communication.'],
  ['Experimental Physics', '±', 'Key experiments, instruments and error analysis.'],
]

function slugify(title) {
  return title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function icon(glyph, i) {
  const h = Math.round((i * 360) / 35)
  const c1 = `hsl(${h} 82% 58%)`
  const c2 = `hsl(${(h + 40) % 360} 72% 48%)`
  return (
    `<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="cg${i}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="48" height="48" rx="12" fill="url(#cg${i})"/>` +
    `<text x="24" y="32" font-family="system-ui,Segoe UI,sans-serif" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${glyph}</text>` +
    `</svg>`
  )
}

// Build the full chapter list with order + ids.
function buildChapters() {
  const out = []
  let order = 0
  const push = (cls, arr) => {
    for (const [title, glyph, description] of arr) {
      out.push({
        id: slugify(title),
        order,
        class: cls,
        title,
        description,
        svgIcon: icon(glyph, order),
      })
      order += 1
    }
  }
  push(11, CHAPTERS_11)
  push(12, CHAPTERS_12)
  return out
}

// Demo slides for a topic. Each slide is a single self-contained HTML page
// (its own HTML/CSS/JS), rendered in a sandboxed iframe by the player.
function demoSlides(chapterTitle, topicTitle) {
  return [
    {
      id: 'slide_1',
      order: 0,
      title: `${topicTitle} — overview`,
      html: `<div class="wrap">
  <span class="tag">${chapterTitle}</span>
  <h1>${topicTitle}</h1>
  <p>An interactive introduction. Every slide is its own HTML page with custom CSS &amp; JS.</p>
</div>`,
      css: `.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:40px;font-family:system-ui,'Segoe UI',sans-serif;color:#1e293b;background:radial-gradient(circle at 30% 20%,#eef2ff,#faf5ff)}
.tag{font:600 12px system-ui;letter-spacing:.08em;text-transform:uppercase;color:#6366f1;background:#eef2ff;padding:4px 10px;border-radius:999px}
h1{margin:0;font-size:46px;background:linear-gradient(90deg,#6366f1,#8b5cf6);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:0;max-width:620px;font-size:20px;color:#475569}`,
      js: '',
    },
    {
      id: 'slide_2',
      order: 1,
      title: `${topicTitle} — interactive demo`,
      html: `<div class="d">
  <h2>Tap to accelerate 🚀</h2>
  <button id="b">Boost</button>
  <div class="v" id="v">v = 0 m/s</div>
</div>`,
      css: `.d{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:system-ui,sans-serif;background:#eef2ff;color:#3730a3}
h2{margin:0;font-size:30px}
button{border:0;padding:12px 24px;border-radius:12px;background:#4f46e5;color:#fff;font:700 18px system-ui;cursor:pointer}
button:active{transform:scale(.96)}
.v{font:800 40px system-ui}`,
      js: "let v=0;document.getElementById('b').onclick=()=>{v+=9.8;document.getElementById('v').textContent='v = '+v.toFixed(1)+' m/s'}",
    },
  ]
}

async function main() {
  for (const [k, val] of Object.entries(firebaseConfig)) {
    if (!val) {
      console.error(`Missing Firebase config value: ${k}. Fill .env first (see .env.example).`)
      process.exit(1)
    }
  }
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!email || !password) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (an admin account allowed to write).')
    process.exit(1)
  }

  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)
  const auth = getAuth(app)

  console.log('Signing in as admin…')
  const cred = await signInWithEmailAndPassword(auth, email, password)
  console.log('Signed in as', cred.user.uid)

  const chapters = buildChapters()

  // Collect all write ops, then commit in chunks of 400.
  const ops = []
  const set = (ref, data) => ops.push({ ref, data })

  // Batch document with chapter id list.
  set(doc(db, 'batches', BATCH_ID), {
    id: BATCH_ID,
    name: 'JEE 2026 Batch A',
    chapters: chapters.map((c) => c.id),
    createdAt: new Date().toISOString(),
  })

  for (const c of chapters) {
    set(doc(db, 'master_chapters', c.id), c)

    const topics = [
      { id: 'introduction', order: 0, title: 'Introduction', description: `Getting started with ${c.title}.` },
      { id: 'core_concepts', order: 1, title: 'Core Concepts', description: `The essential ideas of ${c.title}.` },
    ]
    for (const t of topics) {
      // master topic metadata
      set(doc(db, 'master_chapters', c.id, 'topics', t.id), t)
      // batch slides for the topic
      const slides = demoSlides(c.title, t.title)
      for (const s of slides) {
        set(
          doc(db, 'batches', BATCH_ID, 'chapters', c.id, 'topics', t.id, 'slides', s.id),
          s,
        )
      }
    }
  }

  console.log(`Prepared ${ops.length} writes. Committing…`)
  const CHUNK = 400
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + CHUNK)) batch.set(op.ref, op.data)
    // eslint-disable-next-line no-await-in-loop
    await batch.commit()
    console.log(`  committed ${Math.min(i + CHUNK, ops.length)}/${ops.length}`)
  }

  console.log(`\n✅ Seeded ${chapters.length} chapters into batch "${BATCH_ID}".`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

# PhysicsBoard

A web-based interactive slide/presentation system that replaces PowerPoint decks for teaching JEE physics. A teacher (admin) authors interactive physics slides stored in Firebase; students log in to view them in a step-by-step presentation player.

Built with **Vite 8 + React 19**, **react-router-dom 7**, **Firebase 12** (Firestore + Auth + Storage), **Tailwind CSS 4**, **framer-motion 12**, and **lucide-react**. Slides export to PNG/PDF via `html-to-image` / `html2canvas` / `jspdf`.

## Quick start

```bash
npm install
cp .env.example .env      # then fill in your Firebase values + admin UID
npm run dev
```

Open http://localhost:5173.

## Firebase setup

1. Create a Firebase project with **Firestore**, **Authentication (Email/Password)**, and **Storage** enabled.
2. Copy your web app config into `.env` (all `VITE_FIREBASE_*` keys). `src/firebase.js` reads these, falling back to harmless placeholders so the app still boots.
3. Create your teacher/admin account in Firebase Auth, copy its **UID**, and set it in two places:
   - `.env` → `VITE_ADMIN_UID` (the client uses this to unlock admin routes)
   - `firestore.rules` → replace `REPLACE_WITH_ADMIN_UID` in `isAdmin()`
4. Deploy the rules: `firebase deploy --only firestore:rules` (or paste them in the console).
5. Create student accounts in Firebase Auth (any authenticated user can read).

## Seeding data

`seed.mjs` writes the active batch (`batch_jee_2026_a`), ~35 chapters across Class 11 & 12 — each with a unique inline-SVG gradient icon and description — plus two topics per chapter and demo slides, using Firestore `writeBatch`.

Because writes are gated to the admin UID, the script signs in with admin credentials:

```bash
# PowerShell
$env:SEED_ADMIN_EMAIL="teacher@example.com"; $env:SEED_ADMIN_PASSWORD="••••••"; npm run seed

# bash
SEED_ADMIN_EMAIL=teacher@example.com SEED_ADMIN_PASSWORD=•••••• npm run seed
```

## Data model (Firestore)

```
master_chapters/{chapterId}         { id, order, class (11|12), title, description, svgIcon }
  topics/{topicId}                  { id, order, title, description }

batches/{batchId}                   { id, name, chapters: [chapterId…], createdAt }
  chapters/{chapterId}
    topics/{topicId}
      slides/{slideId}              { id, order, title, html, css, js }
```

### Slides = single HTML pages

Each slide is one **self-contained HTML page** with its own `html`, `css`, and
`js`. It's rendered in a sandboxed `<iframe srcdoc>` in both the player and the
editor preview, so every page's markup, styles, and scripts are fully isolated
from the app and from each other.

| field   | notes                                             |
|---------|---------------------------------------------------|
| `title` | optional page title (shown in the player chrome)  |
| `html`  | the page body markup                              |
| `css`   | page styles (injected into `<style>`)             |
| `js`    | page script (runs on load, errors shown inline)   |

This is the "folder → topic → HTML page with its own HTML/CSS/JS" model: build any interactive physics visualisation (animations, sliders, simulations) with plain web tech, one page per slide.

## Routes

- `/login` — Firebase email/password sign-in.
- `/` — dashboard: chapters from the active batch, grouped into Class 11 / Class 12.
- `/chapter/:chapterId` — the chapter's topics, ordered by `order`.
- `/topic/:chapterId/:topicId` — the **presentation player** (one HTML page per slide, keyboard nav, PNG/PDF export).
- `/admin`, `/admin/chapter/:chapterId`, `/admin/slide/:chapterId/:topicId/:slideId` — admin-only editors (HTML/CSS/JS panes + live preview).

### Player controls

- **Next / →  / Space / PageDown** — next slide.
- **Prev / ← / PageUp** — previous slide.
- Click the dots to jump between slides.
- **PNG** exports the current slide (fully revealed); **PDF** exports the whole topic.

## Auth & roles

Any authenticated user can **read** everything. Only the single hard-coded admin UID can **write** — enforced both in the UI (`ProtectedRoute adminOnly`) and in `firestore.rules` (`isAuthenticated()` / `isAdmin()`).

## Scripts

| script          | action                    |
|-----------------|---------------------------|
| `npm run dev`   | start Vite dev server     |
| `npm run build` | production build          |
| `npm run preview` | preview the build       |
| `npm run lint`  | run oxlint                |
| `npm run seed`  | seed Firestore            |

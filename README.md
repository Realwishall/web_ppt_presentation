# PhysicsBoard

A web-based interactive slide/presentation system that replaces PowerPoint decks for teaching JEE physics. A teacher authors self-contained HTML decks, then teaches them live on a digital board — writing over the slides, freezing pages, and exporting the lecture as a PDF.

**Every account is its own installation.** Classes, decks, batches, session history and export settings all live under `users/{uid}`, so two teachers signing into the same deployment never see each other's work. Nothing is shared and nothing is admin-gated.

Built with **Vite 8 + React 19**, **react-router-dom 7**, **Firebase 12** (Firestore + Auth), **Tailwind CSS 4**, **framer-motion 12**, and **lucide-react**. Lectures export to PDF through the browser's own print dialog.

## Quick start

```bash
npm install
cp .env.example .env      # then fill in your Firebase values
npm run dev
```

Open http://localhost:5173 and press **Sign up** to create the first account.

## Firebase setup

1. Create a Firebase project with **Firestore** and **Authentication** enabled. Switch on the **Email/Password** provider (and **Phone**, if you want the phone tab on the login page).
2. Copy your web app config into `.env` (all `VITE_FIREBASE_*` keys). `src/firebase.js` reads these, falling back to harmless placeholders so the app still boots without them.
3. Deploy the rules: `firebase deploy --only firestore:rules,storage` (or paste them in the console).

There is no admin UID to configure. Each account creates its own data the first time it saves anything.

## Data model (Firestore)

Everything hangs off the signed-in teacher's uid:

```
users/{uid}/classes/{classId}                        { name, order, visible }
  chapters/{chapterId}                               { name, svgIcon, info, visible }
    folders/{folderId}                               { name, tag, code, version, pageCount }

users/{uid}/content/{code}                           { name, tag, visible, currentVersion }
  versions/{v}                                       { pageCount, chars, text? }   IMMUTABLE
    parts/{i}                                        { i, text }   (HTML over ~700 KB)

users/{uid}/batches/{batchId}                        { name, visible }
  meta/sessionHistory                                { sessions: [ … ] }   one-doc index
  meta/settings                                      { lastExport{…} }
  meta/roster                                        { students[], tests[], marks{} }
  sessions/{sessionId}                               { decks[{code,version}], pages[{ink,…}] }
    chunks/{i}                                       (very long lectures only)

users/{uid}/appSettings/curriculum                   { chapters[], rawMap }
users/{uid}/appSettings/exportPages                  { starts[], ends[], logoOnCovers }
  pages/{pageId}                                     { role, name, fit, html | chunks }
users/{uid}/appSettings/branding                     { dataUrl, anchor, sizePct, … }
```

Three ideas hold this together:

- **A folder is a shelf label, not the document.** The HTML lives once in the content registry under a permanent `code`; the folder row carries `code` + the `version` it points at.
- **Versions are immutable and nothing is ever deleted.** Editing a deck writes a new version; "deleting" anything flips `visible` to false. A session recorded months ago still replays over exactly the slides its ink was drawn on. Immutability is also why versions can be cached in IndexedDB forever.
- **A session stores references, not copies.** It records `{code, version}` per deck plus the page number and the ink — no deck HTML. Teaching one deck to six batches writes the bytes once.

### Decks = self-contained HTML

A deck is one HTML document made of `<section class="page">` slides, with its CSS and JS inline. It renders in a sandboxed iframe, so its markup, styles and scripts are isolated from the app. `class="step"` reveals an element on the next press; `class="clickable"` receives real taps through the ink layer. See `public/deck-authoring-prompt.md` and `docs/components.md` for the full contract.

## Routes

- `/login` — sign in, sign up, or phone OTP.
- `/` — the dashboard: **Content creation** (classes → chapters → folders) on the left, **Batches** on the right, **Global settings** in the header.
- `/teach?batch={batchId}` — the live presenter. If this batch has an unfinished session, the panel *asks* ("Pick up where you left off?") before putting anything on the board; accepting brings back the whole board — every page, exported ones included, with its ink. `&fresh=1` skips the question and starts empty.

### Teaching

- **← / PageUp / Backspace** previous, **→ / PageDown / Space** next (PPT clickers work).
- The control strip opens the Library, undoes ink, toggles full screen, exports, and — with the back arrow — returns to the main screen.
- **Leaving saves.** The back arrow snapshots the board into session history first, unless every page has already gone out through Export.
- 15 minutes of no activity also snapshots the board. You are never signed out and never navigated away.
- **Old session** on a batch reopens any saved board, ink and all.

## Auth

Sign-in, sign-up and phone OTP all land in the same place: a private workspace. `firestore.rules` grants access to a path only when its `{uid}` segment matches the caller, so the isolation is enforced on the server, not just in the client's path building (`src/lib/userScope.js`).

## Scripts

| script            | action                |
|-------------------|-----------------------|
| `npm run dev`     | start Vite dev server |
| `npm run build`   | production build      |
| `npm run preview` | preview the build     |
| `npm run lint`    | run oxlint            |

Deck-authoring tooling (`deck:build`, `deck:check`, `deck:from-json`, …) is documented in `tools/README.md` and `docs/RUNBOOK.md`.

> `seed.mjs` / `npm run seed` predate this data model — it writes `master_chapters` and `batches/{id}/chapters/…`, which nothing reads and the current rules deny. Ignore it or delete it.

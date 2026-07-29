# Runbook — converting one deck, end to end

Strategy behind this: `public/conversion-pipeline.md`.
Commands reference: `tools/README.md`.

Steps marked **[you]** are terminal commands. Steps marked **[claude]** are
messages you send in Cowork — the exact wording is given.

---

## Step 0 — one-time setup [you]

Every command in this runbook runs from the **app repo**, never from
`Digital Board Work` (that folder holds source decks and nothing else).

```powershell
cd C:\Vishal\Antigravity\pure_html_based_ppt_presentation
npm install
pip install python-pptx pywin32
```

That's the whole setup **if you have PowerPoint installed** — `extract.py`
exports slides through PowerPoint itself, which is the most faithful renderer
available and needs no other tooling. Verify:

```powershell
python -c "import win32com.client as w; a=w.Dispatch('PowerPoint.Application'); a.Quit(); print('PowerPoint OK')"
```

### No PowerPoint? Use the LibreOffice fallback

```powershell
# LibreOffice: https://www.libreoffice.org/download/download-libreoffice/
# poppler:     https://github.com/oschwartz10612/poppler-windows/releases
#              unzip to C:\Tools\poppler
```

Add both to PATH (PowerShell, once), then **open a new terminal**:

```powershell
$p = [Environment]::GetEnvironmentVariable("Path","User")
$add = "C:\Program Files\LibreOffice\program;C:\Tools\poppler\Library\bin"
[Environment]::SetEnvironmentVariable("Path", "$p;$add", "User")
```

### Verify

```powershell
python --version
node --version
soffice --version    # only needed for the LibreOffice route
pdftoppm -v          # only needed for the LibreOffice route
```

Run these directly. `npm soffice --version` does **not** test soffice — npm
ignores the unknown argument and prints its own version.

Optional, only for the Step 7 visual check:

```powershell
npx playwright install chromium
```

Do this once, not per deck.

---

## Step 1 — extract [you]

```powershell
npm run deck:extract -- "C:\Vishal\Digital Board Work\02 - Unit and Measurement\02 - Unit and Measurement - 01 Basic Unit - Bearable.pptx"
```

Whole chapter at once:

```powershell
npm run deck:extract -- "C:\Vishal\Digital Board Work\02 - Unit and Measurement" --all
```

Creates `build/<deck-slug>/` with `slide-001.png…`, `slides.json`, `media/`,
`manifest.json`.

**Check before moving on:** `manifest.json` must say `"count_ok": true`.
If false, the render was cut short or a slide is hidden — rerun with `--resume`
(it discards an incomplete cache and redoes it).

Takes ~40 s for a 47-slide deck. No LLM involved, so it is free and repeatable.

---

## Step 2 — slide plan [claude]

> Run prompt P1 from conversion-pipeline.md on `build/<deck-slug>`.

I read every slide PNG one at a time alongside `slides.json` and write
`build/<deck-slug>/plan.json` — archetype, verbatim text, LaTeX, table grids,
figure descriptions, reveal order.

**This is the step that decides quality.** No HTML exists yet, so mistakes are
cheap here and expensive later.

---

## Step 3 — audit the plan [claude]

> Run prompt P2 on the plan.

I re-read each slide image against its plan entry and report only omissions —
missing table rows, dropped equations, lost labels. I fix what it finds.

Skim the report yourself. You know this material; I don't. If a physics point is
wrong or a "special case" note is missing, say so now.

---

## Step 4 — render [claude]

> Run prompt P3 in batches of 8.

I write `build/<deck-slug>/fragments/001-008.html`, `009-016.html`, … Each file
contains only `<section class="page">` blocks using classes from
`docs/components.md`. Batching is what stops long decks from being truncated.

If a slide needs a component that doesn't exist, I stop and tell you rather than
inventing inline CSS. We add it to `deck-base.css` once, and every future deck
gets it.

---

## Step 5 — diagrams [claude]

> Run prompt P4 for the figures flagged rebuildable in the plan.

One figure per request, rebuilt as inline SVG. Genuinely complex figures fall
back to a cropped source image and stay flagged in `plan.json` for a later pass.

Skip this step for decks with no diagrams — the plan tells you.

---

## Step 6 — assemble [you]

```powershell
npm run deck:build -- build/<deck-slug>
```

Produces `build/<deck-slug>/<deck-slug>.html` — one self-contained file with the
design system, persistent background, fallback controller and MathML equations
baked in. Exits non-zero if the page count doesn't match the source.

---

## Step 7 — gate [you]

```powershell
npm run deck:check -- build/<deck-slug>/<deck-slug>.html --manifest build/<deck-slug>/manifest.json
```

Exit 0 = ship it. Any ERROR = do not ship. Common failures and what they mean:

| Error | Cause | Fix |
|---|---|---|
| `N pages but the source deck has M slides` | a render batch was dropped | re-run Step 4 for the missing range only |
| `X% of the file is base64 image data` | figures pasted instead of rebuilt | re-run Step 5 |
| `only N steps across M pages` | content dumped whole | re-run Step 4 for those slides; the plan's `reveal_order` was ignored |
| `loads a CDN script` / `MathJax present` | runtime math | equations must use `data-tex`; scripts are stripped in PDF export |
| `standalone fallback controller missing` | fragments were edited by hand into the final file | rebuild via Step 6, never hand-edit the output |

Warnings are advisory — a deck can ship with them.

Then open the file in a browser: arrow keys page through it. What you see there
is what the presenter will show.

---

## Step 8 — ship [you]

Copy the built `.html` next to the source deck, then load it in the app via
**Master Library → Load slides file**.

```powershell
copy "build\<deck-slug>\<deck-slug>.html" "C:\Vishal\Digital Board Work\02 - Unit and Measurement\html_files\"
```

---

## Scaling up

1. **First deck** — walk all eight steps, tune `deck-base.css` while it's cheap.
2. **First chapter** — `--all` on Step 1, then steps 2–7 per deck. This is where
   batching and the gate prove themselves.
3. **Golden set** — keep 5 finished decks plus `01 - Physical world` as fixtures.
   Re-run `deck:check` on all of them after any `deck-base.css` change.
4. **Fleet** — roughly one chapter per session. `build/status.csv` tracks what's
   been extracted, so the migration is resumable.

Check a whole chapter in one go:

```powershell
npm run deck:check -- "C:\Vishal\Digital Board Work\02 - Unit and Measurement\html_files"
```

---

## Rules that keep this working

- Never ask for a whole deck in one response. Eight slides is the unit of work.
- Never ship a deck that fails the gate.
- Never hand-edit the built `.html` — edit the fragment and rebuild.
- Commit `plan.json` and `fragments/`. If the design system changes, decks are
  re-rendered from plans, not re-extracted from PowerPoint.
- Text is never an image.

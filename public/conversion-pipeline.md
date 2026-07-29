# PPT → HTML Conversion Pipeline (Strategy)

Scope: 276 `.pptx` files in `Digital Board Work/` (35 chapters) → self-contained
LessonForge decks. Companion to `deck-authoring-prompt.md` (the *output contract*).
This document is the *process contract*.

---

## 0. Diagnosis — why the current approach produces poor results

Evidence from the 9 files already in `02 - Unit and Measurement/html_files/`:

| Symptom | Evidence | Root cause |
|---|---|---|
| Deck degenerates into embedded slide images | `01 Basic Unit - Bearable.html` = **17.1 MB**; `Level -2.html` = 3.7 MB | Model runs out of output budget mid-deck and falls back to base64 screenshots — exactly what you don't want |
| Whole decks lost | `01 Basic Unit - NEET PYQ.html` = 12 KB, **5 pages** | Single-shot generation truncated; no count check caught it |
| Under-stepped content | `02 Dimensional Analysis`: 36 pages / **59 steps** (1.6 per slide) | Rule 16/17 (step every row, every cell, every bullet) is silently skipped when the model is racing the token limit |
| Equations vanish in PDF export | Every deck loads **MathJax from CDN** | Rule 11 strips **all `<script>` tags** on export → MathJax never runs → **every formula is blank in the exported PDF** |
| No cross-deck consistency | Each file re-declares its own `:root`, `#bg`, `.kicker-tag`, card styles | Design is re-invented per deck; 276 decks will never look like one product |

The common cause: **one prompt is being asked to read the deck, invent the design,
write ~3,000 lines of HTML, and self-verify — in a single response.** That is
unfixable by prompt wording. The fix is to split it into stages where each stage
has a small, checkable output.

---

## 1. The Strategy

### Principle: the LLM writes *content*, scripts write *files*

Everything mechanical (boilerplate, CSS, fallback controller, assembly, validation)
is done by code and can therefore never be forgotten. The model only produces the
part that requires judgment: what is on the slide and how it should be structured.

This alone removes ~70% of output tokens per deck, which removes truncation, which
removes the image-dumping and the lost slides.

### Phase 0 — Freeze a design system (do once, ~1 day)

**0a. `tools/deck-base.css`** — one canonical stylesheet, extracted from the best
existing deck and cleaned up. Contains:

- **Tokens**: `--bg`, `--ink`, `--sub`, `--accent`, `--yellow`, `--cyan`, `--green`,
  `--red`, `--card-bg`, `--card-border`, plus a type scale
  (`--fs-h1: clamp(34px,8.6vmin,98px)` … per rule 9).
- **Layout primitives**: `.wrap`, `.wrap.center`, `.two-col`, `.split-6040`, `.stack`.
- **Components** (the reusable "slide templates" you asked about):
  `.slide-title`, `.kicker`, `.concept-card`, `.cmp-table`, `.eqn`, `.eqn-block`,
  `.qa`, `.worked-example`, `.derivation`, `.callout--note/--warn/--tip`,
  `.figure-frame`, `.units-grid`, `.keypad`, `.option-row`.
- **Print block** (rule 11) and the standalone fallback controller (rule 6).

**0b. Archetype catalogue** — every slide in the corpus must map to one of ~10 named
archetypes. Draft list, to be confirmed against a real sample:

`title` · `section-divider` · `definition` · `bullets` · `comparison-table` ·
`formula-sheet` · `derivation` · `worked-example` · `diagram-explain` ·
`question` (MCQ/numeric, → `question-deck-prompt.md`) · `summary`

Anything that doesn't fit becomes a new archetype **added to the CSS**, never
one-off inline styles in a deck.

**0c. `tools/build-deck.mjs`** — assembles `<head>` + tokens + base CSS + slide
fragments + fallback controller into the final self-contained `.html`. Because
assembly is deterministic, rules 1, 6, 8 and 12 are structurally guaranteed.

**0d. `tools/validate-deck.mjs`** — the QA gate (see Phase 5).

### Phase 1 — Deterministic extraction (script, no LLM)

Per `.pptx`, produce a `build/<deck-slug>/` folder:

```
slide-001.png … slide-NNN.png   # LibreOffice → PDF → pdftoppm @150 DPI (rule 16)
slides.json                     # python-pptx: text runs, table grids, notes, shape types
media/                          # embedded images, extracted at native resolution
manifest.json                   # chapter, deck name, slide count  ← the count of record
```

Two independent views of every slide: the **pixels** (catches equations and diagrams
that live inside shapes) and the **XML text/tables** (catches exact wording and true
table dimensions). The model gets both, so it never has to guess.

Skip `~$*.pptx` (Office lock files — there are several in `00 - Basic Math`).

### Phase 2 — Pass A: Slide Plan (LLM → JSON, never HTML)

The model reads slide images **one at a time** plus `slides.json`, and emits a
`plan.json`: for each slide, its archetype, verbatim text, LaTeX for each equation,
tables as real row/column matrices, a description of any diagram, and the intended
reveal order.

Why JSON first: it is small (so no truncation), reviewable, diffable, and it is
where information loss is caught — *before* any HTML exists. Re-rendering later never
requires re-reading the PPT.

### Phase 3 — Plan audit (LLM + script)

Script checks `plan.json` slide count == `manifest.json` count, and table dimensions
== the python-pptx grid. A second model pass re-reads each slide image against its
plan entry and reports omissions only. Cheap, and it is the step that would have
caught the 5-page deck.

### Phase 4 — Pass B: Render (LLM → HTML fragments, batched)

**8–10 slides per request**, output is *only* `<section class="page">` blocks using
existing component classes. No `<style>`, no `<script>`, no `<head>`. Batching is
what makes long decks (49 slides) reliable — each response stays well inside limits,
and a bad batch is re-run alone instead of re-running the deck.

Diagrams get their own focused pass (one diagram per request → inline `<svg>`),
because ray diagrams, FBDs and circuits are the highest-failure content and deserve
undivided attention.

### Phase 5 — Assemble + automated QA gate

`build-deck.mjs` produces the final file; `validate-deck.mjs` fails the build on:

- page count ≠ source slide count
- file size > 800 KB (catches base64 slide-dumping — the 17 MB failure)
- `display:none` / `opacity:0` on `.page`; missing fallback controller
- `localStorage`, `alert`, `window.open`, `<input>`, `<textarea>`, `<select>`
- relative/local asset paths, `__lf-` names, `lf-` postMessage types
- any `<style>` or class not in the design system (drift detector)
- steps-per-slide below threshold, or a table `<tr>` whose first cell is `.step`
  (violates rule 17)
- **visual check**: headless-render each page, screenshot, place next to the source
  slide PNG, and have the model answer one question — *"what content in the left
  image is missing from the right?"*

### Phase 6 — Scale

1. **Pilot**: 1 deck, all six phases by hand, tune the design system.
2. **Chapter**: all decks in one chapter — proves batching and the QA gate.
3. **Golden set**: freeze 5 finished decks as regression fixtures; re-validate them
   after any change to `deck-base.css`.
4. **Fleet**: remaining chapters, ~1 chapter per run, QA gate mandatory.

Track state in `build/status.csv` (deck, phase, slide count, validator result) so a
276-file migration is resumable.

---

## 2. The Prompt Pipeline

Copy-paste templates. `{{…}}` = fill in.

### P0 — Design system extraction (run once)

> You are establishing the design system for a 276-deck migration.
> Inputs: the attached best-of-breed deck HTML, and `deck-authoring-prompt.md`.
> Produce `tools/deck-base.css` containing ONLY: (a) CSS custom-property tokens for
> colour and type scale, (b) layout primitives, (c) component classes for these
> archetypes: {{list}}. Requirements: every size uses `vmin`/`clamp()` per rule 10;
> type scale matches rule 9 (presentation scale, not web scale); font stack
> `Calibri, Candara, 'Segoe UI', system-ui, sans-serif` with `'Cambria Math',
> Georgia, serif` for equations (rule 17); includes the `@media print` block (rule
> 11); no `.page { display:none }` (rule 1); no logo/brand styles (rule 17).
> Also return `docs/components.md`: one line per class — what it's for, its required
> DOM shape, and where `.step` goes. Return the two files, nothing else.

### P1 — Slide Plan (Pass A)

> **Role:** slide-content extractor. **Do not write any HTML.**
> Inputs: `slide-001.png … slide-NNN.png` (150 DPI) and `slides.json` (python-pptx
> text + table grids) for deck `{{deck name}}`, chapter `{{chapter}}`.
>
> Read the slides **one at a time, in order, at full resolution.** Never work from a
> montage or from the text dump alone — equations, labels and table cells live inside
> images and shapes.
>
> For **each** slide emit one JSON object:
> ```json
> { "n": 1, "archetype": "<one of: {{archetype list}}>",
>   "title": "", "kicker": "",
>   "blocks": [ {"kind":"text|equation|table|figure|qa|note","…":"…"} ],
>   "table": {"headers":[], "rows":[[]]},
>   "equations": [{"latex":"", "context":""}],
>   "figure": {"present":true,"describe":"","rebuildable_as_svg":true,
>              "elements":["axes","labels","arrows"]},
>   "reveal_order": ["title","row1.cell1","row1.cell2","…"],
>   "uncertain": [] }
> ```
> Rules: text **verbatim** from the slide, never paraphrased or summarised. Tables
> keep **every** row and column including symbol/diagram cells — state the dimensions
> explicitly. Every equation as LaTeX. `reveal_order` follows rule 16/17: heading and
> table column headers and each row's first (label) cell are visible from the start;
> every other data cell, bullet, equation line and definition is a separate reveal;
> a term and its definition are never in the same reveal. Anything unreadable goes in
> `uncertain` — do not invent it.
>
> Output `plan.json` only. It must contain exactly {{N}} objects.

### P2 — Plan audit

> Compare `plan.json` against the slide images, one slide at a time.
> For each slide report ONLY omissions or distortions: missing table rows/columns,
> dropped equations, lost labels, "special case" notes, or footnotes.
> Output a JSON array `[{"n":12,"issue":"…","fix":"…"}]`. Return `[]` if clean.
> Do not rewrite the plan. Do not comment on style.

### P3 — Render (Pass B, batched)

> **Role:** HTML author for the LessonForge presenter.
> Inputs: `docs/components.md` (the ONLY classes you may use), `deck-authoring-prompt.md`
> (rules), and `plan.json` slides **{{a}}–{{b}}** ({{k}} slides).
>
> Output: exactly {{k}} `<section class="page">…</section>` blocks, in order, and
> nothing else — **no `<style>`, no `<script>`, no `<head>`, no prose, no code fence
> commentary.** Boilerplate and CSS are added by the build script.
>
> Constraints:
> - Use only classes from `components.md`. If a slide genuinely needs something new,
>   stop and report the gap instead of inventing inline styles.
> - Layout goes on an inner wrapper, never on `.page` (rule 8).
> - `.step` exactly as `reveal_order` specifies — per **cell**, not per row (rule 17);
>   labels/terms/first-column cells un-stepped; no manual opacity on `.step`.
> - Equations: {{math policy — see clarifying Q2}}.
> - Figures: `<div class="figure-frame">` + inline `<svg>`; no external or local paths.
> - Interactive elements get `class="clickable"`, ≥44 px, stable position.
> - Reproduce text verbatim from the plan.

### P4 — Diagram → SVG (one figure per request)

> Rebuild the figure on slide {{n}} of {{deck}} as a single inline `<svg>`.
> Source: the attached crop. Requirements: `viewBox`, no fixed px width/height, scales
> with its container; all strokes/fills via `currentColor` or the deck tokens
> ({{list}}) so it works on the dark stage; labels as real `<text>` (never paths);
> ≤ 8 KB; renders correctly with JavaScript disabled (rule 11).
> Preserve every label, arrow, angle mark and axis tick shown in the source.
> Return only the `<svg>` element.

### P5 — Fidelity verification (final gate)

> Left image: source PowerPoint slide {{n}}. Right image: headless render of the
> generated page {{n}}. List ONLY content present on the left and absent or wrong on
> the right — text, table cells, equation terms, labels, arrows. Ignore colour,
> font and spacing differences; this deck is intentionally restyled.
> Output `{"n":{{n}},"missing":[],"wrong":[],"verdict":"pass|fail"}`.

---

## 3. Decisions taken (locked for Phase 1)

| Question | Decision | Consequence for the pipeline |
|---|---|---|
| Equations | **Pre-rendered at build time** | `build-deck.mjs` runs KaTeX in Node and bakes static HTML+CSS. `plan.json` stores LaTeX; no MathJax `<script>` ships. Fixes the blank-equations-in-PDF bug and works with no network. P3's math policy = *"emit `\(…\)` LaTeX inside `<span class="eqn">`; the build step converts it."* |
| Diagrams | **SVG-first, cropped image fallback** | P4 runs on every figure with `rebuildable_as_svg: true`. Fallbacks are cropped to the figure (never a whole slide), stored as data-URIs, and flagged in `plan.json` for later revisit. Validator's 800 KB ceiling stays. |
| Design baseline | **Extract from `01 - Physical world - Bearable`** (corrected) | The originally nominated `01 Basic Unit - Bearable` turned out to be 99.7% base64 across 46 images / 47 pages — a screenshot gallery, so it had no layout worth lifting. `01 - Physical world` is the only true rebuild in the corpus (22 KB, 14 pages, 97 steps, real tables, CSS-built fractions, zero images) and is the sole deck that passes the QA gate. `tools/deck-base.css` generalises its tokens (`#05060a` stage, yellow headings, Calibri / Cambria Math) into ~11 archetype components. Keep it as a regression fixture. |
| Automation | **Full local script pipeline** | `tools/` gets `extract.py` (LibreOffice→PDF→PNG @150 DPI + python-pptx dump), `build-deck.mjs`, `validate-deck.mjs`, `status.csv`. Prereqs to install: LibreOffice, `poppler-utils` (`pdftoppm`), Python + `python-pptx`, Node (already present). |

## 4. Build status

**Phase 0 complete** — `tools/deck-base.css`, `docs/components.md`,
`tools/extract.py`, `tools/build-deck.mjs`, `tools/validate-deck.mjs`,
`tools/README.md`. Setup and commands are in `tools/README.md`.

Gate run against the corpus as it stands: **1 of 9 decks passes** (`01 - Physical
world`). The other eight fail on CDN MathJax, size, base64 share, or step density
— i.e. the gate reproduces the diagnosis in §0 mechanically.

**Phase 1 complete for the pilot** — `02 - Unit and Measurement - 01 Basic Unit -
Bearable.pptx`: 47/47 slides rendered at 150 DPI, `slides.json` and `manifest.json`
written, 35 embedded images extracted. Next: prompt P1 to produce `plan.json`.

Note for P1 on this corpus: the PowerPoint template itself carries decorative art
(hex pattern, medal, target) and a PW logo on every slide. Those are **template
chrome, not content** — the plan must not record them as figures, and rule 17
forbids the logo in the rebuild.

## 5. Working agreements

- **Never** ask for a whole deck in one response. 8–10 slides is the unit of work.
- **Never** accept a deck that fails `validate-deck.mjs`. Re-run the failing batch.
- `plan.json` is the durable artefact — commit it. If the design system changes, decks
  are re-rendered from plans, not re-extracted from PPTs.
- A slide image may only be embedded as a last resort, cropped to the figure, and it
  must be recorded in `plan.json` as `rebuildable_as_svg: false` so it can be revisited.
- Text is **never** an image.

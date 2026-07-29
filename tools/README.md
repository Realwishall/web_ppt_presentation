# tools/ — PPT → HTML conversion pipeline

Strategy and prompts: `public/conversion-pipeline.md`.
Output contract: `public/deck-authoring-prompt.md`.
Component vocabulary: `docs/components.md`.

## One-time setup

```bash
npm install                          # pulls in katex (build-time math)
pip install python-pptx pywin32      # pywin32 only matters on Windows
```

Slide rendering uses whichever is available:

| Renderer | Needs | Notes |
|---|---|---|
| **PowerPoint** (preferred) | Windows + PowerPoint + `pywin32` | Native export — the most faithful. No other tooling. |
| LibreOffice | `soffice` + `pdftoppm` on PATH | Cross-platform fallback. Slower, slight font drift. |

`--renderer auto` (the default) picks PowerPoint when it can and falls back
automatically. Force one with `--renderer powerpoint` / `--renderer libreoffice`.
The manifest records which was used.

For the LibreOffice route on Windows: install from libreoffice.org, get poppler
from <https://github.com/oschwartz10612/poppler-windows/releases>, and add both
`...\LibreOffice\program` and `...\poppler\Library\bin` to PATH.

Optional, for the P5 visual check: `npx playwright install chromium`.

## The loop

```bash
# 1. extract — deterministic, no LLM
npm run deck:extract -- "C:/Vishal/Digital Board Work/02 - Unit and Measurement/… .pptx"
npm run deck:extract -- "C:/Vishal/Digital Board Work/02 - Unit and Measurement" --all

# 2-4. slide plan -> audit -> render, with Claude (prompts P1-P4)
#      render output lands in build/<slug>/fragments/001-008.html, 009-016.html, …

# 5. assemble
npm run deck:build -- build/<slug>

# 6. gate
npm run deck:check -- build/<slug>/<slug>.html --manifest build/<slug>/manifest.json
```

`deck:check` exits non-zero on any ERROR. Do not ship a deck that fails it.

## Files

| File | Phase | Does |
|---|---|---|
| `extract.py` | 1 | pptx → PNG @150 DPI + `slides.json` (text, tables, notes) + `media/` + `manifest.json` |
| `deck-base.css` | 0 | The design system. Inlined into every deck. Never edited per-deck. |
| `build-deck.mjs` | 5 | fragments + CSS + persistent layers + fallback controller → one self-contained `.html`. Converts `data-tex` to MathML. |
| `validate-deck.mjs` | 5 | QA gate. |

## Flags worth knowing

- `extract.py --resume` reuses already-rendered PNGs, but only when the count
  matches the deck's real slide count — a render cut short is discarded and
  redone. Use it freely; rendering is the slow step.
- `extract.py --renderer powerpoint|libreoffice` overrides auto-detection.
- `extract.py --all` recurses a chapter folder and skips `~$` Office lock files.
- `extract.py --dpi 200` for decks with dense small equations.
- `build-deck.mjs --title / --kicker` override what's inferred from the manifest.
- `validate-deck.mjs --json` for machine-readable output; point it at a folder to
  check a whole chapter at once.

## Why the build script exists

Rules 1, 6, 8 and 12 of the authoring prompt are the ones a model silently drops
when it's racing an output limit — and dropping rule 1 or 6 makes the deck render
**blank**. Since the boilerplate is now generated, the author cannot get it wrong.
The author writes `<section class="page">` blocks and nothing else.

## Known baseline

`Digital Board Work/01 - Physical world/html_files/01 - Physical world - Bearable.html`
is the reference conversion — 14 pages, 97 steps, real tables, zero embedded
images, passes the gate with no warnings. `deck-base.css` is derived from it.
Keep it as a regression fixture.

# Working in this repo

This project turns PowerPoint physics decks into **self-contained HTML slide
decks** for the LessonForge presenter. Read these in order before authoring:

1. `public/deck-authoring-prompt.md` — the output contract. **Section 19 is the
   list of mistakes that have already cost rebuilds; read it first.**
2. `docs/components.md` — the only class vocabulary a deck may use.
3. `docs/RUNBOOK.md` / `tools/README.md` — the pipeline.

---

## Converting from `JSON_split_data/` (the usual request)

The JSON parts under `JSON_split_data/<chapter>/` are a PowerPoint dump: text
runs with font size/colour, shape positions in inches, OMML formulas, and
base64 images. Two parts usually merge into one deck (`part_01` + `part_02` →
`slides_1-8`).

```bash
# 1. build dir: fragments/ + media/ + manifest.json  {slug, slide_count, chapter}
# 2. read the JSON: every text_content.full_text, every formula raw_text,
#    and DECODE THE IMAGES AND LOOK AT THEM — slide meaning often lives there
# 3. write build/<slug>/fragments/001-004.html, 005-008.html  (page sections only)
node tools/build-deck.mjs build/<slug> --title "…" --kicker "…"
node tools/validate-deck.mjs build/<slug>/<slug>.html --manifest build/<slug>/manifest.json
cp build/<slug>/<slug>.html "JSON_split_html/<chapter>/<source-name>_slides_1-8.html"
```

Exit 0 on the gate, or do not ship. Never hand-edit the built `.html`; edit the
fragment and rebuild.

**Verify before shipping** — the gate does not check meaning:

- strip tags from the built HTML and confirm **every** `full_text` in the source
  JSON appears in it (dropped labels are the #1 conversion defect);
- `data-tex` count == `latex N converted` in the build log;
- zero `.step` elements with a `.step` ancestor.

## House style this teacher asks for

Decks are taught live to ~100 students on a dark board with a white pen.

- **One press, one idea.** Statement first → the terms → each definition *with*
  its word lighting up → the relation that follows.
- **Graphs and figures come last**, after the words and the algebra.
- **Definitions that deserve equal weight go in `.info-box` focus boxes** — the
  box grows, teaches, shrinks, then the next one starts.
- **Questions and all their options appear at once**; clicking the right option
  turns it green. Step the reasoning, not the options.
- **Don't add alternative methods** (matrix tricks, shortcuts) unless asked.
- Prose in the Calibri UI stack; the math serif only for symbol-only equations.
- No logo, badge or watermark anywhere (rule 17).

## Ask before starting a conversion

- one merged deck or one file per JSON part?
- keep the source photos inlined, or rebuild those slides as text/SVG?

## Motion: anime.js and three.js are installed — use them when they teach

`npm i animejs three` is done; `tools/vendor/` holds script-tag-able builds
(`node tools/make-vendor.mjs` regenerates them after a version bump). Reach for
them when motion makes a slide clearer, not to decorate.

**Never a CDN.** The deck is one self-contained file in a sandboxed iframe with
no guaranteed network, and the gate fails any external `<script>`. `build-deck.mjs`
**inlines** a library only when the markup asks for it (`data-anime=` /
`data-three=`) or the manifest lists `"libs": ["anime"]`. A text deck stays ~50 KB;
anime adds 115 KB, three adds 736 KB. The gate excludes vendor bytes from the
size budget, so a 3D deck no longer trips the 800 KB rule.

**Authors still write no JS.** Fragments are page sections only, so motion is
requested with a data attribute and driven by presets that ship in the build:

| attribute | what it does |
|---|---|
| `data-anime="draw"` on an `<svg>` | its strokes draw themselves on when the figure is revealed |
| `data-anime="count"` on a number | counts up to the printed value |
| `data-anime="pulse"` / `"float"` | one attention pulse / a slow bob |
| `data-three="globe"` / `"stars"` / `"solid-angle"` on `.scene-frame` | a slow WebGL scene sized to the box |

Hard limits, learned the expensive way:

- **Never put a preset on a `.step` itself** — the host owns `.step` opacity and
  transform with `!important`. Put it on something *inside* the stepped wrapper
  (the `<svg>` in a stepped figure, the `<b>` in a stepped line).
- **Motion is never the carrier of an idea.** Scripts are stripped for PDF export
  and the room may have no GPU: every `.scene-frame` needs a `.scene-fallback`,
  and a `draw` figure must be complete and correct with JS off.
- One moving thing at a time, and nothing looping in the area the teacher writes on.

## Extending the design system

A slide that needs something new is a **design-system change, not an inline
style**: add the rule to `tools/deck-base.css`, document it in
`docs/components.md`, and — if it needs runtime behaviour — add the observer to
`tools/build-deck.mjs` as a self-contained, no-op-if-absent script, with an
`@media print` fallback so the PDF export (which strips all scripts) still
carries the information.

Recent additions built this way: `.eq.spot` + `data-lights`/`data-lit`
(highlight a word when its definition is revealed) and `.term-row`/`.term-card`.

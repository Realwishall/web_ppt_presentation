# Deck component contract

The **only** vocabulary a render pass (prompt P3) may use. Every class below is
defined in `tools/deck-base.css` and inlined at build time.

**Hard rules for the author**

1. No `<style>`, no `<script>`, no `<head>` — output is only `<section class="page">` blocks.
2. No inline `style="…"` attributes. If a slide needs something not listed here,
   **stop and report the gap** so the component gets added to the design system.
3. Every `.page` contains exactly one `.wrap` (layout lives on the wrap, never on
   `.page` — rule 8).
4. `.step` marks one reveal. Never put `opacity`/`visibility` on a `.step`.
5. Never use `page`, `step` or `clickable` as names for anything else.

---

## Stepping law (rules 16–17) — read before anything else

Visible from the first moment, **never** `.step`:

- the slide heading (`h1.title`, `h2.heading`)
- table column headers (`<th>`) and each row's first cell (`td.prop`)
- the term/label side of any label→definition pair (`.label`, `.qa .q`, `h4.cell-heading`)
- static scaffolding: axes and frame of a figure

Everything else is its own `.step`, revealed one at a time in reading order:
each data `<td>`, each `<li>`, each equation line, each definition, each answer.

> A term and its definition must never appear in the same reveal.

---

## Page shells

| Class | Use |
|---|---|
| `<section class="page">` | One slide. Required wrapper. |
| `.wrap` | Default: column flow, generous padding, scrolls internally. |
| `.wrap.center` | Centred both axes — title and section-divider slides. |
| `.wrap.tight` | Same as `.wrap`, smaller gaps — long bullet lists. |
| `.wrap.dense` | Reduced padding — full-width tables, long derivations. |

```html
<section class="page">
  <div class="wrap">
    <h2 class="heading">Slide title</h2>
    …
  </div>
</section>
```

## Persistent layers (emitted by the build script, not by the author)

`#bg` and `.kicker-tag` are siblings of `.page`. Do not create them; do not
reference them.

---

## Archetypes

### `title` / `section-divider`

```html
<div class="wrap center">
  <h1 class="title">Fundamental forces</h1>
</div>
```

Optional subtitle: `<p class="sub step">…</p>`.

### `definition` — glossary / term list

Label unstepped, definition stepped.

```html
<div class="glossary">
  <div class="g-row">
    <span class="label">Hypothesis:</span>
    <span class="step">An educated guess or thought</span>
  </div>
  <div class="g-row">
    <span class="label">Laws:</span>
    <div>
      <div class="step">Experimentally observed, assumed true</div>
      <div class="sub-list"><span class="step">Can be verified</span><span class="step">Cannot be proven</span></div>
    </div>
  </div>
</div>
```

`.g-row.wide` when labels are long.

### `bullets`

```html
<ul class="bullets">          <!-- ★ marker; .box ⬜  .arrow ➤  .dot •  -->
  <li class="step">Unification</li>
  <li class="step">Reduction</li>
</ul>
```

Modifiers: `.tight` (less gap), `.small` (smaller type). Nest a `ul.bullets`
inside an `li` for sub-points.

### `comparison-table`

Per-**cell** stepping; first column unstepped.

```html
<table class="data">
  <thead>
    <tr><th>Properties</th><th>Gravitational</th><th>Electromagnetic</th></tr>
  </thead>
  <tbody>
    <tr>
      <td class="prop">Range</td>
      <td class="step">&infin;</td>
      <td class="step">&infin;</td>
    </tr>
  </tbody>
</table>
```

Modifiers: `.compact` (tighter padding, ≥6 columns), `.center` (centre cells).
Cell helpers: `td.num` (right-aligned, math font), `.ok` (✓ green), `.no` (✗ red).

### `formula-sheet` / inline math

Script-free by design — survives PDF export.

```html
<div class="eq-block">
  <div class="eq step">m = <span class="frac"><span class="num">m<sub>0</sub></span>
    <span class="den"><span class="radical"><span class="sym">&radic;</span>
    <span class="content">1&minus;(v/c)<sup>2</sup></span></span></span></span></div>
  <div class="eq-note">here m<sub>0</sub> is rest mass</div>
</div>
```

Primitives: `.eq` (inline math run), `.eq.small` / `.eq.big`, `.frac` + `.num`/`.den`,
`.radical` + `.sym`/`.content`, `.vec` (over-arrow), `.eq-note`.

**LaTeX alternative** — for anything more complex than the above, write
`<span class="eq" data-tex="\vec{F} = \frac{dp}{dt}"></span>`; the build script
converts `data-tex` to MathML at build time. Never emit `\(…\)` for a runtime
renderer — scripts are stripped on export and the equation would come out blank.

### Annotated example (colour-coded expression)

For "A rod of **length** **4****m**" style lines where parts of an expression map
to terms defined underneath. The colour *is* the mapping, so each mark pairs with
a `.label` carrying the matching `for-*` modifier.

```html
<div class="eq">A rod of
  <span class="mark-quantity">length</span>
  <span class="mark-number">4</span><span class="mark-unit">m</span></div>

<div class="g-row">
  <span class="label for-quantity">Physical quantity:</span>
  <span class="step">The quantity that can be measured…</span>
</div>
```

Marks: `.mark-quantity` (amber), `.mark-number` (green), `.mark-unit` (grey).
Labels: `.label.for-quantity`, `.label.for-number`, `.label.for-unit`.
The marked line is never a `.step` — it's the thing being explained.

### `derivation`

One line per `.step`; optional reason on the right.

```html
<div class="derivation">
  <div class="line step">&rArr; K.E. = mc<sup>2</sup> &minus; m<sub>0</sub>c<sup>2</sup>
    <span class="why">definition</span></div>
  <div class="line step">&rArr; 2m<sub>0</sub> = m</div>
</div>
<div class="result step">v = (&radic;3/2) c</div>
```

Long derivations: wrap in `.two-col` and continue in the second column.

### `worked-example`

```html
<div class="worked">
  <div class="given">Given: u = 0, a = 2 m/s², t = 5 s</div>
  <div class="asked">Find: v</div>
  <div class="solution">
    <div class="eq step">v = u + at</div>
    <div class="eq step">v = 0 + 2(5) = 10 m/s</div>
  </div>
</div>
```

### `diagram-explain`

```html
<div class="split-6040">
  <div class="figure-frame"><svg viewBox="0 0 400 260">…</svg></div>
  <div class="stack">
    <p class="step">Explanation line one</p>
    <p class="step">Explanation line two</p>
  </div>
</div>
<div class="fig-caption">Ray diagram for a convex lens</div>
```

SVG rules: `viewBox` only, no fixed width/height, `currentColor` or the deck
tokens for strokes, labels as real `<text>`. `.figure-frame.plain` removes the
card; `.figure-frame.tall` allows a taller figure.

### `question` (MCQ)

Only `.option` gets `clickable`.

```html
<p>If velocity is doubled, momentum will become:</p>
<div class="options">
  <div class="option clickable" onclick="this.classList.toggle('picked')">
    <span class="opt-badge">A</span>It will be doubled</div>
  <div class="option clickable" onclick="this.classList.toggle('picked')">
    <span class="opt-badge">B</span>More than doubled</div>
</div>
<div class="answer-box step"><span class="ok">&#10003;</span>More than doubled
  &mdash; <i>mass increases slightly</i></div>
```

`.options.two` for a 2×2 grid. States: `.picked`, `.correct`, `.wrong`.

**Option with an aside** — when each option carries a formula or a ✓/✗ beside it,
wrap the pair in `.option-row` so the option and its aside are separate reveals.
Never merge them: the class should see the option, think, then see why it fails.

```html
<div class="option-row">
  <div class="option step"><span class="opt-badge">&#10065;</span>Length, area, velocity</div>
  <span class="eq small step" data-tex="A = l^2"></span>
</div>
```

### `summary` / closing

```html
<div class="wrap center">
  <div class="lead step">Don't invest too much time in the terms —<br>we meet them again in the course</div>
</div>
```

---

## Focus boxes — `.box-grid` + `.info-box`

"One idea per box, revealed one at a time." Use when a slide is a set of short
label + explanation pairs and you want the class's eye pulled to each one in
turn — the alternative to `.glossary` when the items deserve equal visual weight.

The box is **never** a `.step`. Its `h4.cell-heading` label stays visible (rule
17) and the `<p class="step">` inside it is what reveals.

Each box runs its own three-beat cycle, and the next box does not begin until
the current one has closed:

| press | what happens |
|---|---|
| 1 | box grows to **120 %**; every other box dims to 50 % |
| 2 … | its content appears **inside the enlarged box**, one `.step` per press |
| N | box settles back to 100 %, dimming clears |
| N+1 | the next box starts its own cycle |

**Grow and shrink are each their own press.** The host only ever reveals
`.step`s, so `build-deck.mjs` injects a zero-size sentinel `.step.box-zoom` at
each end of every instrumented box — authors never write them. Nothing is on a
timer, so a box stays big for exactly as long as you talk. Pressing Previous
walks the cycle back; leaving the page clears it.

Budget the presses: a box costs **content steps + 2**. Eight one-line boxes is
24 presses.

Boxes grow **inward** (outer columns pin their outer edge) so a 120 % box never
pushes past the slide's padding.

The transform lives on the box, not on the step, because the host owns `.step`
opacity and transform with `!important`. Nothing here is required for the slide
to read — with JS off (PDF export) every box prints flat and undimmed.

```html
<div class="box-grid">            <!-- .three = 3 columns, .one = single column -->
  <div class="info-box">
    <h4 class="cell-heading">Cornea</h4>
    <p class="step">Transparent front part. Refracts light.</p>
  </div>
  …
</div>
```

## Video — `.video-frame[data-video]` + `.video-fallback`

**Declare the video; do not try to drive it.** The deck runs in
`<iframe sandbox="allow-scripts">` on an opaque origin, and the deck layer is
`pointer-events:none` — a player embedded by the deck can neither load nor be
clicked. The presenter reads `data-video` off the placeholder and renders a
real, interactive player in its own document, above the ink canvas, positioned
over that box, with a **"Write over video"** toggle so the pen can take the area
back.

The placeholder must have a size before anything loads (`.video-frame` is
`aspect-ratio:16/9`), and a `.video-fallback` is **required**: scripts are
stripped in PDF export and the room may be offline, so that block is what prints
and what the teacher reads if the player is blocked.

```html
<div class="video-frame" data-video="ID" data-start="33" data-end="50">
  <!-- optional inner <iframe>: only so the file plays when the .html is opened
       in a plain browser. The host hides it and paints over it. -->
</div>
<div class="video-fallback">
  <div class="cue">Play from 0:33 to 0:50</div>
  <div class="url">https://www.youtube.com/watch?v=ID</div>
</div>
```

| Attribute | Meaning |
|---|---|
| `data-video` | The video id — **not** the whole URL |
| `data-start` / `data-end` | Clip in/out points, in seconds |
| `data-provider` | `youtube` (default) or `vimeo` |

---

## Cross-cutting pieces

| Class | Purpose |
|---|---|
| `h2.heading` + `<span class="inline-lead">` | Heading with a trailing plain-text lead |
| `<span class="paren">(contd.)</span>` | Small parenthetical inside a heading |
| `.two-col` `.split-6040` `.split-4060` `.grid3` `.grid4` | Multi-column layouts |
| `.stack` `.row` | Generic vertical / horizontal flow |
| `.card` | Bordered surface |
| `.box-grid` + `.info-box` | Focus boxes; each runs grow → content → shrink, one press per beat |
| `.video-frame` + `.video-fallback` | 16:9 embed; the fallback is what prints |
| `.center-y` | Vertically + horizontally centre a column's contents |
| `.callout` `--note` `--warn` `--tip` | Highlighted aside; `.callout-label` for its title |
| `.qa` + `.q` / `.a` | Question always visible, answer stepped |
| `.note` `.caption` `.example` `.sub` `.lead` | Text roles |
| `.btn` | Generic action button (needs `clickable`) |
| `.no-print` | Hide from PDF export |

## Interactivity (rule 3)

Hover, keyboard, focus and typing never reach the slide. The only thing that
works is a **click on an element carrying `class="clickable"`**, ≥44 px tall, in a
stable position, away from where the teacher writes. Never use `<input>`,
`<textarea>` or `<select>`.

Recipes: reveal (`.answer-box.step`), toggle
(`onclick="this.classList.toggle('open')"`), pick-one (`.option.picked`).

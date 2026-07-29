# Prompt: author an HTML slide deck for the LessonForge presenter

Paste everything from "SYSTEM / RULES" down into the AI, then fill in the
CONTENT BRIEF at the bottom. The AI returns ONE self-contained `.html` file that
the teacher imports via **Master Library → "Load slides file"**. You can generate
many such files independently; each is loaded on its own and its pages append.

---

## SYSTEM / RULES

You generate a **single self-contained HTML file** — one slide deck — for the
LessonForge presenter, a live-teaching panel that loads your file in a sandboxed
iframe, shows one slide at a time, and lets the teacher draw ink on top. Put all
CSS in `<style>` and all JS in `<script>`. Follow every rule below exactly — files
that break them will not work.

### 1. File & slide structure (required)
- The importer finds slides by scanning for **`<section class="page">…</section>`**
  blocks (at least one required). Their order in the file is the page order.
- The panel shows exactly **one `.page` at a time** (`display:block`) and hides the
  rest (`display:none`), using CSS it injects with `!important`. **Do NOT write your
  own show/hide or slide-switching logic for `.page` elements**, and do NOT reuse the
  class names `page`, `step`, or `clickable` for anything else.
- **CRITICAL — never hide `.page` yourself.** Do NOT put `display:none` (or
  `opacity:0`, `visibility:hidden`) on `.page` in your own CSS. If you do, the file
  is **blank** anywhere the host isn't running (a normal browser, the preview panel),
  because nothing reveals the slides. Your file must render **standalone**; the host
  merely *takes over* one-at-a-time paging with its own `!important` rules. To make
  standalone viewing feel like a real deck, include the fallback controller in rule 6.
- **Persistent layers:** anything that must stay visible on EVERY slide (an animated
  background canvas, glowing orbs, a progress bar) goes **OUTSIDE** the `.page`
  elements, as a sibling layer — the panel only toggles `.page` elements, never
  your other siblings.
- A full `<!doctype html>` wrapper is fine; a bare fragment (`<style>` + sections +
  `<script>`) imports equally well.

### 2. Runtime environment — sandboxed iframe (must respect)
Your file runs inside **`<iframe sandbox="allow-scripts">`** via `srcdoc`, on an
opaque origin. Therefore:
- **NO `localStorage`, `sessionStorage`, cookies, or IndexedDB** — they throw. Keep
  all state in plain JS variables.
- **NO `alert` / `confirm` / `prompt`, no `window.open`, no form submission, no
  top-level navigation** (so `<a href>` that changes the page won't work).
- **Animations must be self-running and start on load** — `requestAnimationFrame`
  loops, `setInterval`, or CSS animations. The panel does not "start" anything.
- **Resources:** external CDNs and web fonts (e.g. Google Fonts) *are* reachable
  when the classroom is online, **but** (a) they fail with no network, and (b) any
  CDN library that draws via JS is stripped in PDF export (see rule 9). For
  reliability, **prefer inlining**: system fonts (`system-ui, 'Segoe UI',
  sans-serif`, `ui-monospace`), inline `<svg>`, and images as `data:` URIs. **Never
  use local/relative file paths** (`./img.png`) — the file ships alone.

### 3. Interaction model — the key rule
The deck iframe has **`pointer-events:none`**: all pointing happens on the ink
canvas above it, so the teacher can draw anywhere. Consequences:
- **Hover, focus, typing, drag, mouseover, and keyboard events NEVER reach your
  slide.** Never depend on them. `:hover` CSS won't fire during teaching (fine as
  decoration, never as the only cue). Native inputs (`<input>`, `<textarea>`,
  `<select>`) can't be focused/typed — build any "input" from clickable buttons
  (e.g. an on-screen keypad).
- **The ONLY interaction that works is a click on an element with class
  `clickable`.** The panel forwards a real `click` to it (instead of drawing ink):
  - Put **`class="clickable"`** on every element the user should tap, and drive it
    with `onclick=` or `addEventListener('click', …)`. Clicks bubble, so a
    `.clickable` child inside a handler-bearing parent works too.
  - Make targets **at least ~44px tall**, keep them non-overlapping and in a
    **stable position**, and keep them **away from areas the teacher will write on**.
  - Everything NOT marked `clickable` stays inkable — so mark only the true controls
    clickable, not whole cards.

### 4. Reveal-on-"Next Step" animations (optional, recommended)
- Give an element **`class="step"`** to reveal it one at a time: each **Next** press
  fades/slides in the next `.step` (in DOM order); once all are shown, Next turns the
  page. **Previous** hides the last step before going back. Typical use: bullet
  `<li>`s, formula lines, a delayed answer.
- **Do NOT set your own `opacity`/`visibility` on `.step` elements** — the panel
  controls those with `!important`. Style everything else freely. A `.step` can also
  be `.clickable` once revealed.

### 5. Optional sync hook — react to the current slide
On every page/step change the panel posts a message INTO your iframe:
```js
{ type: "lf-show", index: <0-based page>, step: <steps revealed> }
```
Listen if a persistent background scene, 3D camera, or progress bar should react:
```js
window.addEventListener("message", e => {
  if (e.data && e.data.type === "lf-show") {
    /* e.data.index = current page, e.data.step = steps shown */
  }
});
```
Never assume other message types exist, and never `postMessage` a `type` starting
with `lf-` (reserved by the host: `lf-show`, `lf-click`, `lf-rects`, `lf-load-deck`).

### 6. Standalone fallback controller (required for previewable files)
So the file isn't blank outside the host (normal browser, preview panel), include a
tiny fallback that shows one slide at a time **only when the host is absent**. It
detects the host's injected `#__lf-ctl` style and stands down when present (the
host's `!important` CSS wins anyway, so there is no conflict). Paste this once,
after your slides:
```html
<script>
(function(){
  window.addEventListener('load', function(){
    setTimeout(function(){
      if (document.getElementById('__lf-ctl')) return;      // host present → stand down
      var pages = [].slice.call(document.querySelectorAll('.page'));
      if (!pages.length) return;
      var i = 0, step = 0;
      var steps = function(p){ return [].slice.call(p.querySelectorAll('.step')); };
      function render(){
        pages.forEach(function(p,k){ p.style.display = k===i ? '' : 'none'; });
        steps(pages[i]).forEach(function(s,k){
          s.style.transition = 'opacity .4s, transform .4s';
          s.style.opacity = k < step ? '1' : '0';
          s.style.transform = k < step ? 'none' : 'translateY(14px)';
        });
      }
      function next(){ var n = steps(pages[i]).length;
        if (step < n) step++; else if (i < pages.length-1){ i++; step = 0; } render(); }
      function prev(){ if (step > 0) step--; else if (i > 0){ i--; step = steps(pages[i]).length; } render(); }
      document.addEventListener('keydown', function(e){
        if (e.key === 'ArrowRight' || e.key === ' ') next();
        else if (e.key === 'ArrowLeft') prev();
      });
      document.addEventListener('click', function(e){ if (!e.target.closest('.clickable')) next(); });
      render();
    }, 250);
  });
})();
</script>
```
Remember: this only helps because you did NOT hide `.page` in CSS (rule 1). The
fallback does the hiding at runtime; the host does it instead when present.

### 7. Heavy / 3D backgrounds — load & init gracefully
If you use a `<canvas>`, WebGL, or a 3D lib (Three.js, etc.) as a persistent
background:
- **It is a sibling OUTSIDE `.page`** (rule 1), fixed and behind content:
  `position:fixed; inset:0; z-index:0`. Give every `.page` a higher stacking context
  (e.g. `position:relative; z-index:1`) and its own background so text stays readable
  and the canvas never covers the slides.
- **Init after `load`, never at parse time.** Guard against a zero-size canvas —
  if `clientWidth`/`clientHeight` is 0, wait a frame (`requestAnimationFrame`) and
  retry; size the renderer to the real viewport and re-size on `resize`.
- **If it loads from a CDN, don't assume it's ready.** Initialize from the script's
  `onload` (or poll for the global) and **feature-detect** (e.g. WebGL context). Wrap
  init in `try/catch`; if it fails, fail silently — the slides must still show.
- The engine must **self-run** (rule 2) and, optionally, react to `lf-show` (rule 5)
  to change scene per slide. It will be **blank in PDF export** (rule 9) — never put
  essential information only in the 3D layer.

### 8. Full-frame layout rule (so a slide fills the whole board)
The panel forces the active slide to **`display:block !important`** and does not set
body height. So:
- Add **`html,body{height:100%;margin:0}`** in your `<style>`.
- Keep `.page` as a full-height surface: `.page{height:100%;box-sizing:border-box}`.
- **Do NOT put flexbox/centering directly on `.page`** — the `display:block`
  override kills it. Put your layout on an **inner wrapper** div that is
  `height:100%; display:flex; …` and place content inside it.

### 9. Visual design
- **The stage is DARK** and the teacher's **default ink is white**. Give slides a
  **dark background** (e.g. `#03040a`–`#0b0f19`), or leave the body transparent so
  the panel's dark dot-grid shows through. If you choose a light theme, know the
  default white pen is nearly invisible on it (the teacher must switch ink color).
- Keep **large calm/dark areas free for writing**; avoid busy full-bleed textures.
- Readable sizes: headings via `clamp()`; generous padding (~6–8vw).
- **Font sizing — match the source PPT (do NOT shrink it).** Slides converted from a
  PowerPoint should use type at a similar visual size to the original — presentation
  scale, not smaller. Use `clamp()` so it scales with the board, e.g. body ≈
  `clamp(19px,3.7vmin,42px)`, h1 ≈ `clamp(34px,8.6vmin,98px)`, h2 ≈
  `clamp(26px,6.2vmin,66px)`, equations ≈ `clamp(21px,4.4vmin,50px)`. Keep it bold and
  readable at the back of a classroom.

### 10. Sizing & responsiveness
- The board has **no fixed size or aspect ratio** — it fills the teacher's screen.
- Use **relative units** (`vmin`, `vw`, `vh`, `%`, `clamp()`), never fixed `px` for
  things that should scale. `vmin` is safest for text and boxes.
- Content that can overflow should scroll inside its own container
  (`overflow:auto`), never force the slide to grow.

### 11. PDF export compatibility
The panel can export the deck to PDF by **re-rendering your file with ALL `<script>`
tags removed**, one slide per **landscape** sheet, **all steps revealed**, colors
forced on. Therefore:
- **Every slide must be complete and readable with JS disabled** — all essential
  text/layout in HTML/CSS. Canvas/WebGL/JS-drawn visuals render **BLANK** in the
  PDF, so any information they carry must also exist as HTML/CSS (or be OK to lose).
- Add a small **`@media print`** block: flatten entrance transforms/opacity
  (`opacity:1; transform:none`), hide on-screen-only chrome (keyboard hints), and
  keep dark backgrounds (the panel forces `print-color-adjust:exact`).

### 12. Reserved names — do not use
- Don't create classes/ids beginning with **`__lf-`** (`__lf-active`, `__lf-on`,
  `__lf-x`, id `__lf-ctl`).
- Don't `postMessage` a `type` starting with **`lf-`** (see rule 5).

### 13. Minimal skeleton (copy, then build slides inside)
```html
<style>
  html,body{height:100%;margin:0}
  /* NOTE: no display:none on .page — the file must render standalone (rule 1). */
  #bg{position:fixed;inset:0;z-index:0}                 /* persistent background */
  .page{position:relative;z-index:1;                    /* sits ABOVE #bg */
        height:100%;box-sizing:border-box;color:#f1f5f9;
        font-family:system-ui,'Segoe UI',sans-serif;
        background:radial-gradient(1200px 600px at 50% -10%,rgba(124,58,237,.12),transparent 60%),#0b0f19}
  .wrap{height:100%;box-sizing:border-box;overflow:auto;
        display:flex;flex-direction:column;gap:2.4vmin;padding:6vmin 8vmin}
  .wrap.center{align-items:center;justify-content:center;text-align:center}
  h1{margin:0;font-size:6vmin}
  p{margin:0;font-size:3.2vmin;line-height:1.5;max-width:80ch;color:#cbd5e1}
  .step{opacity:1}                 /* panel controls the hidden→shown transition */
  .btn{border:0;border-radius:12px;padding:1.4vmin 2.6vmin;font:700 2.8vmin system-ui;
       color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6);cursor:pointer}
  @media print{                    /* PDF: flatten reveals, drop on-screen chrome */
    .step{opacity:1!important;transform:none!important}
    #bg,.no-print{display:none!important}
  }
</style>

<!-- Persistent layer (optional): visible on EVERY slide, OUTSIDE .page -->
<!-- <canvas id="bg"></canvas>   // self-running rAF/WebGL init in <script>, see rule 7 -->

<!-- Title slide -->
<section class="page">
  <div class="wrap center">
    <h1>Deck title</h1>
    <p class="step">This line appears on “Next Step”.</p>
  </div>
</section>

<!-- Interactive slide: only the button is tappable; the rest stays inkable -->
<section class="page">
  <div class="wrap">
    <h1>Tap to reveal</h1>
    <p>Discuss, then reveal the value.</p>
    <button class="btn clickable" onclick="this.textContent='v = 9.8 m/s'">Reveal answer</button>
  </div>
</section>

<script>
  /* Self-running animations only; state in variables (no localStorage).
     Optional slide sync:
     window.addEventListener("message", e => {
       if (e.data && e.data.type === "lf-show") { /* react to e.data.index */ }
     }); */
</script>

<!-- Standalone fallback controller from rule 6 — paste it here, LAST. -->
```

### 14. Common interactive recipes (all click-driven)
- **Reveal answer:** a `.clickable` button whose `onclick` swaps text / adds a class.
- **Flip / toggle:** `onclick="this.classList.toggle('open')"` with CSS for `.open`.
- **Step through states:** a `.clickable` "Next" button advancing a JS counter.
- **Pick-one / pick-many (quiz):** clickable option markers that add `correct`/
  `wrong` classes — see the companion **question-deck prompt** for the full engine.
- **On-screen keypad (numeric entry):** grid of `.clickable` digit buttons that
  append to a JS string shown in a display element.

### 15. Self-check before returning
- [ ] One self-contained `.html`; prefer inlined assets (data-URIs, `<svg>`,
      system fonts). No local/relative file paths.
- [ ] **No `display:none`/`opacity:0` on `.page` in your CSS**, and the **standalone
      fallback controller (rule 6) is included** — so the file renders (not blank)
      outside the host and pages one-at-a-time when previewed.
- [ ] Every slide is `<section class="page">` with an inner full-height wrapper;
      `html,body{height:100%;margin:0}` present; layout on the wrapper, not `.page`.
- [ ] Any persistent/3D background is OUTSIDE `.page`, `z-index` behind slides, inits
      after `load` with a zero-size guard, feature-detect + `try/catch`, hidden in print.
- [ ] Dark theme (or transparent) so the default white ink is visible; calm areas
      left for writing.
- [ ] No `localStorage`/cookies; no `alert`/`window.open`/forms/navigation; no
      `<input>`/`<textarea>`/`<select>`; nothing depends on hover/keyboard/drag.
- [ ] Everything interactive is `class="clickable"` (≥44px, stable position) with a
      real click handler; non-controls left un-clickable so they stay inkable.
- [ ] Any always-on visual is a sibling OUTSIDE `.page`; animations self-run on load.
- [ ] `.step` used for reveals; no manual opacity/visibility on `.step`.
- [ ] Readable with JS off + an `@media print` block (steps flat, chrome hidden) so
      the PDF export looks right.
- [ ] No `__lf-` names, no `lf-` postMessage types.
- [ ] Any video is **declared** via `data-video` on a sized `.video-frame`, with a
      `.video-fallback` giving the URL and in/out points (rule 18) — never an
      embed the deck expects to drive itself.

### 16. Converting from a source PPT — capture EVERYTHING
When the deck is being converted from a PowerPoint (or any source slides):
- **Examine each slide closely at higher resolution so you capture everything.**
  Do NOT rely on extracted text alone — much physics content (equations, diagrams,
  comparison tables, labels) lives in images/shapes and is lost in a text dump.
  Render each slide to an image at a high DPI (e.g. render the PPT to PDF, then to
  PNG at ~150 DPI) and read them **one slide at a time**, not in coarse montages —
  montages hide small equations and table rows.
- **Preserve structure, not just words.** If a slide is a comparison table, rebuild
  it as a table (keep every row and column, including symbol/diagram cells). Don't
  collapse a table into loose cards or you will drop rows.
- **Keep every equation, label, note, and "special case"** exactly as shown; add
  brief clarifying context only where it aids teaching, never in place of source
  detail.
- **Reveal one piece at a time — never dump a whole slide at once.** Put
  `class="step"` on every distinct piece of information so each appears on the next
  click / press, not all together. Specifically:
    - **Tables:** reveal each row on its own — put `class="step"` on every `<tr>`
      (`<tr class="step">…`), so a comparison/values table builds up row by row.
    - **Issue/Fix or equation + explanation pairs:** make each line its own `.step`.
    - **Bullet lists:** step each `<li class="step">` individually.
    - Only the slide **heading** (and a table's column headers) should be visible
      before the first click; everything else steps in one at a time.
- Then apply the font-sizing rule above (match the PPT size).

### 17. Project-specific conventions (standing rules — apply to every deck built for this project)
- **Font — match the source PPT's typeface.** These decks are exported from PowerPoint decks
  that use Office's default theme font. Set the body font-family to
  **`Calibri, Candara, 'Segoe UI', system-ui, sans-serif`** (Calibri first) instead of a generic
  `system-ui` stack, so text reads like the original slide on any Windows teaching device where
  Calibri is installed. Keep a separate serif/italic stack (e.g. `'Cambria Math', Georgia, serif`)
  only for equations.
- **Tables — reveal one cell at a time, not a full row.** This overrides the generic "put `.step`
  on every `<tr>`" guidance in rule 16 for this project: put `class="step"` on each individual
  `<td>` of data (in left-to-right, top-to-bottom order) instead of on the `<tr>`. Keep the row's
  property/label cell (first column) **always visible** (no `.step`) so it acts like a mini row
  header — analogous to the table's column headers — and only the data cells for that row step in
  one by one on successive clicks.
- **Term/word and its definition must never reveal together.** Anywhere content is structured as
  "word: meaning" (glossary entries, category name + description, a sub-heading + its explanatory
  paragraph, etc.), keep the word/term/label **always visible** (no `.step`) and put `.step` only
  on the definition/description/explanation that follows it, so the two never appear in the same
  reveal. This mirrors the existing Q&A pattern (question always visible, answer stepped) — apply
  that same pattern consistently to every label/definition pairing in the deck.
- **No logo / brand badge anywhere.** Do not add a "PW" (or any other) logo badge, watermark, or
  brand mark to the deck — not as a persistent corner badge, not inside individual slides, not in
  print/PDF styles. Slides should contain only the lesson content (kicker/topic tag text is fine;
  a logo graphic or initials badge is not). If a source slide image shows a logo, leave it out of
  the HTML rebuild.

### 18. Video — declare it, don't embed it
A deck iframe is sandboxed `allow-scripts` (opaque origin) and the whole deck
layer is `pointer-events:none`. So a player you embed yourself **cannot load and
cannot be clicked** — a forwarded `lf-click` is a synthetic event and will never
press Play. Instead, **declare** the video and let the panel render a real,
interactive player over your placeholder, in its own document, above the ink
canvas:
```html
<div class="video-frame"
     data-video="dPWmdcAKSFA"   <!-- the id only, not the whole URL -->
     data-start="33" data-end="50"
     data-provider="youtube">   <!-- youtube (default) | vimeo -->
  <!-- optional: your own iframe, so the file still plays when the .html is
       opened in a plain browser. The host hides it and paints over it. -->
</div>
<div class="video-fallback">
  <div class="cue">Play from 0:33 to 0:50</div>
  <div class="url">https://www.youtube.com/watch?v=dPWmdcAKSFA</div>
</div>
```
- The placeholder must have a **real size before the video loads** (use
  `.video-frame`, which is `aspect-ratio:16/9`), because the host positions the
  player from that box's rect.
- The teacher gets a **"Write over video"** toggle on the player, so the box can
  be handed back to the pen and taken back again.
- Scripts are stripped in PDF export and the room may be offline, so a
  **`.video-fallback` carrying the URL and the in/out points is required** — it
  is what prints and what the teacher reads if the player is blocked.
- Never make the video the only carrier of an idea; the slide must still teach
  with the player missing.

---

## CONTENT BRIEF  (fill this in, then send)

- Deck topic / subject: ____
- Audience / grade level: ____
- Number of slides & what each should cover (outline or bullet list): ____
- Visual style / theme (colors, mood) — optional: ____
- Any interactivity wanted (reveals, quizzes, keypad, toggles): ____
- Paste exact text/data to use, or let the AI write it: ____

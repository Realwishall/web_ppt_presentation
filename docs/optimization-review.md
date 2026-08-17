# LessonForge — optimisation review

Scope: `public/presenter.html`, `tools/fx-three-runtime.js`, `tools/make-vendor.mjs`,
`build/*/*.html`, plus the repo layout. Read against `CLAUDE.md` and the
"never a CDN" rule in `public/deck-authoring-prompt.md`.

---

## 1. What the numbers actually are

Two representative built decks, measured:

| part | bytes | share |
|---|---:|---:|
| `three.iife.min.js` (inlined, `data-vendor="three"`) | 736 KB | **69 %** |
| `anime.umd.min.js` (inlined, `data-vendor="anime"`) | 115 KB | 11 % |
| `fx-three-runtime.js` (inlined) | 57 KB | 5 % |
| `deck-base.css` (inlined) | 56 KB | 5 % |
| small runtime scripts (fit, cues, anime presets, sim) | ~15 KB | 1 % |
| **the actual slide** (markup + math) | ~100–150 KB | **~10 %** |
| **total** | **~1.07–1.12 MB** | |

`09-full-circular-motion-and-motion-in-2d.html`: 44 pages, 14 `.scene-frame`,
**10 `data-three`**, 17 `data-anime`.

Three consequences that already bite:

- A deck is **over the 1 MB Firestore document ceiling**, so `contentStore.js`
  chunks it. Every deck load is 2+ document reads and ~1.1 MB down the wire,
  of which ~90 % is library code that is identical in every deck you own.
- The deck text is retained in `state.decks[].text` **and** handed to
  `frame.srcdoc` — so each loaded deck costs roughly 2 × 1.1 MB of live string
  before a single pixel is drawn.
- Every loaded deck iframe compiles its own private 851 KB of JS. There is no
  sharing between them, because `srcdoc` + `sandbox="allow-scripts"` gives each
  frame an opaque origin with no HTTP cache entry and no V8 code cache.

---

## 2. The ink lag — root cause

The presenter is already very heavily tuned: dpr budget, `lite` mode,
`pointerrawupdate`, coalesced points into one path, atomic `copy` blit, dirty-rect
overlay, cheap undo checkpoints. Those are the right fixes and they are done.

**What is left is not in the ink code. It is main-thread contention with the deck.**

A sandboxed `srcdoc` iframe with an opaque origin is *not* site-isolated into its
own process — Chromium keeps it in the parent's renderer, and every local frame in
a renderer shares **one main thread**. So the deck's JavaScript and the pen's
`pointerrawupdate` handler are on the same thread, in the same queue.

Now look at what the deck puts on that thread. `tools/fx-three-runtime.js`:

```js
window.addEventListener('load', function(){
  ...
  frames.forEach(function(frame){ start(frame); });   // ALL of them
```

`frames` is `document.querySelectorAll('[data-three]')` across **all 44 pages**.
So on load, a deck creates **10 `WebGLRenderer`s, every one with
`antialias: true`**, each with its own uncancellable loop:

```js
(function loop(){
  requestAnimationFrame(loop);
  group.rotation.y += 0.0022;
  renderer.render(scene, camera);
})();
```

`installGfxCap()` in the deck controller does patch `render()` to return early for
pages that are not `__lf-active` — good, and it caps `setPixelRatio`. But it does
not stop the **rAF callbacks themselves**. Every frame, while the teacher is
writing, the main thread still runs 10 callbacks per loaded deck: `Date.now()`,
matrix updates, vector math, geometry updates, the early-return check. Load three
decks in a lecture and that is 30 callbacks per frame, plus the live one that
actually renders — all in front of the pen in the same task queue.

On top of that, 10 live WebGL contexts per deck. Chromium evicts the oldest once a
page passes ~16; two decks loaded puts you over, and you get context-lost /
context-restore churn (each restore re-uploads geometry and recompiles shaders)
during a lecture, at unpredictable moments.

Nothing anywhere sends the deck a "the pen is down, stop" signal. The message
vocabulary is `lf-show`, `lf-refit`, `lf-click`, `lf-freeze-snap`, … — there is no
`lf-ink`.

**That is the lag. The pen is fast; it is queued behind the slide.**

---

## 3. Fixes for the lag, in the order I would do them

### 3.1 Pause the deck while the pen is down  ← biggest single win, smallest patch

In `presenter.html`, on `pointerdown` (pen/eraser only, not laser) tell the active
deck to stop, and release it on `pointerup`/`pointercancel`:

```js
function tellDeck(on){
  const f = activeDeckFrame();
  if(f && f.contentWindow) f.contentWindow.postMessage({ type:"lf-ink", on }, "*");
}
```

In `deckController` (the string appended to every srcdoc):

```js
window.__lfInkBusy = false;
addEventListener("message", function(e){
  if(e.data && e.data.type === "lf-ink") window.__lfInkBusy = !!e.data.on;
});
```

and in `fx-three-runtime.js`, route **every** loop through one helper instead of
calling `requestAnimationFrame` directly:

```js
function lfLoop(fn){                 // replaces (function loop(){ rAF(loop); ... })()
  var live = true;
  (function tick(){
    if(!live) return;
    requestAnimationFrame(tick);
    if (window.__lfInkBusy) return;  // pen owns the thread
    fn();
  })();
  return function(){ live = false; };
}
```

Do the same for the `data-anime` presets that loop (`pulse`, `float`) — the
simplest version is to have the controller set `html.__lf-inking` and add
`html.__lf-inking *{animation-play-state:paused!important}`.

The teacher is either watching motion or writing, never both. This costs nothing
visually and hands the whole frame budget back to the pen at exactly the moment it
is needed.

### 3.2 Start scenes lazily, stop them properly, dispose the far ones

Replace the `forEach(start)` on `load` with per-page activation. The controller
already knows which page is active (`__lf-active`); expose it:

```js
// in fx-three-runtime.js
var stop = {};                                   // frame → teardown fn
function activate(frame){
  if (stop[uid(frame)]) return;                  // already running
  stop[uid(frame)] = start(frame);               // start returns lfLoop's cancel
}
function deactivate(frame, hard){
  var s = stop[uid(frame)]; if(!s) return;
  s(); delete stop[uid(frame)];
  if (hard && frame.__lfRenderer){               // beyond ±1 page: give the GPU back
    frame.__lfRenderer.dispose();
    frame.__lfRenderer.forceContextLoss();
    frame.__lfRenderer.domElement.remove();
    frame.__lfRenderer = null;
  }
}
```

Drive it from a `MutationObserver` on `.page` class changes, or simply from the
`lf-show` handler in the controller (it already receives `index`). Warm the pages
at `index ± 1` so a page turn is never a cold shader compile; hard-dispose
everything else.

Result: **1–2 live WebGL contexts instead of 10 per deck**, no context eviction, no
idle rAF callbacks, and a deck's `load` stops being a burst of ten renderer
constructions.

### 3.3 `antialias: false` on a big panel

All 11 renderer constructions do `new T.WebGLRenderer({ alpha: true, antialias: true })`.
MSAA resolve every frame on an OPS-stick iGPU at panel resolution is real money,
and on a 75–86" board at classroom distance it buys nothing. Patch it centrally in
`installGfxCap` so no deck has to be rebuilt:

```js
var Orig = T.WebGLRenderer;
var big = (innerWidth * innerHeight) > 2000000;
T.WebGLRenderer = function(p){
  p = p || {};
  if (big) p.antialias = false;
  p.powerPreference = "high-performance";
  return new Orig(p);
};
T.WebGLRenderer.prototype = Orig.prototype;
```

### 3.4 Evict deck iframes that are not in use

`deckFrames` currently keeps **every** loaded deck's iframe alive in `#deckLayer`
forever — a whole document, 851 KB of compiled JS, and its GPU surfaces each. But
`state.decks[i].text` is already retained, so a frame is fully reconstructible.

Keep at most two live (current deck + the one you are stepping toward); on eviction
`frame.remove()` and rebuild `srcdoc` on demand. A page turn back into an evicted
deck costs one reload, which is the moment the teacher is talking anyway — and it
is a straight trade for a permanently quieter main thread.

### 3.5 Cheap presenter-side wins

- **`.board { contain: layout paint; overflow:hidden; border-radius: var(--board-radius) }`.**
  The comment on `--board-radius` is exactly right about the clip mask defeating
  `desynchronized`, and `lite` zeroes the radius — but `contain: paint` **is itself
  a clip**, and it stays on in lite. Add `html.lite .board{contain:layout}` and
  re-measure. Also switch `overflow:hidden` → `overflow:clip`: same visual result,
  but it does not create a scroll container.

- **`#mediaLayer` paints above `#ink`.** It is always in the DOM, right after the
  canvas, and most pages have no video at all. A low-latency canvas loses its
  direct-composite path as soon as anything can paint over it. Keep `#mediaLayer`
  detached until an `lf-media` rect actually arrives, and re-detach in
  `clearMedia()`. Same reasoning as the `--board-radius` note — this is the other
  half of that fix.

- **`.board{opacity:0; transition:opacity .3s}` → `.board.visible{opacity:1}`.**
  An element with a non-`none` opacity in its computed style stays a composited
  layer forever. Once the fade has run, swap to a class that removes the `opacity`
  declaration entirely rather than setting it to 1.

- **Area eraser is O(all strokes × all points) per frame.** `eraseStrokesAt` filters
  the array then calls `redraw()`, which clears the whole buffer and repaints every
  surviving stroke — once per rAF for the length of the drag. You already have
  `cssRectToSurf`, `unionSurf` and a clipped `present({dirty})`: track the union
  bbox of the strokes actually removed, clear and repaint only that rect. On a page
  with dense ink this is the difference between a smooth drag and a stutter.

- **Move the committed buffer to a worker.** `buf`/`bctx` never needs to be on the
  main thread — it is written by `paintStroke` and read by one `drawImage`.
  `buf.transferControlToOffscreen()` into a worker makes `redraw()` (page turn,
  undo, erase, resize) stop blocking the pointer path entirely. Bigger job than the
  rest of this list; do it only if 3.1–3.4 leave something on the table.

---

## 4. The three.js / CDN question, answered directly

**Keep it off a CDN. That rule is correct — and not for the reason it is usually
given.** A CDN would be a network dependency in a room with no network guarantee,
the deck is in `sandbox="allow-scripts"` with an opaque origin, `validate-deck.mjs`
fails external scripts, and PDF export strips them. But the deciding point is that
**a CDN would not even help**: each `srcdoc` iframe has its own opaque origin, so it
compiles its own copy regardless of where the bytes came from.

What you actually want is not a CDN. It is **one copy, fetched once, compiled once.**
Four options, roughly in order of payoff:

### A. Split the runtime — most decks should not load three at all
Of the ~26 `data-three` kinds, the genuinely 3D ones are `globe`, `stars`,
`solid-angle`, `solid-angle-cone`, `screw-gauge`, `com-cube`, `com-solids`.
The rest — `xy-independence`, `vector-rva`, `tangent-normal`, `curvature-circle`,
the whole `startMech2D` family (`impulse-wall`, `explosion-momentum`,
`recoil-momentum`, `collision-momentum`, `restitution-e`, `newton-cradle`,
`bounce-decay`, `max-ke-loss`), `startFbd2D` (`slinky-drop`, `lift-frame`,
`friction-ramp`), `equilibrium-types`, `work-dot`, `projectile-power` — are 2D
schematics that happen to be drawn on a perspective plane. They are 2D-canvas or
SVG work with a bit of matrix math.

Split into `fx-2d-runtime.js` (no library, ~15 KB) and `fx-three-runtime.js` (true
3D only), and have `build-deck.mjs` inline three only when a *3D* kind is present.
Most decks drop from 1.1 MB to ~250 KB and stop creating WebGL contexts entirely.
**This is the largest structural win available and it also removes most of §3.2's
problem.**

### B. Stop shipping vendor bytes inside decks; let the presenter supply them
The presenter already composes every srcdoc:

```js
frame.srcdoc = text + deckController(state.anim);
```

So have `build-deck.mjs` emit a placeholder instead of 736 KB:

```html
<script data-vendor="three" data-lf-vendor></script>
```

and have the presenter splice in its own single copy at srcdoc time (falling back
to a `--standalone` build for decks meant to open bare in a browser).

Gains: deck goes 1.1 MB → ~230 KB, back under the Firestore single-document
ceiling (one read instead of chunked reads), ~5× less to download, ~5× less string
held per loaded deck. It does **not** remove the per-iframe compile — pair it with
§3.4.

### C. Same-origin shared vendor + service worker — the "CDN" idea done right
If you can drop the opaque origin (serve decks from `/deck/<code>.html` on your own
Firebase Hosting origin, or add `allow-same-origin` to the sandbox — you author
every deck, so the trust boundary is real), then

```html
<script src="/vendor/three.iife.min.js"></script>
```

is fetched once, cached once, and **V8 code-cached once** for every iframe on the
page. That is the parse cost you cannot get rid of any other way. Precache
`/vendor/*` in a service worker and the offline classroom is safer than it is today,
because the bytes survive without the deck carrying them. Serve `/vendor/**` with
`Cache-Control: public, max-age=31536000, immutable` (your `firebase.json` already
does this for `/assets/**`).

### D. Tree-shake three — worth doing, but last
`fx-three-runtime.js` uses ~35 exports: `Vector3`, `Mesh`, `Group`, `Line`,
`LineSegments`, `Points`, 8 geometries, 5 materials, 3 lights, `CanvasTexture`,
`PerspectiveCamera`, `WebGLRenderer`, `Quaternion`, `BufferAttribute`.
No loaders, no post-processing, no animation system, no PMREM, no WebGPU.

But the split is: `three.core.min.js` 385 KB (math/core/geometries/materials/lights —
this is the shakeable part) and `three.module.min.js` 366 KB (the renderer plus the
whole shader library — essentially all needed). Realistic outcome is
**736 KB → ~500–560 KB min** (~130 KB gzipped). A useful 25–30 %, not a
transformation — which is why it ranks below A–C. Replace the hand-rolled
IIFE assembly in `make-vendor.mjs` with a rollup/rolldown build over an entry file
that re-exports only those names.

### E. anime.js (115 KB) is probably deletable
You use four presets: `draw`, `count`, `pulse`, `float`. `draw` is
`stroke-dasharray`/`stroke-dashoffset` + a CSS transition; `count` is one rAF over
a number; `pulse` and `float` are CSS keyframes. That is on the order of 60 lines of
your own code, and it removes a library init from every single deck plus the
`A.animate = instant` monkey-patch dance in the controller.

---

## 5. Everything else

**Repo weight**

- `_to_delete/` — 28 files including two ~1 MB decks. `firebase.json.bak`,
  `presenter.html.bak-prefix` (243 KB), five `*.bak`.
- `build/*/_check.html` — near-duplicates of the real deck, ~1 MB each.
- Decks exist in `build/`, `JSON_split_html/` **and** `dist/` — three copies of the
  same megabyte files. Make `dist/` build-only and gitignore it.
- 153 PNGs, several over 1 MB (`slide-002.png` 1.6 MB, `slide-034.png` 1.2 MB).
  `tools/optimize-media.py` exists — wire it into the pipeline; WebP q80 typically
  takes 60–80 % off these.
- `deck-base.css` (56 KB) is inlined identically into every deck. Same shared-asset
  argument as three, same fix (§4B/C).

**Delivery**

- `firebase.json` sends `**/*.@(html|json|md)` as `no-cache`, so `presenter.html`
  (245 KB) is re-downloaded on every classroom start. Serve it under a hashed name
  with `immutable`, or precache it in a service worker — the panel then opens
  instantly and survives a dead Wi-Fi period.

**Gate**

Add to `validate-deck.mjs`:

- number of live `data-three` kinds, and **fail** if three is inlined for a deck
  whose only 3D kinds are 2D-family (this enforces §4A automatically);
- WebGL context count implied by the deck;
- vendor bytes reported separately (already excluded from the size budget — also
  print them, so a deck pulling 736 KB for one decorative globe is visible).

**Measurement**

`public/panel-bench.html` already exists — extend it to report three numbers so you
can prove each change on the actual MaxHub rather than on a laptop:

1. pen-down → first ink pixel (µs, via `requestAnimationFrame` + `performance.now()`
   around the first `appendInkPoints`);
2. live WebGL context count (`WEBGL_lose_context` probe, or just count
   `canvas[data-three]` with a context);
3. rAF callbacks serviced per frame with a deck loaded vs. with none.

Then on the panel: `chrome://gpu` to confirm hardware acceleration and
"Canvas: Hardware accelerated", and a Performance-panel recording while drawing —
what you are looking for is long tasks between `pointerrawupdate` and the commit.

---

## 6. If you only do four things

1. **`lf-ink` pause** (§3.1) — smallest patch, biggest felt improvement.
2. **Lazy scene start + dispose** (§3.2) — removes 10 contexts and 10 idle loops per deck.
3. **Split `fx-2d-runtime` from `fx-three-runtime`** (§4A) — most decks stop loading
   736 KB and stop touching WebGL at all.
4. **`antialias:false` on big panels + `contain:layout` in lite + detach `#mediaLayer`**
   (§3.3, §3.5) — three one-liners that finish the job `--board-radius` started.

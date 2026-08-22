# Where the lag actually is, and what a redesign would buy

Written after reading `public/presenter.html`, `tools/fx-three-runtime.js`,
`docs/panel-performance.md` and `docs/optimization-review.md` against one
answer from the teacher: **the thing that feels bad is ink trailing the
finger.** Page turns are fine. Deck switching is fine. It does not get worse
as the lesson goes on.

That answer throws away most of the suspect list, and it changes what a
redesign should be aimed at.

---

## 1. What the symptom rules out

The two existing docs are, between them, a very good audit — but they are an
audit of *throughput*: process count, WebGL contexts, idle rAF callbacks,
851 KB of duplicated vendor bytes, six iframes alive for a double period.
Every one of those costs frames. **None of them costs latency in the way being
described.**

If the problem were main-thread contention with the deck, it would show up as
the ink *hitching* — smooth, then a gap, then smooth. If it were the number of
loaded decks, it would get worse through the lesson and be fine on the first
folder. If it were fill rate, page turns would stutter too.

"I write and the line arrives a beat later, consistently" is a **fixed pipeline
delay**. Fixed delays live in four places, and only one of them is JavaScript:

| stage | typical | who controls it |
|---|---:|---|
| IR touch frame + MaxHub firmware smoothing/prediction | 10–40 ms | the panel's settings menu |
| USB HID → Windows → Chrome browser process → renderer | 5–15 ms | Chrome, barely |
| pointer handler → `stroke()` | **1–3 ms** | **this is the part already tuned to death** |
| composite → swap → panel scanout → LCD processing | 16–50 ms | refresh rate + panel picture mode |

The presenter's share of that budget is the smallest row in the table, and it
has already been squeezed: `desynchronized`, `pointerrawupdate` for touch,
coalesced points into one path, no per-point blit, dirty-rect overlay,
`overflow:clip`, `contain:layout` in lite, the `lf-ink` deck pause, frame
eviction at `MAX_LIVE_DECKS = 3`. There is very little left to win there.

So: before redesigning anything, the question to answer is *which of the other
three rows is eating the time.* Right now nobody knows, because
`panel-bench.html` has never been run on the panel.

---

## 2. Do these five checks first — one of them may be the whole answer

Half an hour on the MaxHub, before a line of code changes.

**1. Is the panel actually running at 60 Hz?**
Windows → Display → Advanced display. A 4K OPS PC on a long HDMI cable
negotiates **3840×2160 @ 30 Hz** far more often than anyone expects, and
nothing on screen announces it. At 30 Hz every frame costs 33 ms instead of
16, and ink feels exactly like this: consistently a beat behind, never
stuttering. This is the single most likely explanation for a lag that survived
all the tuning already done, and it takes two clicks to rule out.

**2. Is the panel in a low-latency picture mode?**
MaxHub firmware runs its own smoothing and prediction over IR touch, plus
image processing on the display side. Both vary by "writing mode" / "touch
mode" / picture preset. They sit underneath the browser and no web code can
remove them. If bench section 3 reports 80 ms and up, the answer is in that
menu, not in this repo.

**3. `chrome://gpu`.**
If the top block says SwiftShader anywhere, or "Canvas: Software only",
nothing in this document matters. OPS display drivers get blocklisted by
Chrome more often than they should.

**4. Is Chrome full screen?**
A fullscreen tab lets the compositor hand its surface more or less straight to
the scanout. Windowed, with browser chrome above it, it cannot.

**5. Run `panel-bench.html`, section 3, and write the number down.**
Two boards side by side, finger-to-ink measured from the OS timestamp.
Everything below is priced against that number. Under ~35 ms and the browser
path is at its floor — the remaining delay is rows 1 and 4 of the table, and
the code is not the place to look. Over ~60 ms and something is genuinely
broken; find it before rebuilding around it.

---

## 3. The one code change that is worth making regardless: predict the tip

There is exactly one significant technique missing from the presenter, and it
is the technique that makes native pens feel instant.

Every fix in the repo so far tries to make the ink *arrive sooner*. Prediction
does something different: it draws ink **where the finger is about to be**, so
the visible line stays under the fingertip even though the pipeline is still
30 ms deep. It does not reduce latency. It removes the *appearance* of latency,
which is the entire complaint.

Chromium ships its own predictor and exposes it:

```js
const predicted = e.getPredictedEvents?.() || [];
```

`getPredictedEvents()` is unused anywhere in `presenter.html` — I checked. So is
any hand-rolled extrapolation. This is free latency hiding that the browser is
already computing and the presenter is throwing away.

**How it has to be wired here.** Predicted points are provisional: they must be
drawn, then removed when the real points land. The presenter has the right
machinery for that already — `present({dirty})` restores a rect from `buf` and
repaints an overlay on top of it, which is how the eraser ring and the laser
work. The one obstacle is that the wet stroke is currently drawn *only* into
the visible `ctx` and folded into `buf` at `endStroke()`, so restoring a dirty
rect mid-stroke would eat part of the live line.

The shape of the change:

- in `appendInkPoints`, stroke the same path into **`bctx` as well as `ctx`**,
  so `buf` is always the committed truth (two `stroke()` calls on a 2–3 point
  path — negligible);
- after each `flushRaw()`, extrapolate a short tip: last real point plus
  `getPredictedEvents()`, capped at **one frame of horizon (~16 ms)**, and
  damped when curvature is high so a direction change does not throw a spike;
- draw that tip through the existing overlay pass, with the dirty rect being
  the tip's bbox — a couple of hundred device pixels, not a board blit;
- next flush restores that rect from `buf` and draws the new tip.

**Then drop `RAW_MIN_MS` from 6 to 0–3.** That 6 ms buffer was added to stop
one `stroke()` per event against a multi-megapixel canvas, but the draw path is
now a single `lineTo` on an open path — it is not the expensive thing it was
when the cap was written. On the device the whole app exists for, that cap is
6 ms of deliberate delay in the row of the table that has the least to give.
Make it a `Shift`-toggle like `Shift+R` and A/B it on the panel.

Expected effect: **15–30 ms of apparent latency gone**, for maybe a day of
work, with no change to the architecture. Nothing else on this list comes close
to that ratio. Risk is overshoot on sharp corners, which is why the horizon is
capped at one frame and damped by curvature — and why it ships behind a toggle.

---

## 4. If that is not enough: the structural options, priced honestly

These are the answers to "what other ways could we show the content". They are
ordered by how much they change, not by how much they help.

### A. One surface — draw the slide *into* the ink canvas

This is the redesign that actually targets the symptom.

Today the board is: a live sandboxed iframe (opaque, 4K, its own compositor
surface) with a **transparent** `desynchronized` canvas over it, plus
`#mediaLayer` above that, inside a `contain:layout paint` box. A low-latency
canvas only gets the browser's fast presentation path when it is effectively
alone — nothing painting over it, nothing clipping it, and ideally opaque. The
current stack is the opposite of that in three ways at once, and the
`--board-radius` and `contain` comments in the file show the fight has already
been noticed.

The alternative: **the board is one opaque canvas and nothing else.** Each
frame draws a bitmap of the current slide, then the ink. Both live in the same
surface, `alpha:false`, nothing above, nothing below, no iframe in the
compositor tree at all. Ink and slide can never be out of sync because they are
the same pixels.

It also answers the question in the original ask directly — *"only one page is
worked on at a time, so why does loading many decks cost anything"* — by making
it true by construction. Loaded decks become a bitmap cache. Three decks or
thirty, the board draws one image.

The catch is producing the bitmap, and a browser cannot rasterize an iframe.
Two ways around it:

- **Pre-bake at build time.** The Playwright setup in `test/` already drives
  headless Chromium; extend the pipeline to render every page × step state to
  WebP at ~2560×1440 and ship them beside the deck. Text pages land around
  100–200 KB each; a 44-page deck at ~6 steps is roughly 30 MB, which is fine
  in Firebase Storage + IndexedDB and hopeless in Firestore. Pages that are
  genuinely live — `.clickable` questions, `data-three` scenes, video — keep the
  iframe path and are flagged at build time. `validate-deck.mjs` is the natural
  place to enforce the flag.
- **Rasterize at runtime.** Not possible in a browser. Possible in Electron —
  see §C.

Cost: a real change to the build pipeline and the storage model. Payoff: the
compositing problem stops existing, and `MAX_LIVE_DECKS` stops being a number
anyone has to tune.

### B. Give the deck its own process — a real cross-origin frame

`docs/optimization-review.md` gets the diagnosis right and then draws the
opposite conclusion from it. A `srcdoc` iframe with `sandbox="allow-scripts"`
has an opaque origin, which is *not* site-isolated, so it stays in the parent's
renderer and shares the one main thread with the pointer handler. The doc's
answer is to pause the deck (`lf-ink`), which is a good patch.

The other answer is to stop putting it there. Serve decks from a real URL on a
**separate origin** — `decks.<yourdomain>` on the same Firebase Hosting project
— and load them with `src=`, not `srcdoc`. Chrome site-isolates a cross-origin
frame into its own renderer process, with its own main thread. Deck JS then
*cannot* queue in front of a pointer event, whatever the deck does, with no
cooperation required from the deck's own code.

Three things come free with it:

- decks now share an HTTP cache **and a V8 code cache**, so `three`,
  `anime` and `deck-base.css` are fetched once and compiled once for every deck
  instead of 851 KB per iframe — which is §4B/C of the optimisation review,
  solved as a side effect;
- deck HTML drops back under the 1 MB Firestore ceiling, so `contentStore.js`
  stops chunking;
- a service worker can precache `/vendor/**`, which makes the offline classroom
  *safer* than today, since the bytes survive without every deck carrying them.

What it costs: the deck is no longer a self-contained file the presenter
composes at runtime, so `deckController()` has to be delivered as part of the
deck document or over `postMessage` handshake, and the export/bake paths that
read a deck's live DOM need `allow-same-origin`-equivalent access rethought.
Worth doing on its own merits even if the ink problem turns out to be the panel.

### C. A desktop app — what it does and does not buy

Being direct, because this is where the effort estimates go wrong:

- **Electron or Tauri, same HTML decks, same rendering: the ink latency is
  essentially unchanged.** It is the same Chromium (or the same Edge WebView2)
  with the same compositor. Anyone expecting a desktop wrapper to fix a 30 ms
  ink delay will be disappointed. That is not an argument against it — just not
  the argument for it.
- **What Electron genuinely unlocks is §A done dynamically.** An offscreen
  `WebContentsView` (`offscreen: true`, `useSharedTexture: true`) hands you the
  deck's rendered frames as a GPU texture. Composite that with the ink in one
  WebGL surface and you get the single-surface board *without* pre-baking every
  step state at build time — the deck stays live HTML, and the board stays one
  layer. This is the strongest technical reason to leave the browser.
- Secondary Electron wins: GPU/compositor flags you cannot set in a managed
  Chrome, exclusive fullscreen, local disk cache for decks and media (no
  Firestore chunking, genuinely offline), no browser chrome, no tab that a
  student can close, and no "someone pressed `Shift+P` once on this profile
  three months ago" class of bug.
- **The ~15 ms number needs native ink.** A transparent, always-on-top layered
  window drawing wet ink with Direct2D/DirectComposition, or Windows Ink's
  `InkPresenter` with independent input, which runs the wet stroke on a
  compositor thread that the app cannot block. Slides stay in the Electron
  window underneath; the native overlay owns the pen. This is the only route
  below the browser's floor, and it is weeks of Windows-specific work plus a
  permanent second codebase, plus every export/undo/erase interaction has to
  cross that boundary.

### D. Smaller things worth trying while measuring

- **Rasterize the deck layer below panel resolution.** The deck iframe is
  `width:100%;height:100%` on a 4K board, so it rasterizes ~8 M device pixels
  and repaints all of them on every page turn. Size it to 2560×1440 and scale
  it up with `transform` plus `will-change:transform` — `will-change` locks the
  raster scale, so the GPU upscales a texture a third the size instead of
  re-rasterizing. Roughly a 55 % cut in deck fill rate. Whether the text
  survives 1.5× upscale on an 86" board at teaching distance is a
  five-minute A/B on the panel, not a thing to argue about in advance.
- **Materialize one page, not forty-four.** Split decks into pages at build
  time and inject only `current ± 1` into the DOM. Not a latency fix, but it
  makes deck size irrelevant to memory and is the clean version of what
  `MAX_LIVE_DECKS` approximates today. Do it if stutter ever appears; ignore it
  while the only complaint is latency.
- **Ink in a worker via `OffscreenCanvas`.** Isolates the ink from main-thread
  jank — but the pointer events still arrive on the main thread, so it protects
  against *stutter*, not against the fixed delay being described. §3.5 of the
  optimisation review already has this correctly placed as "only if the rest
  leaves something on the table".

---

## 5. What I would actually do

1. **Half a day on the panel.** The five checks in §2, and `panel-bench.html`
   section 3 written down. Refresh rate and panel picture mode first — one of
   them has a real chance of being the entire complaint, and neither costs
   anything to rule out.
2. **The prediction patch (§3), behind a toggle.** Best ratio of felt
   improvement to work on the whole list, and it is worth having whatever the
   bench says.
3. **Re-measure.** If ink now lands under ~35 ms and it feels right in the
   room, stop. The band a browser board can reach on this hardware is 30–50 ms;
   below that is a native ink problem, not an architecture problem.
4. **Only if it still is not right:** cross-origin deck frames (§B) — cheap
   relative to its payoff and correct independent of the ink question — and
   then the single-surface board (§A), in Electron (§C) if runtime
   rasterization is what makes it practical.

The thing not to do is redesign first. The presenter's own code is already the
smallest term in the latency budget; a rebuild that does not first find out
which of the other three terms is dominant has a good chance of landing back at
the same number, having cost a month.
